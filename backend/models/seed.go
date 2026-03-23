package models

import (
	"crypto/rand"
	"encoding/hex"
	"log"
	"os"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

func SeedInitialData(db *gorm.DB) {
	// 0. Backfill password_version for any pre-migration users
	result := db.Model(&User{}).Where("password_version IS NULL OR password_version = ''").Updates(map[string]any{
		"password_version": uuid.New().String(),
	})
	if result.RowsAffected > 0 {
		log.Printf("Backfilled password_version for %d existing user(s)", result.RowsAffected)
	}

	// 1. Seed System Config
	var configCount int64
	db.Model(&SystemConfig{}).Count(&configCount)
	if configCount == 0 {
		db.Create(&SystemConfig{Key: "registration_enabled", Value: "true"})
		log.Println("Seeded default system configuration")
	}

	// 2. Seed Admin User
	var adminCount int64
	db.Model(&User{}).Where("is_admin = ?", true).Count(&adminCount)
	if adminCount == 0 {
		adminEmail := os.Getenv("INITIAL_ADMIN_EMAIL")
		if adminEmail == "" {
			adminEmail = "admin@journal.app"
		}

		adminPass := os.Getenv("INITIAL_ADMIN_PASSWORD")
		if adminPass == "" {
			bytes := make([]byte, 16)
			rand.Read(bytes) // ignore err for simplicity
			adminPass = hex.EncodeToString(bytes)
		}

		hashedPassword, _ := bcrypt.GenerateFromPassword([]byte(adminPass), bcrypt.DefaultCost)
		admin := User{
			Username:        "Admin",
			Email:           adminEmail,
			Password:        string(hashedPassword),
			PasswordVersion: uuid.New().String(),
			IsAdmin:         true,
		}
		db.Create(&admin)

		if os.Getenv("INITIAL_ADMIN_PASSWORD") == "" {
			log.Printf("Seeded initial admin user: %s / %s (Auto-generated password - please change immediately!)", adminEmail, adminPass)
		} else {
			log.Printf("Seeded initial admin user: %s (Password provided via environment variable)", adminEmail)
		}
	}
}
