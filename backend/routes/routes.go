package routes

import (
	"journal-app/handlers"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

func SetupRoutes(r *gin.Engine) {
	api := r.Group("/api")
	{
		auth := api.Group("/auth")
		{
			auth.POST("/register", handlers.Register)
			auth.POST("/login", handlers.Login)
			auth.POST("/logout", handlers.Logout)
			auth.POST("/refresh", handlers.Refresh)
		}

		// Debug endpoint to check cookies (disabled unless explicitly enabled)
		if strings.EqualFold(os.Getenv("DEBUG_COOKIES_ENABLED"), "true") {
			r.GET("/api/auth/debug", handlers.DebugCookies)
		}

		// SSE endpoint for real-time updates (requires auth but not key fingerprint)
		api.GET("/sse", handlers.AuthMiddleware(), handlers.SSEHandler)

		entries := api.Group("/entries")
		entries.Use(handlers.AuthMiddleware(), handlers.KeyFingerprintMiddleware())
		{
			entries.GET("/", handlers.ListEntries)
			entries.POST("/", handlers.CreateEntry)
			entries.GET("/:id", handlers.GetEntry)
			entries.PUT("/:id", handlers.UpdateEntry)
			entries.DELETE("/:id", handlers.DeleteEntry)
		}

		admin := api.Group("/admin")
		admin.Use(handlers.AuthMiddleware(), handlers.AdminMiddleware())
		{
			admin.GET("/users", handlers.GetUsers)
			admin.DELETE("/users/:id", handlers.DeleteUser)
			admin.PUT("/users/:id/password", handlers.UpdateUserPassword)
			admin.GET("/config", handlers.GetSystemConfig)
			admin.PUT("/config", handlers.UpdateSystemConfig)
		}

		user := api.Group("/user")
		user.Use(handlers.AuthMiddleware())
		{
			user.GET("/profile", handlers.GetProfile)
			user.PUT("/profile", handlers.UpdateProfile)
			user.PUT("/password", handlers.ChangePassword)
			user.POST("/verify-sensitive-action", handlers.VerifySensitiveAction)
			user.GET("/key-fingerprint", handlers.GetKeyFingerprint)
			user.PUT("/key-fingerprint", handlers.UpdateKeyFingerprint)
		}

		userReset := api.Group("/user")
		userReset.Use(handlers.ShortLivedAuthMiddleware())
		{
			userReset.POST("/reset-entries-and-key", handlers.ResetAllEntriesAndKey)
		}
	}
}
