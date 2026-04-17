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
- `JWT_SECRET` (Legacy single signing key. Must be at least 32 characters long. Do not use placeholders)
- `JWT_ACTIVE_KID` and `JWT_KEYS` (Optional multi-key rotation config for seamless key rollover)
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

## 6. Docker Setup
If you want to run the full stack with Docker instead of managing Go, Vite, and PostgreSQL separately, use the bundled Compose file.

### Prepare the Docker environment
```bash
cd docker
cp .env.localhost.example .env.localhost
```
Update at least these values in `docker/.env.localhost`:
- `JWT_SECRET`
- `JWT_ACTIVE_KID`
- `JWT_KEYS`
- `INITIAL_ADMIN_EMAIL`
- `INITIAL_ADMIN_PASSWORD`
- `DB_PASSWORD` / `POSTGRES_PASSWORD` if you do not want the local defaults
- `LOCALHOST_DEV_COOKIES` should stay `true` for plain HTTP localhost Docker usage

### Start the stack
From the repository root:
```bash
docker compose -f docker/docker-compose.yml up --build -d
```
This starts:
- Nginx frontend on port `80`
- Go backend on port `8080` inside the Docker network
- PostgreSQL in a named volume

### Access the app
Open `http://localhost` in your browser.

### Stop the stack
```bash
docker compose -f docker/docker-compose.yml down
```

If you also want to remove the database volume:
```bash
docker compose -f docker/docker-compose.yml down -v
```
