package handlers

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"journal-app/config"
	"journal-app/models"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

var (
	AccessTokenCookie  = "access_token"
	RefreshTokenCookie = "refresh_token"
	ResetTokenCookie   = "reset_token"
	CookieMaxAge       = 15 * 60           // 15 minutes in seconds
	RefreshMaxAge      = 30 * 24 * 60 * 60 // 30 days in seconds
	ResetTokenMaxAge   = 5 * 60            // 5 minutes in seconds
	jwtKey             []byte
)

func InitJWTKey() error {
	secret := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	if secret == "" {
		return errors.New("JWT_SECRET must be set")
	}

	if len(secret) < 32 {
		return errors.New("JWT_SECRET must be at least 32 characters long")
	}

	weakSecrets := map[string]struct{}{
		"your-secret-key-change-this": {},
		"changeme":                    {},
		"change-me":                   {},
		"secret":                      {},
		"jwt-secret":                  {},
	}
	if _, isWeak := weakSecrets[strings.ToLower(secret)]; isWeak {
		return errors.New("JWT_SECRET must not use a placeholder or weak default value")
	}

	jwtKey = []byte(secret)
	return nil
}

func getJWTKey() []byte {
	return jwtKey
}

func extractTokenFromCookieOrHeader(c *gin.Context, cookieName string) (string, error) {
	token, err := c.Cookie(cookieName)
	if err == nil && token != "" {
		return token, nil
	}

	authHeader := c.GetHeader("Authorization")
	if authHeader == "" {
		return "", errors.New("authentication required")
	}

	if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
		return authHeader[7:], nil
	}

	return "", errors.New("invalid authorization format")
}

func GenerateAccessToken(userID uint, passwordVersion string) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id":          userID,
		"password_version": passwordVersion,
		"exp":              time.Now().Add(time.Minute * 15).Unix(),
		"type":             "access",
	})

	return token.SignedString(getJWTKey())
}

func GenerateRefreshToken(userID uint, passwordVersion string) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id":          userID,
		"password_version": passwordVersion,
		"exp":              time.Now().Add(time.Hour * 24 * 30).Unix(),
		"type":             "refresh",
	})

	return token.SignedString(getJWTKey())
}

func GenerateShortLivedToken(userID uint, passwordVersion string, sensitiveActionVersion string) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id":                  userID,
		"password_version":         passwordVersion,
		"sensitive_action_version": sensitiveActionVersion,
		"exp":                      time.Now().Add(time.Minute * 5).Unix(),
		"type":                     "short",
	})

	return token.SignedString(getJWTKey())
}

func ValidateJWT(tokenString string) (jwt.MapClaims, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return getJWTKey(), nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
		return claims, nil
	}

	return nil, errors.New("invalid token")
}

func ValidateRefreshToken(tokenString string) (jwt.MapClaims, error) {
	claims, err := ValidateJWT(tokenString)
	if err != nil {
		return nil, err
	}

	tokenType, ok := claims["type"].(string)
	if !ok || tokenType != "refresh" {
		return nil, errors.New("refresh token required")
	}

	return claims, nil
}

func ValidateShortLivedToken(tokenString string) (jwt.MapClaims, error) {
	claims, err := ValidateJWT(tokenString)
	if err != nil {
		return nil, err
	}

	tokenType, ok := claims["type"].(string)
	if !ok || tokenType != "short" {
		return nil, errors.New("short-lived token required for this operation")
	}

	return claims, nil
}

func extractUserIDFromClaims(claims jwt.MapClaims) (uint, error) {
	rawUserID, ok := claims["user_id"]
	if !ok {
		return 0, errors.New("token is missing user_id")
	}

	userIDFloat, ok := rawUserID.(float64)
	if !ok {
		return 0, fmt.Errorf("token user_id has unexpected type %T", rawUserID)
	}

	if userIDFloat <= 0 || userIDFloat != float64(uint(userIDFloat)) {
		return 0, errors.New("token user_id is invalid")
	}

	return uint(userIDFloat), nil
}

func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		token, err := extractTokenFromCookieOrHeader(c, AccessTokenCookie)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
			return
		}

		claims, err := ValidateJWT(token)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
			return
		}

		tokenType, ok := claims["type"].(string)
		if !ok || tokenType != "access" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Access token required"})
			return
		}

		userID, err := extractUserIDFromClaims(claims)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
			return
		}

		tokenVersion, _ := claims["password_version"].(string)

		var user models.User
		if err := config.DB.First(&user, userID).Error; err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "User no longer exists"})
			return
		}
		if tokenVersion != user.PasswordVersion {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Session revoked due to password change"})
			return
		}
		c.Set("user_id", userID)
		c.Next()
	}
}

func ShortLivedAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		token, err := extractTokenFromCookieOrHeader(c, ResetTokenCookie)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
			return
		}

		claims, err := ValidateShortLivedToken(token)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
			return
		}

		userID, err := extractUserIDFromClaims(claims)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
			return
		}

		tokenVersion, _ := claims["password_version"].(string)
		sensitiveActionVersion, _ := claims["sensitive_action_version"].(string)

		var user models.User
		if err := config.DB.First(&user, userID).Error; err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "User no longer exists"})
			return
		}
		if tokenVersion != user.PasswordVersion {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Session revoked due to password change"})
			return
		}
		if sensitiveActionVersion == "" || sensitiveActionVersion != user.SensitiveActionVersion {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Sensitive action verification has already been used or replaced"})
			return
		}

		c.Set("user_id", userID)
		c.Next()
	}
}

func normalizeHost(host string) string {
	host = strings.TrimSpace(strings.ToLower(host))
	if host == "" {
		return ""
	}

	if parsedHost, _, err := net.SplitHostPort(host); err == nil {
		host = parsedHost
	}

	return strings.Trim(host, "[]")
}

func isLocalHost(host string) bool {
	if host == "localhost" {
		return true
	}
	return net.ParseIP(host) != nil
}

func useSecureCookies() bool {
	override := strings.TrimSpace(os.Getenv("LOCALHOST_DEV_COOKIES"))
	if override == "" {
		return true
	}

	enabled, err := strconv.ParseBool(override)
	if err != nil {
		return true
	}

	if enabled {
		return false
	}

	return true
}

func resolveCookieDomain(requestHost string) string {
	host := normalizeHost(requestHost)
	if host == "" || isLocalHost(host) {
		return ""
	}

	allowlistEnv := strings.TrimSpace(os.Getenv("COOKIE_DOMAIN_ALLOWLIST"))
	if allowlistEnv == "" {
		return ""
	}

	for _, rawEntry := range strings.Split(allowlistEnv, ",") {
		entry := strings.ToLower(strings.TrimSpace(rawEntry))
		if entry == "" {
			continue
		}

		normalizedEntry := strings.TrimPrefix(entry, ".")
		if normalizedEntry == "" || isLocalHost(normalizedEntry) {
			continue
		}

		if host == normalizedEntry || strings.HasSuffix(host, "."+normalizedEntry) {
			if entry[0] == '.' {
				return "." + normalizedEntry
			}
			return normalizedEntry
		}
	}

	return ""
}

func setAuthCookies(c *gin.Context, accessToken string, refreshToken string) {
	// For development, Secure can be false.
	// For production, use true to enforce HTTPS
	secure := useSecureCookies()
	domain := resolveCookieDomain(c.Request.Host)

	c.SetSameSite(http.SameSiteLaxMode) // Lax is better for most use cases

	setCookieWithSettings(c, AccessTokenCookie, accessToken, CookieMaxAge, domain, secure)
	if refreshToken != "" {
		setCookieWithSettings(c, RefreshTokenCookie, refreshToken, RefreshMaxAge, domain, secure)
	}
	// Clear any prior short-lived verification cookie on normal login/register.
	setCookieWithSettings(c, ResetTokenCookie, "", -1, domain, secure)
}

func clearAuthCookies(c *gin.Context) {
	domain := resolveCookieDomain(c.Request.Host)
	secure := useSecureCookies()

	c.SetSameSite(http.SameSiteLaxMode) // Match the SameSite setting from setAuthCookies
	setCookieWithSettings(c, AccessTokenCookie, "", -1, domain, secure)
	setCookieWithSettings(c, RefreshTokenCookie, "", -1, domain, secure)
	setCookieWithSettings(c, ResetTokenCookie, "", -1, domain, secure)
}

func setResetTokenCookie(c *gin.Context, resetToken string) {
	domain := resolveCookieDomain(c.Request.Host)
	secure := useSecureCookies()
	c.SetSameSite(http.SameSiteLaxMode)
	setCookieWithSettings(c, ResetTokenCookie, resetToken, ResetTokenMaxAge, domain, secure)
}

func setCookieWithSettings(c *gin.Context, name string, value string, maxAge int, domain string, secure bool) {
	c.SetCookie(name, value, maxAge, "/", domain, secure, true)
}
