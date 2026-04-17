package handlers

import (
	"encoding/json"
	"journal-app/config"
	"journal-app/models"
	"log"
	"net/http"
	"net/url"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

type RegisterRequest struct {
	Email    string `json:"email" binding:"required,email,max=320"`
	Username string `json:"username" binding:"required,min=3,max=64"`
	Password string `json:"password" binding:"required,min=8,max=72"`
	CFToken  string `json:"cf_token" binding:"max=8192"`
}

type LoginRequest struct {
	Email    string `json:"email" binding:"required,email,max=320"`
	Password string `json:"password" binding:"required,min=8,max=72"`
	CFToken  string `json:"cf_token" binding:"max=8192"`
}

func clientPrefersCookieAuth(c *gin.Context) bool {
	return c.GetHeader("X-COOKIE-AUTH") == "true"
}

func verifyTurnstile(token string, remoteIP string) bool {
	secret := os.Getenv("TURNSTILE_SECRET_KEY")
	if secret == "" {
		return true // Skip validation if not configured
	}

	if token == "" {
		return false
	}

	formData := url.Values{"secret": []string{secret}, "response": []string{token}}
	if remoteIP != "" {
		formData.Set("remoteip", remoteIP)
	}

	resp, err := http.PostForm("https://challenges.cloudflare.com/turnstile/v0/siteverify", formData)
	if err != nil {
		log.Printf("Turnstile verification error: %v", err)
		return false
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return false
	}

	var result struct {
		Success bool `json:"success"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		if os.Getenv("DEBUGLOGS") == "true" {
			log.Printf("[Turnstile] Validation JSON decode error: %v", err)
		}
		return false
	}

	if os.Getenv("DEBUGLOGS") == "true" {
		log.Printf("[Turnstile] Validation result: %v", result.Success)
	}

	return result.Success
}

func Register(c *gin.Context) {
	// Reject requests from already-authenticated sessions to prevent account spam
	if token, err := extractTokenFromCookieOrHeader(c, AccessTokenCookie); err == nil && token != "" {
		if _, err := ValidateJWT(token); err == nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "Already authenticated. Log out before creating a new account."})
			return
		}
	}

	var conf models.SystemConfig
	if config.DB.Where("key = ?", "registration_enabled").First(&conf).Error == nil {
		if conf.Value == "false" {
			c.JSON(http.StatusForbidden, gin.H{"error": "Registration is currently disabled by administrators."})
			return
		}
	}

	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if !verifyTurnstile(req.CFToken, c.ClientIP()) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid CAPTCHA validation. Please try again."})
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	user := models.User{
		Email:           req.Email,
		Username:        req.Username,
		Password:        string(hashedPassword),
		PasswordVersion: uuid.New().String(),
	}

	if result := config.DB.Create(&user); result.Error != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "User already exists"})
		return
	}

	accessToken, err := GenerateAccessToken(user.ID, user.PasswordVersion)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate access token"})
		return
	}

	refreshToken, err := GenerateRefreshToken(user.ID, user.PasswordVersion)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate refresh token"})
		return
	}

	if clientPrefersCookieAuth(c) {
		setAuthCookies(c, accessToken, refreshToken)
		c.JSON(http.StatusCreated, gin.H{
			"message": "User registered successfully",
			"user": gin.H{
				"id":       user.ID,
				"username": user.Username,
				"email":    user.Email,
				"is_admin": user.IsAdmin,
			},
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "User registered successfully",
		"token":   accessToken,
		"user": gin.H{
			"id":       user.ID,
			"username": user.Username,
			"email":    user.Email,
			"is_admin": user.IsAdmin,
		},
	})
}

func Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if !verifyTurnstile(req.CFToken, c.ClientIP()) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid CAPTCHA validation. Please try again."})
		return
	}

	var user models.User
	if result := config.DB.Where("email = ?", req.Email).First(&user); result.Error != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
		return
	}

	accessToken, err := GenerateAccessToken(user.ID, user.PasswordVersion)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate access token"})
		return
	}

	refreshToken, err := GenerateRefreshToken(user.ID, user.PasswordVersion)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate refresh token"})
		return
	}

	if clientPrefersCookieAuth(c) {
		setAuthCookies(c, accessToken, refreshToken)
		c.JSON(http.StatusOK, gin.H{
			"user": gin.H{
				"id":       user.ID,
				"username": user.Username,
				"email":    user.Email,
				"is_admin": user.IsAdmin,
			},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token": accessToken,
		"user": gin.H{
			"id":       user.ID,
			"username": user.Username,
			"email":    user.Email,
			"is_admin": user.IsAdmin,
		},
	})
}

func Logout(c *gin.Context) {
	if clientPrefersCookieAuth(c) {
		clearAuthCookies(c)
	}
	c.JSON(http.StatusOK, gin.H{"message": "Logged out successfully"})
}

func DebugCookies(c *gin.Context) {
	accessToken, _ := c.Cookie("access_token")
	refreshToken, _ := c.Cookie("refresh_token")
	resetToken, _ := c.Cookie("reset_token")

	c.JSON(http.StatusOK, gin.H{
		"has_access_token":  accessToken != "",
		"has_refresh_token": refreshToken != "",
		"has_reset_token":   resetToken != "",
		"host":              c.Request.Host,
		"origin":            c.Request.Header.Get("Origin"),
	})
}

func Refresh(c *gin.Context) {
	refreshToken, err := extractTokenFromCookieOrHeader(c, RefreshTokenCookie)
	if err != nil {
		if os.Getenv("DEBUGLOGS") == "true" {
			log.Printf("Refresh: token missing: %v", err)
		}
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Refresh token missing"})
		return
	}

	claims, err := ValidateRefreshToken(refreshToken)
	if err != nil {
		if os.Getenv("DEBUGLOGS") == "true" {
			log.Printf("Refresh: ValidateRefreshToken failed: %v", err)
		}
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired refresh token"})
		return
	}

	userID, err := extractUserIDFromClaims(claims)
	if err != nil {
		if os.Getenv("DEBUGLOGS") == "true" {
			log.Printf("Refresh: extractUserID failed: %v", err)
		}
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token payload"})
		return
	}

	tokenVersion, _ := claims["password_version"].(string)
	var user models.User
	if err := config.DB.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User no longer exists"})
		return
	}
	if tokenVersion != user.PasswordVersion {
		if os.Getenv("DEBUGLOGS") == "true" {
			log.Printf("Refresh: revoked! DB version: %q, Token version: %q", user.PasswordVersion, tokenVersion)
		}
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Session revoked due to password change"})
		return
	}

	newAccessToken, err := GenerateAccessToken(userID, user.PasswordVersion)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate access token"})
		return
	}

	newRefreshToken, err := GenerateRefreshToken(userID, user.PasswordVersion)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate refresh token"})
		return
	}

	if clientPrefersCookieAuth(c) {
		setAuthCookies(c, newAccessToken, newRefreshToken)
		c.JSON(http.StatusOK, gin.H{})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token":         newAccessToken,
		"refresh_token": newRefreshToken,
	})
}
