# 🧪 Test Credentials

## User Account
```
Email:    test@example.com
Password: testpassword123
Username: testuser
```

## 🔐 Test Encryption Key
```
d2c9fd057c513ee06a1bcd47a5025a2b4046504134e0e8d21fd13233ea8c79df
```

## 📝 How to Use

1. **Start the application:**
   ```bash
   # Backend
   cd journal-app/backend
   go run main.go

   # Frontend (new terminal)
   cd journal-app/frontend
   npm run dev
   ```

2. **Navigate to login page:** `http://localhost:5173/login`

3. **Enter credentials:**
   - Email: `test@example.com`
   - Password: `testpassword12345`

   Admin creds: `admin@journal.app`
   Admin pass: Check your backend terminal logs on first run for the auto-generated password!

4. **Enter encryption key:**
   - Copy the key above: `d2c9fd057c513ee06a1bcd47a5025a2b4046504134e0e8d21fd13233ea8c79df`
   - Paste it into the encryption key field
   - Click "Continue"

5. **Start journaling!** You'll be redirected to the dashboard where you can create encrypted journal entries.

## 🔄 Reset Database

To reset the database and remove test data:
```bash
# PostgreSQL
psql -U postgres -d journal -c "DROP TABLE IF EXISTS journal_entries CASCADE; DROP TABLE IF EXISTS users CASCADE;"

# Or drop and recreate the database
psql -U postgres -c "DROP DATABASE IF EXISTS journal;"
psql -U postgres -c "CREATE DATABASE journal;"

# Then run seed again
cd journal-app/backend
go run cmd/seed/main.go
```

## 🆕 Create New Test User

To create additional test users, modify `backend/cmd/seed/main.go` and re-run it, or use the registration form in the frontend.

## ⚠️ Important Notes

- This test encryption key is publicly documented here - **only use for testing!**
- In production, encryption keys are generated during registration and shown only once
- Never use these credentials for real data or production environments
- The test data will be encrypted with this specific key - you must use this same key to decrypt entries

## 🛠️ Additional Testing Commands

Generate new encryption keys:
```bash
node -e "const crypto = require('crypto'); console.log(crypto.randomBytes(32).toString('hex'));"
```

Check database contents:
```bash
psql -U postgres -d journal -c "SELECT * FROM users;"
psql -U postgres -d journal -c "SELECT * FROM journal_entries;"
```

Test API endpoints:
```bash
# Login
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpassword123"}'
```

## ✨ Happy Testing!

Use these credentials to explore the full functionality of the secure journal application without needing to register first.