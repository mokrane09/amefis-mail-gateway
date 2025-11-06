# Deployment Checklist

## Prerequisites
- [ ] Node.js 16+ installed
- [ ] PostgreSQL 12+ installed and running
- [ ] IMAP server accessible (port 993)

## Setup Steps

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Configuration
```bash
cp .env.example .env
# Edit .env with your database and IMAP settings
```

### 3. Database Setup
```bash
# Create database
createdb mailcache

# Run migrations
npm run migrate:latest
```

### 4. Verify Setup
- [ ] PostgreSQL connection works
- [ ] Database tables created (sessions, folders, messages, attachments)
- [ ] pg_trgm extension enabled
- [ ] Attachment directory created (./data by default)

### 5. Start Service
```bash
# Development
npm run dev

# Production
npm start
```

### 6. Test Endpoints
```bash
# Health check
curl http://localhost:4001/health

# Login (replace with real credentials)
curl -X POST http://localhost:4001/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password"}'
```

## Runtime Verification
- [ ] Server starts without errors
- [ ] Database connection established
- [ ] Sync engine started
- [ ] Can login via /login endpoint
- [ ] IMAP connection established
- [ ] Messages preloaded from INBOX
- [ ] Folders listed correctly
- [ ] Attachments stored in ./data
- [ ] SSE connection works
- [ ] Session expires after 2 hours inactivity

## Production Deployment
- [ ] Set NODE_ENV=production in .env
- [ ] Use process manager (PM2, systemd)
- [ ] Configure reverse proxy (nginx, caddy)
- [ ] Set up SSL/TLS certificates
- [ ] Configure firewall rules
- [ ] Set up log rotation
- [ ] Configure backup for PostgreSQL
- [ ] Monitor disk space (./data grows with attachments)

## Security Checklist
- [ ] PostgreSQL password changed from default
- [ ] CORS origins configured appropriately
- [ ] Rate limits adjusted for your use case
- [ ] Helmet headers reviewed
- [ ] .env file not committed to git
- [ ] Attachment directory not publicly accessible
- [ ] Database port not exposed publicly

## Troubleshooting
- Check logs in console (structured JSON format)
- Verify PostgreSQL connection: `psql -h localhost -U postgres -d mailcache`
- Check IMAP connectivity: `openssl s_client -connect mail.example.com:993`
- Verify migrations: `npm run migrate:status`
- Check disk space for attachments: `du -sh data/`

