package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"journal-app/models"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type SSEEvent struct {
	Type    string      `json:"type"` // "created", "updated", "deleted"
	EntryID uint        `json:"entry_id"`
	Data    interface{} `json:"data"` // Entry data for created/updated
}

type SSEClient struct {
	UserID  uint
	Channel chan SSEEvent
	Done    chan bool
}

var (
	clients = make(map[uint][]chan SSEEvent)
	mu      sync.RWMutex
)

func AddClient(userID uint, channel chan SSEEvent) {
	mu.Lock()
	defer mu.Unlock()
	clients[userID] = append(clients[userID], channel)
}

func RemoveClient(userID uint, channel chan SSEEvent) {
	mu.Lock()
	defer mu.Unlock()
	if userClients, ok := clients[userID]; ok {
		for i, ch := range userClients {
			if ch == channel {
				clients[userID] = append(userClients[:i], userClients[i+1:]...)
				break
			}
		}
		if len(clients[userID]) == 0 {
			delete(clients, userID)
		}
	}
}

func BroadcastEvent(userID uint, event SSEEvent) {
	mu.RLock()
	defer mu.RUnlock()
	if userClients, ok := clients[userID]; ok {
		for _, channel := range userClients {
			select {
			case channel <- event:
			default:
			}
		}
	}
}

// DisconnectUser forcefully severs all active SSE connections for a given user.
func DisconnectUser(userID uint) {
	mu.Lock()
	defer mu.Unlock()
	if userClients, ok := clients[userID]; ok {
		for _, ch := range userClients {
			// Closing the channel breaks the c.Stream select loop in SSEHandler
			close(ch)
		}
		delete(clients, userID)
	}
}

func SSEHandler(c *gin.Context) {
	userID := c.GetUint("user_id")
	if userID == 0 {
		c.Status(http.StatusUnauthorized)
		return
	}

	if os.Getenv("DEBUGLOGS") == "true" {
		fmt.Printf("SSE: User %d connected\n", userID)
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Header("X-SSE-Connected", "true")

	eventChan := make(chan SSEEvent, 10)
	AddClient(userID, eventChan)

	defer func() {
		RemoveClient(userID, eventChan)
		if os.Getenv("DEBUGLOGS") == "true" {
			fmt.Printf("SSE: Removed client %d from pool\n", userID)
		}
	}()

	notify := c.Request.Context().Done()
	timeout := time.After(5 * time.Minute)

	c.Stream(func(w io.Writer) bool {
		select {
		case <-notify:
			return false
		case <-timeout:
			return false
		case event, ok := <-eventChan:
			if !ok {
				return false // Channel was forcefully closed by another handler
			}
			eventJSON, err := json.Marshal(event)
			if err != nil {
				return false
			}
			fmt.Fprintf(w, "data: %s\n\n", eventJSON)
			return true
		}
	})
}

func broadcastEntryChange(userID uint, eventType string, entry *models.JournalEntry) {
	event := SSEEvent{
		Type:    eventType,
		EntryID: entry.ID,
		Data:    entry,
	}
	BroadcastEvent(userID, event)
}
