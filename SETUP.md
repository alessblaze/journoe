# Complete Setup Guide

Follow these instructions to deploy and run the Journal App in a local development environment.

## 1. Database Configuration
The backend relies on PostgreSQL. You must have PostgreSQL running securely.
```bash
# Example command to create the database via psql
psql -U postgres -c "CREATE DATABASE journal_app;"
```

## 2. Backend Environment Verification
Navigate to the `backend` folder and secure your environment variables.
```bash
cd backend
cp .env.example .env
```
Open `.env` and ensure the following critical fields are updated:
- `DB_USER` & `DB_PASSWORD` (Your local postgres credentials)
- `JWT_SECRET` (Must be at least 32 characters long. Do not use placeholders)
- `COOKIE_DOMAIN_ALLOWLIST` (Essential for preventing session hijacking)
- `DEBUGLOGS` (Set to "true" to trace token revocation and authentication issues)

## 3. Running the Go Server
Once the database and environment are set up, run the API:
```bash
go mod download
go run main.go
```
The server will bind to port `8080`. If successful, you will see output confirming the database migrated correctly.

## 4. Running the React Frontend
Open a new terminal session and navigate to the frontend folder.
```bash
cd frontend
npm install
npm run dev
```
Vite will start the client cleanly on `http://localhost:5173`.

## 5. End-to-End Test
1. Visit `http://localhost:5173`.
2. Register a new test user account.
3. The app will immediately generate an unrecoverable 64-character encryption key in your browser. Be sure to copy it down if you plan to test recovering sessions across multiple browsers!
