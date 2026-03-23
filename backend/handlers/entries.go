package handlers

import (
	"journal-app/config"
	"journal-app/models"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

type CreateEntryRequest struct {
	Title    string `json:"title" binding:"required,max=4096"`
	Content  string `json:"content" binding:"required,max=262144"`
	Mood     string `json:"mood" binding:"max=255"`
	IsSticky bool   `json:"is_sticky"`
}

type UpdateEntryRequest struct {
	Title    string `json:"title" binding:"required,max=4096"`
	Content  string `json:"content" binding:"required,max=262144"`
	Mood     string `json:"mood" binding:"max=255"`
	IsSticky bool   `json:"is_sticky"`
	Version  int    `json:"version" binding:"min=1"`
}

// KeyFingerprintMiddleware validates that the client's local encryption key
// matches what the server has stored. All three failure cases are strictly rejected.
func KeyFingerprintMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		clientFP := c.GetHeader("X-Key-Fingerprint")
		if clientFP == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "X-Key-Fingerprint header is required.",
			})
			return
		}

		userID := c.GetUint("user_id")
		var user models.User
		if err := config.DB.Select("key_fingerprint").First(&user, userID).Error; err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
				"error": "Failed to verify key fingerprint.",
			})
			return
		}

		if user.KeyFingerprint == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "No encryption key has been registered for this account. Please log out and re-enter your encryption key.",
			})
			return
		}

		if clientFP != user.KeyFingerprint {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Encryption key mismatch. Your key was changed on another device. Please log out and re-enter your new key.",
			})
			return
		}

		c.Next()
	}
}

func ListEntries(c *gin.Context) {
	userID := c.GetUint("user_id")

	var entries []models.JournalEntry
	if result := config.DB.Where("user_id = ?", userID).Order("created_at DESC").Find(&entries); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch entries"})
		return
	}

	c.JSON(http.StatusOK, entries)
}

func CreateEntry(c *gin.Context) {
	userID := c.GetUint("user_id")

	var req CreateEntryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	entry := models.JournalEntry{
		UserID:   userID,
		Title:    req.Title,
		Content:  req.Content,
		Mood:     req.Mood,
		IsSticky: req.IsSticky,
		Version:  1,
	}

	if result := config.DB.Create(&entry); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create entry"})
		return
	}

	broadcastEntryChange(userID, "created", &entry)

	c.JSON(http.StatusCreated, entry)
}

func GetEntry(c *gin.Context) {
	userID := c.GetUint("user_id")
	parsedID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid entry ID"})
		return
	}
	id := uint(parsedID)

	var entry models.JournalEntry
	if result := config.DB.Where("id = ? AND user_id = ?", id, userID).First(&entry); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Entry not found"})
		return
	}

	c.JSON(http.StatusOK, entry)
}

func UpdateEntry(c *gin.Context) {
	userID := c.GetUint("user_id")
	parsedID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid entry ID"})
		return
	}
	id := uint(parsedID)

	var req UpdateEntryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Atomic version-gated update using a map to ensure zero-value fields (like is_sticky=false) are saved.
	result := config.DB.Model(&models.JournalEntry{}).
		Where("id = ? AND user_id = ? AND version = ?", id, userID, req.Version).
		Updates(map[string]interface{}{
			"title":     req.Title,
			"content":   req.Content,
			"mood":      req.Mood,
			"is_sticky": req.IsSticky,
			"version":   req.Version + 1,
		})

	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update entry"})
		return
	}

	if result.RowsAffected == 0 {
		// Zero rows affected: either the entry doesn't exist for this user,
		// or the version has already been bumped by a concurrent request.
		var current models.JournalEntry
		if config.DB.Where("id = ? AND user_id = ?", id, userID).First(&current).Error != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Entry not found"})
			return
		}
		// Entry exists but version mismatched — conflict
		c.JSON(http.StatusConflict, gin.H{
			"error":   "Another device has modified this entry since you opened it. Please refresh to get the latest version.",
			"version": current.Version,
		})
		return
	}

	// Fetch the updated row to return accurate timestamps and version
	var entry models.JournalEntry
	if config.DB.Where("id = ? AND user_id = ?", id, userID).First(&entry).Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve updated entry"})
		return
	}

	broadcastEntryChange(userID, "updated", &entry)

	c.JSON(http.StatusOK, entry)
}

func DeleteEntry(c *gin.Context) {
	userID := c.GetUint("user_id")
	parsedID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid entry ID"})
		return
	}
	id := uint(parsedID)

	var entry models.JournalEntry
	if result := config.DB.Where("id = ? AND user_id = ?", id, userID).First(&entry); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Entry not found"})
		return
	}

	// Hard-delete (Unscoped) — encrypted content should not linger in the DB.
	if result := config.DB.Unscoped().Delete(&entry); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete entry"})
		return
	}

	broadcastEntryChange(userID, "deleted", &entry)

	c.JSON(http.StatusOK, gin.H{"message": "Entry deleted"})
}
