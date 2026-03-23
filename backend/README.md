# Backend Service

This is the Go (Gin/Gorm) backend for the Journal App. It provides an encrypted, strict Optimistic Concurrency Control (OCC) REST API for managing users and entries.

## Tech Stack
- **Go 1.21+**
- **Gin** (Web Framework)
- **Gorm** (PostgreSQL ORM)
- **JWT** (Authentication)

## Getting Started

1. Create a PostgreSQL database (e.g., `journal_app`).
2. Copy `.env.example` to `.env` and fill in the DB credentials, `JWT_SECRET`, and `COOKIE_DOMAIN_ALLOWLIST`.
3. Run the development server:
   ```bash
   go mod download
   go run main.go
   ```
The backend API runs on `http://localhost:8080`.
