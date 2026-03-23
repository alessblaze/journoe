package main

import (
	"journal-app/config"
	"journal-app/handlers"
	"journal-app/models"
	"journal-app/routes"
	"net/http"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func getCORSAllowedOrigins() []string {
	allowedOriginsEnv := os.Getenv("CORS_ALLOWED_ORIGINS")
	if allowedOriginsEnv == "" {
		// Default origins for development if not specified
		return []string{
			"http://localhost:5173",
			"http://localhost:5174",
			"http://localhost:5175",
			"http://127.0.0.1:5173",
			"http://127.0.0.1:5174",
			"http://127.0.0.1:5175",
		}
	}

	// Split comma-separated origins and trim whitespace
	origins := strings.Split(allowedOriginsEnv, ",")
	var allowedOrigins []string
	for _, origin := range origins {
		trimmedOrigin := strings.TrimSpace(origin)
		if trimmedOrigin != "" {
			allowedOrigins = append(allowedOrigins, trimmedOrigin)
		}
	}

	return allowedOrigins
}

func getMaxRequestBodyBytes() int64 {
	maxBodyEnv := strings.TrimSpace(os.Getenv("MAX_REQUEST_BODY_BYTES"))
	if maxBodyEnv == "" {
		return 1 << 20 // 1 MiB default
	}

	maxBody, err := strconv.ParseInt(maxBodyEnv, 10, 64)
	if err != nil || maxBody <= 0 {
		log.Printf("Invalid MAX_REQUEST_BODY_BYTES=%q, using default 1048576", maxBodyEnv)
		return 1 << 20
	}

	return maxBody
}

func main() {
	// Try loading from current dir, then from backend/ dir
	err := godotenv.Load()
	if err != nil {
		err = godotenv.Load("backend/.env")
	}

	if err != nil {
		log.Println("Warning: .env file not found, using default environment variables")
	} else {
		log.Println("Successfully loaded .env file configurations")
	}

	if err := handlers.InitJWTKey(); err != nil {
		log.Fatal("Invalid JWT configuration: ", err)
	}

	config.ConnectDB()
	models.SeedInitialData(config.DB)

	r := gin.Default()
	maxRequestBodyBytes := getMaxRequestBodyBytes()

	r.Use(func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxRequestBodyBytes)
		c.Next()
	})

	// CORS middleware with origins from environment
	allowedOrigins := getCORSAllowedOrigins()
	corsConfig := cors.DefaultConfig()

	// When using credentials, AllowOriginFunc is more flexible than AllowOrigins
	corsConfig.AllowOrigins = nil
	corsConfig.AllowOriginFunc = func(origin string) bool {
		// Allow requests from allowed origins
		for _, allowed := range allowedOrigins {
			if origin == allowed {
				return true
			}
		}
		return false
	}
	corsConfig.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"}
	corsConfig.AllowHeaders = []string{"Origin", "Content-Type", "Authorization", "Accept", "X-Requested-With", "X-Key-Fingerprint", "X-COOKIE-AUTH", "Cache-Control", "Accept-Encoding"}
	corsConfig.ExposeHeaders = []string{"Content-Length"}
	corsConfig.AllowCredentials = true
	corsConfig.MaxAge = 12 * time.Hour

	r.Use(cors.New(corsConfig))
	log.Printf("CORS middleware enabled - Allowed origins: %v", allowedOrigins)

	routes.SetupRoutes(r)

	port := os.Getenv("SERVER_PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server running on :%s", port)
	log.Printf("Max request body size: %d bytes", maxRequestBodyBytes)
	err = r.Run(":" + port)
	if err != nil {
		log.Fatal("Failed to start server:", err)
	}
}
