# Google Workspace MCP Server (Python)

A FastMCP-powered server providing AI assistants with access to Gmail, Google Drive, Google Calendar, and Google Contacts.

## Features

- 🔐 **OAuth Authentication**: Secure authentication via FastMCP v3 OAuth proxy
- ✉️ **Gmail**: List, read, send emails, get unread count
- 📁 **Google Drive**: List, search, create files
- 📅 **Google Calendar**: List events, get today's schedule, create events
- 👥 **Google Contacts**: List and search contacts
- 🛡️ **Protected Tools**: All tools automatically require OAuth authentication
- 📊 **Health Monitoring**: Built-in health check endpoint at `/health`
- 🎨 **Rich Metadata**: Server instructions, icons, and version info
- 🚀 **FastMCP v3**: Latest features including custom routes and enhanced security

## Quick Start

### 1. Install Dependencies

```bash
cd mcp-servers/google-workspace
uv sync
```

### 2. Configure Environment

Create `.env` file:

```bash
cp .env.example .env
```

Add your Google OAuth credentials to `.env`:

```env
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
PORT=3000
BASE_URL=http://localhost:3000
```

### 3. Get Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Enable these APIs:
   - Gmail API
   - Google Drive API
   - Google Calendar API
   - People API (for Contacts)
4. Create OAuth 2.0 credentials:
   - Go to **Credentials** → **Create Credentials** → **OAuth client ID**
   - Application type: **Desktop app** (recommended for `auth_setup`)
   - Add authorized redirect URI: `http://localhost:8000`
   - Copy Client ID and Client Secret to `.env`

**Important**: The `auth_setup` tool uses `http://localhost:8000` for OAuth callback. The `/auth/callback` endpoint on port 3000 is for FastMCP's OAuth proxy and is not used by `auth_setup`.

### 4. Run Server

```bash
uv run server.py
```

Output:

```
🚀 Starting Google Workspace MCP Server on http://localhost:3000
📡 MCP endpoint: http://localhost:3000/mcp
```

### 5. Configure Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "google-workspace": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

### 6. Authenticate

When you first use the `auth_setup` tool, a browser window will open for OAuth authentication and redirect back to `http://localhost:8000`.

All subsequent requests will use your authenticated session.

## Available Tools

**Note**: All tools are automatically protected by OAuth authentication via FastMCP v3's OAuth proxy.

### Gmail (4 tools)

- `gmail_list_emails` - List recent emails
- `gmail_read_email` - Read specific email by ID
- `gmail_send_email` - Send new email
- `gmail_get_unread_count` - Get unread count

### Drive (3 tools)

- `drive_list_files` - List files
- `drive_search_files` - Search files
- `drive_create_file` - Create new file

### Calendar (3 tools)

- `calendar_list_events` - List upcoming events
- `calendar_get_today` - Get today's events
- `calendar_create_event` - Create new event

### Contacts (2 tools)

- `contacts_list` - List contacts
- `contacts_search` - Search contacts by name

## Usage Examples

Try in Claude:

```
"List my recent emails"
"What's on my calendar today?"
"Search my Drive for budget files"
"Find contacts named Smith"
"Send an email to test@example.com"
```

The first request will trigger OAuth authentication automatically!

### Health Check

Test if the server is running:

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "healthy",
  "service": "Google Workspace MCP Server",
  "version": "1.0.0",
  "auth": "OAuth via FastMCP v3",
  "endpoints": {
    "mcp": "http://localhost:3000/mcp",
    "oauth_callback": "http://localhost:3000/auth/callback",
    "health": "http://localhost:3000/health"
  }
}
```

## Development

**Project Structure:**

```
mcp-servers/google-workspace/
├── server.py          # FastMCP v3 server with OAuth
├── pyproject.toml     # Dependencies (uv)
├── .env              # Environment config
├── README.md          # This file
└── FEATURES.md        # FastMCP v3 feature guide
```

## Deployment

### Option 1: Prefect Horizon (Recommended)

1. Push to GitHub
2. Sign in to [Prefect Horizon](https://horizon.prefect.io)
3. Create new project from your repo
4. Set entrypoint: `server.py:mcp`
5. Add environment variables:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `BASE_URL` (will be your Horizon URL)

Your server will be live at: `https://your-project.fastmcp.app/mcp`

### Option 2: Docker

```bash
# Build
docker build -t google-mcp-server .

# Run
docker run -p 3000:3000 \
  -e GOOGLE_CLIENT_ID=your_id \
  -e GOOGLE_CLIENT_SECRET=your_secret \
  -e BASE_URL=http://localhost:3000 \
  google-mcp-server
```

Or use docker-compose:
```bash
docker-compose up
```

### Option 3: Railway / Render

1. Connect GitHub repo
2. Set environment variables
3. Deploy automatically on push

Both platforms auto-detect Python apps and use `uv` if `pyproject.toml` is present.

## Why This Stack?

- ✅ **FastMCP v3**: Production-ready OAuth proxy authentication
- ✅ **uv**: Fast, modern Python dependency management
- ✅ **Google APIs**: Official Python client libraries
- ✅ **Type Safety**: Full type hints throughout
- ✅ **Security**: PKCE, token encryption, JWT signing, consent pages
- ✅ **Cloud Ready**: Deploy to Horizon, Railway, Render, or Docker

## Links

- [FastMCP Docs](https://gofastmcp.com/)
- [Google Cloud Console](https://console.cloud.google.com/)
- [Prefect Horizon](https://horizon.prefect.io)

## License

MIT
