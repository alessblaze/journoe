package models

import (
	"time"

	"gorm.io/gorm"
)

type User struct {
	ID        uint           `json:"id" gorm:"primaryKey"`
	Email     string         `json:"email" gorm:"uniqueIndex;not null"`
	Username  string         `json:"username" gorm:"not null"`
	Password        string         `json:"-" gorm:"not null"`
	PasswordVersion string         `json:"-"`
	IsAdmin         bool           `json:"is_admin" gorm:"default:false"`
	KeyFingerprint string         `json:"key_fingerprint,omitempty" gorm:"size:64"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `json:"-" gorm:"index"`
}

type SystemConfig struct {
	ID    uint   `gorm:"primaryKey"`
	Key   string `gorm:"uniqueIndex;not null"`
	Value string `gorm:"not null"`
}

type JournalEntry struct {
	ID        uint           `json:"id" gorm:"primaryKey"`
	UserID    uint           `json:"user_id" gorm:"index;not null"`
	Title     string         `json:"title" gorm:"size:4096;not null"`
	Content   string         `json:"content" gorm:"type:text;not null;check:content_length_max,char_length(content) <= 262144"`
	Mood      string         `json:"mood" gorm:"size:255"`
	IsSticky  bool           `json:"is_sticky" gorm:"default:false"`
	Version   int            `json:"version" gorm:"default:1"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `json:"-" gorm:"index"`
}
