package main

import (
	"fmt"
	"journal-app/config"
	"journal-app/models"
	"log"

	"github.com/joho/godotenv"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	err := godotenv.Load()
	if err != nil {
		log.Println("Warning: .env file not found")
	}

	config.ConnectDB()

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte("testpassword123"), bcrypt.DefaultCost)
	if err != nil {
		log.Fatal("Failed to hash password:", err)
	}

	testUser := models.User{
		Email:    "test@example.com",
		Username: "testuser",
		Password: string(hashedPassword),
	}

	var existingUser models.User
	result := config.DB.Where("email = ?", testUser.Email).First(&existingUser)

	if result.Error == nil {
		fmt.Println("Test user already exists!")
		fmt.Println("\n📋 Test Credentials:")
		fmt.Println("========================================")
		fmt.Println("Email:    test@example.com")
		fmt.Println("Password: testpassword123")
		fmt.Println("Username: testuser")
		fmt.Println("========================================")
		fmt.Println("\n⚠️  Encryption Key: You'll need to generate your own key after logging in!")
		fmt.Println("   Run: `node -e \"const crypto = require('crypto'); console.log(crypto.randomBytes(32).toString('hex'));\"`")
		return
	}

	if result := config.DB.Create(&testUser); result.Error != nil {
		log.Fatal("Failed to create test user:", result.Error)
	}

	fmt.Println("✅ Test user created successfully!")
	fmt.Println("\n📋 Test Credentials:")
	fmt.Println("========================================")
	fmt.Println("Email:    test@example.com")
	fmt.Println("Password: testpassword123")
	fmt.Println("Username: testuser")
	fmt.Println("========================================")
	fmt.Println("\n⚠️  IMPORTANT: Generate your encryption key with this command:")
	fmt.Println("   node -e \"const crypto = require('crypto'); console.log(crypto.randomBytes(32).toString('hex'));\"")
	fmt.Println("   Copy the output (64 hex characters) and use it when logging in!")
}
