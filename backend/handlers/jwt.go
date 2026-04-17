package handlers

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"

	"journal-app/config"
	"journal-app/models"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

var (
	AccessTokenCookie   = "access_token"
	RefreshTokenCookie  = "refresh_token"
	ResetTokenCookie    = "reset_token"
	CookieMaxAge        = 15 * 60           // 15 minutes in seconds
	RefreshMaxAge       = 30 * 24 * 60 * 60 // 30 days in seconds
	ResetTokenMaxAge    = 5 * 60            // 5 minutes in seconds
	jwtLegacyKey        []byte
	jwtActiveKID        string
	jwtSigningKey       []byte
	jwtVerificationKeys map[string][]byte
)

func validateJWTSecretValue(secret string, source string) error {
	if len(secret) < 32 {
		return fmt.Errorf("%s must be at least 32 characters long", source)
	}

	weakSecrets := map[string]struct{}{
		"your-secret-key-change-this": {},
		"changeme":                    {},
		"change-me":                   {},
		"secret":                      {},
		"jwt-secret":                  {},
	}
	if _, isWeak := weakSecrets[strings.ToLower(secret)]; isWeak {
		return fmt.Errorf("%s must not use a placeholder or weak default value", source)
	}

	return nil
}

func InitJWTKey() error {
	jwtLegacyKey = nil
	jwtActiveKID = ""
	jwtSigningKey = nil
	jwtVerificationKeys = make(map[string][]byte)

	legacySecret := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	if legacySecret != "" {
		if err := validateJWTSecretValue(legacySecret, "JWT_SECRET"); err != nil {
			return err
		}
		jwtLegacyKey = []byte(legacySecret)
	}

	keysEnv := strings.TrimSpace(os.Getenv("JWT_KEYS"))
	if keysEnv == "" {
		if len(jwtLegacyKey) == 0 {
			return errors.New("JWT_SECRET must be set, or configure JWT_ACTIVE_KID with JWT_KEYS")
		}
		return nil
	}

	jwtActiveKID = strings.TrimSpace(os.Getenv("JWT_ACTIVE_KID"))
	if jwtActiveKID == "" {
		return errors.New("JWT_ACTIVE_KID must be set when JWT_KEYS is configured")
	}

	for _, rawEntry := range strings.Split(keysEnv, ",") {
		entry := strings.TrimSpace(rawEntry)
		if entry == "" {
			continue
		}

		kid, secret, ok := strings.Cut(entry, ":")
		if !ok {
			return fmt.Errorf("invalid JWT_KEYS entry %q: expected kid:secret", entry)
		}

		kid = strings.TrimSpace(kid)
		secret = strings.TrimSpace(secret)
		if kid == "" {
			return errors.New("JWT_KEYS entries must include a non-empty kid")
		}
		if secret == "" {
			return fmt.Errorf("JWT_KEYS entry %q is missing a secret", kid)
		}
		if err := validateJWTSecretValue(secret, fmt.Sprintf("JWT_KEYS entry %q", kid)); err != nil {
			return err
		}
		if _, exists := jwtVerificationKeys[kid]; exists {
			return fmt.Errorf("JWT_KEYS contains duplicate kid %q", kid)
		}

		jwtVerificationKeys[kid] = []byte(secret)
	}

	if len(jwtVerificationKeys) == 0 {
		return errors.New("JWT_KEYS must contain at least one key")
	}

	signingKey, ok := jwtVerificationKeys[jwtActiveKID]
	if !ok {
		kids := make([]string, 0, len(jwtVerificationKeys))
		for kid := range jwtVerificationKeys {
			kids = append(kids, kid)
		}
		slices.Sort(kids)
		return fmt.Errorf("JWT_ACTIVE_KID %q was not found in JWT_KEYS (%s)", jwtActiveKID, strings.Join(kids, ", "))
	}

	jwtSigningKey = signingKey
	return nil
}

func getJWTSigningKey() ([]byte, string) {
	if len(jwtSigningKey) > 0 && jwtActiveKID != "" {
		return jwtSigningKey, jwtActiveKID
	}
	return jwtLegacyKey, ""
}

func getJWTVerificationKey(token *jwt.Token) (interface{}, error) {
	if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
		return nil, errors.New("unexpected signing method")
	}

	kid, _ := token.Header["kid"].(string)
	if kid != "" {
		key, ok := jwtVerificationKeys[kid]
		if !ok {
			return nil, fmt.Errorf("unknown signing key id %q", kid)
		}
		return key, nil
	}

	if len(jwtLegacyKey) == 0 {
		return nil, errors.New("token is missing kid and no legacy JWT_SECRET is configured")
	}

	return jwtLegacyKey, nil
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

	signingKey, kid := getJWTSigningKey()
	if kid != "" {
		token.Header["kid"] = kid
	}

	return token.SignedString(signingKey)
}

func GenerateRefreshToken(userID uint, passwordVersion string) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id":          userID,
		"password_version": passwordVersion,
		"exp":              time.Now().Add(time.Hour * 24 * 30).Unix(),
		"type":             "refresh",
	})

	signingKey, kid := getJWTSigningKey()
	if kid != "" {
		token.Header["kid"] = kid
	}

	return token.SignedString(signingKey)
}

func GenerateShortLivedToken(userID uint, passwordVersion string, sensitiveActionVersion string) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id":                  userID,
		"password_version":         passwordVersion,
		"sensitive_action_version": sensitiveActionVersion,
		"exp":                      time.Now().Add(time.Minute * 5).Unix(),
		"type":                     "short",
	})

	signingKey, kid := getJWTSigningKey()
	if kid != "" {
		token.Header["kid"] = kid
	}

	return token.SignedString(signingKey)
}

func ValidateJWT(tokenString string) (jwt.MapClaims, error) {
	token, err := jwt.Parse(tokenString, getJWTVerificationKey)

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
