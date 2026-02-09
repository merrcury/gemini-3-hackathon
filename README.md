# Gemini 3 Hack - Google Workspace MCP Server

Production-ready MCP server for Google Workspace using FastMCP v3.

## 🚀 Project

**Google Workspace MCP Server** - Access Gmail, Drive, Calendar, and Contacts through Claude Desktop or any MCP client.

Built with:

- **FastMCP v3** - Latest MCP framework with OAuth proxy
- **Python 3.11+** - Type-safe implementation  
- **uv** - Modern dependency management
- **Google APIs** - Official client libraries

## 📦 Getting Started

```bash
cd mcp-servers/google-workspace
uv sync
cp .env.example .env
# Edit .env with your Google OAuth credentials
uv run server.py
```

See [`mcp-servers/google-workspace/README.md`](./mcp-servers/google-workspace/README.md) for complete setup.

### Travel MCP (self-hosted SerpAPI)

The Travel server has its own keys (SERPAPI_KEY, optional API_KEY) — **the app only needs the server URL**.

1. **Run the Travel server** (keys live on the server):

   ```bash
   cd mcp-servers/travel
   uv sync && cp .env.example .env
   # Set SERPAPI_KEY=... and optionally API_KEY=... in the server .env
   uv run server.py
   ```

   Server runs at `http://localhost:3001`, MCP at `http://localhost:3001/mcp`.

2. **Configure the app** (`.env`): set **only** the Travel MCP URL:
   - `EXPO_PUBLIC_MCP_TRAVEL_URL=http://localhost:3001/mcp` (or your deployed URL)
   - Set `EXPO_PUBLIC_MCP_API_KEY` only if the server requires X-API-Key auth.

3. Restart the app (`npx expo start`).

See [`mcp-servers/travel/README.md`](./mcp-servers/travel/README.md) for tool details and deployment.

## ✨ Features

- 🔐 OAuth 2.0 authentication with PKCE
- ✉️ Gmail (list, read, send)
- 📁 Google Drive (list, search, create)
- 📅 Google Calendar (list, create events)
- 👥 Google Contacts (list, search)
- 🛡️ Production security (token encryption, JWT signing, consent pages)
- 📊 Health monitoring endpoint
- 🐳 Docker support

## 🏗️ Architecture

```
┌─────────────────┐
│  Claude Desktop │
│   (MCP Client)  │
└────────┬────────┘
         │ HTTP
         ↓
┌─────────────────┐
│  FastMCP v3     │
│  OAuth Proxy    │
├─────────────────┤
│  - Token mgmt   │
│  - PKCE         │
│  - JWT signing  │
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│  Google APIs    │
│  - Gmail        │
│  - Drive        │
│  - Calendar     │
│  - Contacts     │
└─────────────────┘
```

## 🔒 Security

- **PKCE**: Prevents authorization code interception
- **Token Encryption**: Fernet (AES-128-CBC + HMAC-SHA256)
- **JWT Signing**: HS256 with secure key derivation
- **Consent Pages**: Protection against confused deputy attacks
- **Secure Storage**: Encrypted token persistence

## 📚 Documentation

- [`mcp-servers/google-workspace/README.md`](./mcp-servers/google-workspace/README.md) - Setup guide
- [`mcp-servers/google-workspace/FEATURES.md`](./mcp-servers/google-workspace/FEATURES.md) - FastMCP v3 features
- [FastMCP Docs](https://gofastmcp.com/) - Official documentation
- [MCP Specification](https://modelcontextprotocol.io/) - Protocol details

## 🚢 Deployment

### Prefect Horizon (Recommended)

Managed MCP hosting with authentication and observability.

### Docker

```bash
docker-compose up
```

### Cloud Platforms

- Railway: Auto-deploy from GitHub
- Render: Connect repo, set env vars
- Any Python platform supporting uv

## 🛠️ Development

```bash
# Install dependencies
cd mcp-servers/google-workspace
uv sync

# Run server
uv run server.py

# Health check
curl http://localhost:3000/health

# Claude Desktop config
{
  "mcpServers": {
    "google-workspace": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

## 📄 License

MIT

## 🙏 Credits

Built with:

- [FastMCP](https://gofastmcp.com/) by [Prefect](https://www.prefect.io/)
- [MCP Protocol](https://modelcontextprotocol.io/) by Anthropic
- [Google APIs](https://developers.google.com/apis-explorer)
