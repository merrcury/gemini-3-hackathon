# Google Cloud OAuth Setup Guide

## Error: redirect_uri_mismatch

If you're seeing the error "Error 400: redirect_uri_mismatch" from Google, follow these steps:

## Fix: Add Redirect URI to Google Cloud Console

### 1. Go to Google Cloud Console

Visit: https://console.cloud.google.com/apis/credentials

### 2. Find Your OAuth Client

- Click on your OAuth 2.0 Client ID (the one you're using for this project)
- You should see it listed under "OAuth 2.0 Client IDs"

### 3. Add the Redirect URI

**Add this EXACT URI to the "Authorized redirect URIs" section:**

```
http://localhost:8000
```

**Important Notes:**
- Must be exactly `http://localhost:8000` (no trailing slash!)
- Port 8000 is for OAuth callback (MCP server runs on port 3000)
- Google requires the redirect URI to match exactly

### 4. Click "Save"

Wait a few seconds for changes to propagate.

### 5. Try Again

Run the `auth_setup` tool again in Claude Desktop. The browser should open and allow you to authenticate.

## Alternative: Use Different Port

If port 8080 is already in use, you can:

1. Add a different redirect URI in Google Cloud Console (e.g., `http://localhost:8081`)
2. Update the code in `server.py` to use that port:
   ```python
   creds = flow.run_local_server(port=8081, open_browser=True)
   ```

## Complete OAuth Client Setup

Your OAuth client should have these settings:

**Application type:** Desktop app (or Web application)

**Authorized redirect URIs:**
- `http://localhost:8000` (for the auth_setup tool)

**APIs Enabled:**
- Gmail API
- Google Drive API  
- Google Calendar API
- People API (for Contacts)

## Verification

After adding the redirect URI:

1. Run the MCP server: `uv run server.py`
2. In Claude Desktop, use the `auth_setup` tool
3. A browser window should open
4. Sign in with Google
5. Grant permissions
6. You should see "Successfully authenticated!"

## Troubleshooting

### "This app isn't verified"

This is normal for development. Click "Advanced" → "Go to [Your App Name] (unsafe)" to proceed.

### Port Already in Use

If port 8000 is taken, the error will mention it. Use a different port (8001, 8080, etc.) and update both:
1. The redirect URI in Google Cloud Console
2. The port number in `server.py` (in the `auth_setup` tool)

### Still Not Working?

1. Double-check the redirect URI is EXACTLY `http://localhost:8000`
2. Make sure you clicked "Save" in Google Cloud Console
3. Wait 30-60 seconds after saving
4. Try again
5. Check that you're using the correct OAuth Client ID in your `.env` file
