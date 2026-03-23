package handlers

import (
	"errors"
	"journal-app/config"
	"journal-app/models"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

var keyFingerprintPattern = regexp.MustCompile(`^[a-fA-F0-9]{64}$`)

func validateKeyFingerprint(fingerprint string) error {
	if !keyFingerprintPattern.MatchString(fingerprint) {
		return errors.New("fingerprint must be a 64-character hexadecimal SHA-256 string")
	}
	return nil
}

func GetProfile(c *gin.Context) {
	userID := c.GetUint("user_id")
	var user models.User
	if err := config.DB.Select("id", "email", "username", "is_admin", "created_at").First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}
	c.JSON(http.StatusOK, user)
}

func UpdateProfile(c *gin.Context) {
	userID := c.GetUint("user_id")

	var req struct {
		Email    string `json:"email" binding:"required,email,max=320"`
		Username string `json:"username" binding:"required,min=3,max=64"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := config.DB.Model(&models.User{}).Where("id = ?", userID).Updates(map[string]any{
		"email":    req.Email,
		"username": req.Username,
	}).Error; err != nil {
		// Handle unique constraint violation on email gracefully
		if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "UNIQUE constraint") {
			c.JSON(http.StatusConflict, gin.H{"error": "Email is already in use by another account"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update profile"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Profile updated successfully"})
}

func ChangePassword(c *gin.Context) {
	userID := c.GetUint("user_id")

	var req struct {
		CurrentPassword string `json:"current_password" binding:"required,max=72"`
		NewPassword     string `json:"new_password" binding:"required,min=8,max=72"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var user models.User
	if err := config.DB.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	// Verify current password
	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.CurrentPassword)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Current password is incorrect"})
		return
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	newVersion := uuid.New().String()
	if err := config.DB.Model(&models.User{}).Where("id = ?", userID).Updates(map[string]any{
		"password":         string(hashed),
		"password_version": newVersion,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update password"})
		return
	}

	// Sever active SSE connections to log out other sessions. Delayed by 2s so that
	// THIS client's browser can store the new JWT cookies from this response before
	// its SSE socket drops — otherwise it would accidentally revoke itself.
	go func() {
		time.Sleep(2 * time.Second)
		DisconnectUser(userID)
	}()

	accessToken, err := GenerateAccessToken(userID, newVersion)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate access token"})
		return
	}

	refreshToken, err := GenerateRefreshToken(userID, newVersion)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate refresh token"})
		return
	}

	if clientPrefersCookieAuth(c) {
		setAuthCookies(c, accessToken, refreshToken)
		c.JSON(http.StatusOK, gin.H{"message": "Password changed successfully"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Password changed successfully",
		"token":   accessToken,
	})
}

func GetKeyFingerprint(c *gin.Context) {
	userID := c.GetUint("user_id")
	var user models.User
	if err := config.DB.Select("key_fingerprint").First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"key_fingerprint": user.KeyFingerprint})
}

func VerifySensitiveAction(c *gin.Context) {
	userID := c.GetUint("user_id")

	var req struct {
		CurrentPassword string `json:"current_password" binding:"required,max=72"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var user models.User
	if err := config.DB.Select("id", "password", "password_version").First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.CurrentPassword)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Current password is incorrect"})
		return
	}

	shortToken, err := GenerateShortLivedToken(user.ID, user.PasswordVersion)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate verification token"})
		return
	}

	setResetTokenCookie(c, shortToken)
	c.JSON(http.StatusOK, gin.H{"message": "Sensitive action verified"})
}

func UpdateKeyFingerprint(c *gin.Context) {
	userID := c.GetUint("user_id")

	var req struct {
		Fingerprint string `json:"fingerprint" binding:"required,len=64"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := validateKeyFingerprint(req.Fingerprint); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var user models.User
	if err := config.DB.Select("id", "key_fingerprint").First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	requiresRecentVerification := user.KeyFingerprint != "" && user.KeyFingerprint != req.Fingerprint
	if requiresRecentVerification {
		token, err := extractTokenFromCookieOrHeader(c, ResetTokenCookie)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Recent password verification is required to change the encryption key fingerprint"})
			return
		}

		claims, err := ValidateShortLivedToken(token)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Recent password verification is required to change the encryption key fingerprint"})
			return
		}

		tokenUserID, err := extractUserIDFromClaims(claims)
		if err != nil || tokenUserID != userID {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Recent password verification is required to change the encryption key fingerprint"})
			return
		}

		// Verify password_version to ensure the short-lived token was not issued
		// before a password change (which would have rotated the version).
		tokenVersion, _ := claims["password_version"].(string)
		var freshUser models.User
		if err := config.DB.Select("password_version").First(&freshUser, userID).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify token validity"})
			return
		}
		if tokenVersion != freshUser.PasswordVersion {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Session revoked due to password change. Please re-authenticate."})
			return
		}
	}

	if err := config.DB.Model(&models.User{}).Where("id = ?", userID).Update("key_fingerprint", req.Fingerprint).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update key fingerprint"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Key fingerprint updated"})
}

// ResetAllEntriesAndKey deletes all user's entries and clears the key fingerprint
// Used when user forgets their encryption key on login page
func ResetAllEntriesAndKey(c *gin.Context) {
	userID := c.GetUint("user_id")
	newVersion := uuid.New().String()

	// Wrap entry deletion + fingerprint clear + version rotation in a single
	// transaction to prevent partial data loss.
	var deletedCount int64
	if err := config.DB.Transaction(func(tx *gorm.DB) error {
		// Hard-delete all journal entries for this user (Unscoped — encrypted content should not linger)
		result := tx.Where("user_id = ?", userID).Unscoped().Delete(&models.JournalEntry{})
		if result.Error != nil {
			return result.Error
		}
		deletedCount = result.RowsAffected

		// Clear the key fingerprint and rotate password_version to revoke other sessions
		if err := tx.Model(&models.User{}).Where("id = ?", userID).Updates(map[string]any{
			"key_fingerprint":  "",
			"password_version": newVersion,
		}).Error; err != nil {
			return err
		}

		return nil
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reset entries and key"})
		return
	}

	// Sever active SSE connections to log out other sessions. Delayed by 2s so that
	// THIS client's browser can store the new JWT cookies from this response before
	// its SSE socket drops — otherwise it would accidentally revoke itself.
	go func() {
		time.Sleep(2 * time.Second)
		DisconnectUser(userID)
	}()

	accessToken, err := GenerateAccessToken(userID, newVersion)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate access token"})
		return
	}

	refreshToken, err := GenerateRefreshToken(userID, newVersion)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate refresh token"})
		return
	}

	if clientPrefersCookieAuth(c) {
		setAuthCookies(c, accessToken, refreshToken)
		c.JSON(http.StatusOK, gin.H{
			"message":       "All entries deleted and fingerprint cleared",
			"deleted_count": deletedCount,
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":       "All entries deleted and fingerprint cleared",
		"deleted_count": deletedCount,
		"token":         accessToken,
	})
}
