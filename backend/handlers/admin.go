package handlers

import (
	"errors"
	"journal-app/config"
	"journal-app/models"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var allowedSystemConfigKeys = map[string]func(string) error{
	"registration_enabled": validateBooleanConfigValue,
}

func validateBooleanConfigValue(value string) error {
	if value != "true" && value != "false" {
		return errors.New("value must be 'true' or 'false'")
	}
	return nil
}

func AdminMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetUint("user_id")
		if userID == 0 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			return
		}

		var user models.User
		if result := config.DB.First(&user, userID); result.Error != nil || !user.IsAdmin {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Admin privileges required"})
			return
		}

		c.Set("is_admin", true)
		c.Next()
	}
}

func GetUsers(c *gin.Context) {
	var users []models.User
	if result := config.DB.Select("id", "email", "username", "is_admin", "created_at", "updated_at").Find(&users); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch users"})
		return
	}
	c.JSON(http.StatusOK, users)
}

func DeleteUser(c *gin.Context) {
	parsedID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}
	id := uint(parsedID)

	// Prevent deleting oneself
	userID := c.GetUint("user_id")
	var user models.User
	if err := config.DB.First(&user, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	if user.ID == userID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot delete your own admin account"})
		return
	}

	// Prevent deleting other admin accounts via API
	if user.IsAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Cannot delete an admin account"})
		return
	}

	// Wrap entry deletion + user deletion in a transaction to prevent
	// data loss if user delete fails after entries are already gone.
	if err := config.DB.Transaction(func(tx *gorm.DB) error {
		// Delete user's entries first — abort if this fails to avoid orphaned encrypted entries
		if result := tx.Where("user_id = ?", id).Unscoped().Delete(&models.JournalEntry{}); result.Error != nil {
			return result.Error
		}
		if result := tx.Unscoped().Delete(&models.User{}, id); result.Error != nil {
			return result.Error
		}
		return nil
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete user"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "User deleted successfully"})
}

func UpdateUserPassword(c *gin.Context) {
	parsedID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}
	id := uint(parsedID)

	var req struct {
		NewPassword string `json:"new_password" binding:"required,min=8,max=72"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	result := config.DB.Model(&models.User{}).Where("id = ?", id).Updates(map[string]any{
		"password":         string(hashedPassword),
		"password_version": uuid.New().String(),
	})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update password"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	DisconnectUser(id)
	c.JSON(http.StatusOK, gin.H{"message": "Password updated successfully"})
}

func GetSystemConfig(c *gin.Context) {
	var configs []models.SystemConfig
	if result := config.DB.Find(&configs); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load system configuration"})
		return
	}

	configMap := make(map[string]string)
	for _, conf := range configs {
		configMap[conf.Key] = conf.Value
	}

	c.JSON(http.StatusOK, configMap)
}

func UpdateSystemConfig(c *gin.Context) {
	var req map[string]string
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid payload"})
		return
	}

	for k, v := range req {
		validator, ok := allowedSystemConfigKeys[k]
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported configuration key: " + k})
			return
		}
		if len(v) > 32 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Configuration value too long for key: " + k})
			return
		}
		if err := validator(v); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid value for " + k + ": " + err.Error()})
			return
		}

		// Atomic upsert using ON CONFLICT to avoid SELECT→CREATE TOCTOU race
		result := config.DB.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "key"}},
			DoUpdates: clause.AssignmentColumns([]string{"value"}),
		}).Create(&models.SystemConfig{Key: k, Value: v})
		if result.Error != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save configuration for key: " + k})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"message": "Configuration saved"})
}
