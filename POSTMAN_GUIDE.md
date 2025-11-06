# Postman Collection Guide

## Importing the Collection

1. Open Postman
2. Click **Import** button (top left)
3. Select the `postman_collection.json` file from this directory
4. The collection "AMEFIS Mail Gateway API" will be imported with all endpoints

## Collection Variables

The collection uses variables for easy testing. They are automatically populated by test scripts:

- `{{baseUrl}}` - API base URL (default: `http://localhost:4001`)
- `{{sessionToken}}` - Session token (auto-saved after login)
- `{{folderId}}` - Folder ID (auto-saved when listing folders)
- `{{messageId}}` - Message ID (auto-saved when listing messages)
- `{{attachmentId}}` - Attachment ID (auto-saved when viewing message details)

### Customizing Variables

To change variables:
1. Click on the collection name
2. Go to **Variables** tab
3. Edit the **Current Value** column
4. Click **Save**

Common changes:
- Set `baseUrl` to your server URL: `https://api.example.com`
- Manually set IDs if needed

## Testing Workflow

### 1. Check Service Health

Run **Health Check > Get Health Status**
- No authentication required
- Verifies service is running

### 2. Login

Run **Authentication > Login - Default IMAP Server**
- Edit the request body with your email and password
- The session token is automatically saved to collection variables
- Valid for 2 hours with sliding window

**For Gmail:**
Use **Login - Custom IMAP Server** with:
```json
{
  "email": "your-email@gmail.com",
  "password": "your-app-password",
  "host": "imap.gmail.com",
  "port": 993,
  "secure": true
}
```

**Note:** Gmail requires an [App Password](https://support.google.com/accounts/answer/185833) if 2FA is enabled.

### 3. List Folders

Run **Folders > Get All Folders**
- Automatically saves the first folder ID
- Shows all mailbox folders with special-use flags

### 4. View Messages

Run **Messages > Get Messages - First Page**
- Uses the saved folder ID
- Automatically saves the first message ID
- Returns 50 messages by default

### 5. View Message Details

Run **Messages > Get Single Message - Full Details**
- Uses the saved message ID
- Returns full HTML content, attachments, etc.
- Automatically saves first attachment ID

### 6. Download Attachment

Run **Attachments > Download Attachment**
- Uses the saved attachment ID
- Streams the file

## Request Examples by Scenario

### Scenario 1: Mark Multiple Messages as Read

1. Get messages: **Messages > Get Messages - First Page**
2. Copy a message ID
3. Run **Messages > Update Flags - Mark as Read**
4. Repeat for each message

### Scenario 2: Search and Archive

1. Run **Search > Search - Simple Query** with query: "newsletter"
2. Copy message IDs from results
3. Get archive folder ID from **Folders > Get All Folders**
4. Run **Messages > Move Message to Folder** for each message

### Scenario 3: Clean Up Spam

1. Get messages from spam folder
2. Run **Messages > Delete Message - Hard (Permanent)** for each
3. Permanently removes messages

### Scenario 4: Monitor Real-time Updates

1. Open a new tab/window
2. Run **Server-Sent Events > Connect to Event Stream**
3. Keep the request running
4. In another window, perform actions (mark as read, move, etc.)
5. See real-time events in the SSE response

**Note:** Postman's SSE support is limited. For better SSE testing, use a browser or curl:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:4001/events
```

## Testing Pagination

1. Run **Messages > Get Messages - First Page**
2. Note the last message's `uid` value
3. Run **Messages > Get Messages - With Pagination**
4. Set `cursorUid` to the noted value
5. Get next page of results

## Testing Search Features

### Full-text Search
- **Search - Simple Query**: Single word in subject/body
- **Search - Multi-word Query**: Multiple words with relevance ranking

### Email Search
- **Search - Email Address**: Find all messages from/to an address

### Partial Match
- **Search - Partial Match**: Type "meet" to find "meeting", "meetings", etc.

## Error Scenarios

Test error handling with the **Error Scenarios** folder:

1. **Unauthorized - No Token**: Test without authentication
2. **Invalid Token**: Test with expired/invalid token
3. **Message Not Found**: Test with non-existent UUID
4. **Missing Required Parameter**: Test validation

## Rate Limiting

The API has rate limits:
- **Login**: 5 attempts per 15 minutes
- **Attachments**: 100 downloads per minute

To test rate limiting:
1. Run login 6 times quickly
2. Observe 429 Too Many Requests error

## Best Practices

### 1. Logout When Done
Always run **Authentication > Logout** when finished testing to:
- Close IMAP connections
- Clean up cached data
- Free server resources

### 2. Use Environment for Multiple Servers
Create Postman environments for different servers:
- **Development**: `http://localhost:4001`
- **Staging**: `https://staging-api.example.com`
- **Production**: `https://api.example.com`

### 3. Script Variables
The collection includes test scripts that auto-save IDs. Check the **Tests** tab in requests to see the scripts.

### 4. Debugging
Enable Postman Console (View > Show Postman Console) to see:
- Test script console.log output
- Detailed request/response info
- Errors and warnings

## Common Issues

### "Authorization header required"
- Make sure you've run the login request first
- Check that `{{sessionToken}}` variable is set
- Session expires after 2 hours of inactivity

### "Message not found"
- The message may have been moved/deleted
- Get a fresh message ID by listing messages again
- Check you're using the correct folder

### "folderId is required"
- Run **Get All Folders** first to populate `{{folderId}}`
- Or manually set the variable with a valid folder UUID

### Connection timeout
- Check service is running: `npm run dev`
- Verify baseUrl is correct
- Check firewall/network settings

## Advanced: Using with Newman (CLI)

Run the collection from command line:

```bash
# Install Newman
npm install -g newman

# Run collection
newman run postman_collection.json \
  --env-var "baseUrl=http://localhost:4001" \
  --env-var "email=user@example.com" \
  --env-var "password=your_password"
```

## Support

For API issues, check:
- Server logs in console
- README.md for setup instructions
- CHECKLIST.md for deployment verification

