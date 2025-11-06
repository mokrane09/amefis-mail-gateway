# AMEFIS Mail Gateway

Production-ready Node.js IMAP gateway service exposing REST APIs for email management.

## Features

- Session-based IMAP access with 2-hour TTL
- Real-time email sync with IDLE support
- Full-text search on messages
- HTML sanitization with inline image support
- Filesystem attachment storage
- Server-Sent Events for real-time updates
- PostgreSQL storage with Knex migrations
- No IMAP credentials stored at rest

## Prerequisites

- Node.js 16+ 
- PostgreSQL 12+
- IMAP server with TLS support (port 993)

## Installation

```bash
npm install
```

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```
PORT=4001
NODE_ENV=development
PGHOST=localhost
PGPORT=5432
PGDATABASE=mailcache
PGUSER=postgres
PGPASSWORD=yourpassword
ATTACH_BASE=./data
IMAP_DEFAULT_HOST=mail.example.com
IMAP_DEFAULT_SECURE=true
IMAP_DEFAULT_PORT=993
SESSION_DURATION_HOURS=2
```

### Session Configuration

**SESSION_DURATION_HOURS**: Controls how long sessions remain active (default: 2 hours)

**Session Behavior:**
- **Sliding Window Expiration**: Every authenticated request extends the session by SESSION_DURATION_HOURS from the current time
- **Session Reuse**: If a user logs in again with the same email/host while a session is still active, the existing session is reused instead of creating a new one
- **Automatic Cleanup**: Sessions that expire are automatically cleaned up (IMAP connection closed, cached data deleted)

Example: With `SESSION_DURATION_HOURS=2`:
- User logs in at 10:00 AM → session expires at 12:00 PM
- User makes a request at 11:00 AM → session now expires at 1:00 PM
- User makes a request at 12:30 PM → session now expires at 2:30 PM
- If inactive for 2 hours, session expires and is cleaned up

## Database Setup

Create the database:

```bash
createdb mailcache
```

Run migrations:

```bash
npm run migrate:latest
```

### Migration Commands

```bash
# Run all pending migrations
npm run migrate:latest

# Rollback last batch of migrations
npm run migrate:rollback

# Rollback all migrations
npm run migrate:rollback:all

# Fresh migration (rollback all + run all)
npm run migrate:fresh

# Check migration status
npm run migrate:status

# Create a new migration
npm run migrate:make migration_name
```

## Running

Development mode with auto-reload:

```bash
npm run dev
```

Production mode:

```bash
npm start
```

## API Endpoints

### Authentication

**POST /login**
- Body: `{ email, password, host?, port?, secure? }`
- Returns: `{ sessionToken, expiresAt, email, reused: boolean }`
- **Session Reuse**: If an active session exists for the same email/host, it will be reused (returns `reused: true`)
- **New Session**: If no active session exists, creates a new one (returns `reused: false`)

**POST /logout**
- Headers: `Authorization: Bearer <token>`
- Returns: 204 No Content

### Folders

**GET /folders**
- Returns: Array of folder objects

### Messages

**GET /messages?folderId=xxx&limit=50&cursorUid=xxx**
- Returns: Array of message summaries

**GET /messages/:id**
- Returns: Full message with HTML content and attachments

**PATCH /messages/:id/flags**
- Body: `{ add: ["\\Seen"], remove: [] }`

**POST /messages/:id/move**
- Body: `{ toFolderId: "uuid" }`

**DELETE /messages/:id**
- Body: `{ hard: false }`

### Attachments

**GET /attachments/:id?inline=1**
- Streams attachment file

### Search

**GET /search?q=query&limit=50**
- Returns: Array of matching messages

### Events (SSE)

**GET /events**
- Returns: Server-Sent Events stream
- Events: `{ type: "new"|"flags"|"moved"|"deleted", data: {...} }`

### Sync

**POST /sync/now**
- Triggers immediate sync of all folders
- Useful for testing or forcing immediate update
- Returns: `{ success: true, message: "Sync completed successfully" }`

## Architecture

- **IMAP Manager**: Handles IMAP connections with capability detection (IDLE, MOVE, CONDSTORE, QRESYNC)
- **Sync Engine**: Cron-based delta sync every minute
- **Session Store**: In-memory session management with automatic expiry
- **HTML Sanitizer**: Strips dangerous content and rewrites inline images
- **File Manager**: Safe filesystem operations for attachments

## Security

- Helmet for security headers
- CORS enabled
- Rate limiting on /login and /attachments
- Bearer token authentication
- HTML sanitization with allowlist
- Path traversal protection
- No credential persistence
