# Journal

![Journoe banner](./journoe-banner.png)

A highly secure, offline-first personal journaling web application featuring double-ratchet style client-side encryption, real-time optimistic concurrency control, and multi-device session handoff.

Journoe is alpha. there can be bugs and vulnerablities.

Built with **React** (TypeScript, Vite) and **Go** (Gin, gorm) with a **PostgreSQL** database.

## Architecture & Security
- **Client-Side Encryption:** Entry content and titles are strictly encrypted in the browser using AES-GCM (via Web Crypto API) before touching the network.
- **Derived Device Keys:** The 64-character encryption key is never sent to the backend. It is stored PBKDF2-wrapped in the browser's `IndexedDB` locked behind the user's password.
- **Key Fingerprinting:** Device keys are SHA-256 fingerprinted and verified by the Go backend to prevent stale payload decryption after factory resets.
- **Active Push Session Handoff:** In strict single-tab mode, duplicate tabs wait in a lock screen. When the active tab closes, it instantly broadcasts the in-memory device key via `BroadcastChannel` to the waiting tab for a completely seamless session takeover without disk persistence.
- **Optimistic Concurrency Control (OCC):** The backend strictly enforces version numbers on all saves. If multiple browsers edit the same entry, Server-Sent Events (SSE) instantly merge the list states and protect the `Create` and `Edit` shadow trackers from overwriting each other, firing a robust 409 Conflict rejection if races occur.

## Local Development Setup

### 1. Database
Ensure PostgreSQL is running on your machine with a database created for the app.
```bash
# Default credentials in .env.example
psql -U postgres -c "CREATE DATABASE journal_app;"
```

### 2. Backend (Go)
```bash
cd backend
cp .env.example .env
# Edit .env to set your JWT secret configuration and COOKIE_DOMAIN_ALLOWLIST
go mod download
go run main.go
```
The backend runs on port `:8080`.

### 3. Frontend (React/Vite)
```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```
The frontend runs on port `:5173`. Open `http://localhost:5173` in your browser.

## Docker Setup

The Docker stack runs the frontend, backend, and PostgreSQL together through [docker/docker-compose.yml](./docker/docker-compose.yml).

### 1. Prepare Docker environment
```bash
cd docker
cp .env.localhost.example .env.localhost
# Edit .env.localhost to change JWT secret configuration, admin credentials, or DB passwords
```

### 2. Start the stack
```bash
docker compose -f docker/docker-compose.yml up --build -d
```

### 3. Open the app
Visit `http://localhost` in your browser.

### 4. Stop the stack
```bash
docker compose -f docker/docker-compose.yml down
```

The PostgreSQL data is stored in the named Docker volume `postgres_data`.
