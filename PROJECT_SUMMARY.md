# Project Summary: AMEFIS Mail Gateway

## Overview
Production-ready Node.js IMAP gateway service built with JavaScript (CommonJS). Exposes REST APIs for email management to a separate Laravel application.

## Tech Stack
- **Runtime**: Node.js with Express
- **Database**: PostgreSQL with Knex migrations
- **IMAP Client**: imapflow
- **Email Parsing**: mailparser (streaming)
- **Scheduling**: node-cron
- **HTML Sanitization**: sanitize-html
- **Security**: helmet, cors, express-rate-limit
- **Storage**: Filesystem for attachments, PostgreSQL for metadata

## Project Structure

```
/src
  /api
    auth.js           - Login/logout endpoints
    folders.js        - Folder listing
    messages.js       - Message CRUD operations
    attachments.js    - Attachment streaming
    search.js         - Full-text message search
    events.js         - Server-Sent Events for real-time updates
  /core
    db.js             - PostgreSQL connection pool
    knexfile.cjs      - Knex configuration
    /migrations       - Database schema migrations
    sessionStore.js   - In-memory session management
    imapManager.js    - IMAP operations wrapper
    syncEngine.js     - Background sync with cron
    html.js           - HTML sanitization & CID rewriting
    files.js          - Attachment filesystem operations
    logger.js         - Structured logging
  server.js           - Express app bootstrap
```

## Key Features Implemented

### 1. Session Management
- 2-hour sliding TTL per session
- In-memory storage (no IMAP credentials persisted)
- Automatic expiry and cleanup
- Cascade deletion of DB records and attachments

### 2. IMAP Capabilities
- Auto-detection of server capabilities (IDLE, MOVE, CONDSTORE, QRESYNC)
- IDLE support with 25-29 minute recycling
- Fallback mechanisms when capabilities unavailable
- TLS connection on port 993 by default

### 3. Email Processing
- Streams messages via mailparser (never buffers entire messages)
- Extracts envelope, flags, body (text/HTML), attachments
- Computes thread keys from References/In-Reply-To/Message-ID
- Stores attachments to disk organized by session and message

### 4. HTML & Security
- Sanitizes HTML with conservative allowlist
- Blocks remote images by default
- Rewrites cid: inline images to authenticated URLs
- Path traversal protection for attachments

### 5. Sync Engine
- Cron job every minute for active sessions
- Delta sync using CONDSTORE/QRESYNC when available
- Fallback to UIDNEXT-based polling
- Flag change detection on recent messages (last 1000 UIDs)
- Session expiry and cleanup

### 6. Search
- Full-text search on subject/body using tsvector
- Trigram similarity for partial matches (pg_trgm)
- Searches across from/to/cc/bcc addresses
- Combined query for comprehensive results

### 7. Real-time Updates
- Server-Sent Events endpoint
- Notifies clients of new mail, flag changes, moves, deletes
- Heartbeat every 20 seconds
- Automatic cleanup on disconnect

## API Endpoints

### Authentication
- `POST /login` - Connect to IMAP, preload 50 newest INBOX messages
- `POST /logout` - Disconnect IMAP, cleanup session

### Folders
- `GET /folders` - List all folders with special-use flags

### Messages
- `GET /messages` - List messages with pagination
- `GET /messages/:id` - Get full message with sanitized HTML
- `PATCH /messages/:id/flags` - Update flags (seen, flagged, etc.)
- `POST /messages/:id/move` - Move to another folder
- `DELETE /messages/:id` - Soft delete (to trash) or hard delete

### Attachments
- `GET /attachments/:id` - Stream attachment with optional inline display

### Search
- `GET /search?q=query` - Full-text and fuzzy search

### Events
- `GET /events` - SSE stream for real-time updates

## Security Features
- Helmet for HTTP security headers
- CORS enabled
- Rate limiting: 5 login attempts per 15 min, 100 attachment downloads per min
- Bearer token authentication
- No IMAP credentials stored at rest
- HTML sanitization with allowlist
- Path traversal protection

## Database Schema

### sessions
- Stores session metadata (email, host, timestamps)
- 2-hour expiry tracking

### folders
- Per-session folder list
- SPECIAL-USE flag detection
- UID validity and modseq tracking

### messages
- Full message metadata and flags
- tsvector columns for full-text search
- Trigram indexes for partial matching
- Thread key for conversation grouping

### attachments
- File metadata and disk paths
- CID tracking for inline images
- References session and message (cascade delete)

## Deployment Notes
- Single instance only (no clustering)
- Requires PostgreSQL 12+
- Requires Node.js 16+
- Run migrations before first start: `npm run migrate:latest`
- Configure .env with database and IMAP defaults
- Attachments stored in ./data by default (configurable)

## What's NOT Implemented
- SMTP/sending emails (per requirements)
- Clustering/horizontal scaling
- Multi-tenancy
- Email composition/drafts
- Advanced filtering/rules

## Operational Considerations
- IMAP connections maintained for duration of session
- Background sync every minute for all active sessions
- Attachments accumulate on disk; cleared on session expiry
- Database grows with message cache; old sessions auto-purge
- SSE connections kept alive with heartbeats
- IDLE recycled to avoid server timeouts

---

**Ready for local development and VPS deployment.**

