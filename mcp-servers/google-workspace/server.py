"""Google Workspace MCP Server using FastMCP v3.

Uses FastMCP's built-in GoogleProvider (OAuthProxy) so MCP clients like
Claude Desktop show a native "Connect" button — no manual token wrangling.

Also exposes REST OAuth proxy endpoints (/auth/login, /auth/callback,
/auth/refresh) so mobile & web apps get the same one-click experience
over the REST API (/api/tools, /api/call).
"""

import contextvars
import json
import os
import secrets
import urllib.parse
import urllib.request
from typing import Optional
from dotenv import load_dotenv
from fastmcp import FastMCP, Context
from fastmcp.server.auth.providers.google import GoogleProvider
from fastmcp.server.dependencies import get_access_token
from starlette.requests import Request
from starlette.responses import JSONResponse, HTMLResponse
from starlette.middleware.cors import CORSMiddleware
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from google.oauth2.credentials import Credentials

# Load environment variables
load_dotenv()

# ---------------------------------------------------------------------------
# Google OAuth via FastMCP's built-in OAuthProxy
# MCP clients discover auth requirements automatically and show "Connect".
# ---------------------------------------------------------------------------
SCOPES = [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/contacts',
]

_google_auth: Optional[GoogleProvider] = None
_client_id = os.getenv('GOOGLE_CLIENT_ID')
_client_secret = os.getenv('GOOGLE_CLIENT_SECRET')
_base_url = os.getenv('BASE_URL', 'http://localhost:3000')

if _client_id and _client_secret:
    _google_auth = GoogleProvider(
        client_id=_client_id,
        client_secret=_client_secret,
        base_url=_base_url,
        required_scopes=SCOPES,
    )

mcp = FastMCP(
    name="Google Workspace MCP",
    auth=_google_auth,
    instructions="""
This server provides access to Google Workspace services (Gmail, Drive, Calendar, Contacts).

Available tools:
- Gmail: List, read, send emails, get unread count
- Drive: List, search, create files
- Calendar: List events, get today's schedule, create events
- Contacts: List and search contacts

Authentication is handled automatically by your MCP client.
    """.strip(),
    version="1.0.0",
    website_url="https://github.com/merrcury/gemini-3-hack",
)


# Service cache (keyed by token prefix + service name)
_services = {}

# Context variable: set by REST handlers so get_service() can pick it up
# without changing any tool signatures.
_rest_google_token: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "rest_google_token", default=None
)


# ---------------------------------------------------------------------------
# Google API service helper
# Works via TWO paths:
#   1. MCP protocol → get_access_token() (FastMCP injects after JWT validation)
#   2. REST API     → _rest_google_token context var (set by /api/call handler)
# ---------------------------------------------------------------------------

async def get_service(service_name: str, version: str, ctx: Optional[Context] = None):
    """Build a Google API service using the authenticated user's token."""

    raw_token: Optional[str] = None

    # Path 1: REST — check the context variable first
    rest_tok = _rest_google_token.get()
    if rest_tok:
        raw_token = rest_tok

    # Path 2: MCP protocol — use FastMCP's dependency injection
    if not raw_token:
        try:
            mcp_tok = get_access_token()
            if mcp_tok:
                raw_token = mcp_tok.token
        except Exception:
            pass

    if not raw_token:
        raise ValueError(
            "Not authenticated. Connect via your MCP client's OAuth flow "
            "or supply a Bearer token in the Authorization header."
        )

    creds = Credentials(token=raw_token)
    key = f"{raw_token[:20]}:{service_name}:{version}"
    if key not in _services:
        _services[key] = build(service_name, version, credentials=creds)
    return _services[key]


# ============================================================================
# AUTH STATUS TOOL
# ============================================================================

@mcp.tool()
async def auth_status(ctx: Context) -> str:
    """Show the currently authenticated Google account."""
    try:
        raw_token: Optional[str] = None

        # REST path
        rest_tok = _rest_google_token.get()
        if rest_tok:
            raw_token = rest_tok

        # MCP protocol path
        if not raw_token:
            try:
                mcp_tok = get_access_token()
                if mcp_tok:
                    raw_token = mcp_tok.token
                    # Check claims from GoogleTokenVerifier
                    claims = getattr(mcp_tok, 'claims', {}) or {}
                    email = claims.get("email")
                    name = claims.get("name")
                    if email:
                        return f"Authenticated as: {name or 'Unknown'} <{email}>"
            except Exception:
                pass

        if not raw_token:
            return "Not authenticated. Use your MCP client's Connect button."

        # Fallback: call Google userinfo API
        creds = Credentials(token=raw_token)
        service = build("oauth2", "v2", credentials=creds)
        info = service.userinfo().get().execute()
        return f"Authenticated as: {info.get('name', 'Unknown')} <{info.get('email', 'unknown')}>"
    except Exception as e:
        return f"Not authenticated: {str(e)}"


# ============================================================================
# GMAIL TOOLS
# ============================================================================

@mcp.tool()
async def gmail_list_emails(max_results: int = 10, query: str = "", ctx: Context = None) -> str:
    """List emails from Gmail.

    Args:
        max_results: Maximum number of emails to return (default: 10)
        query: Gmail search query (e.g., 'is:unread', 'from:example@email.com')
        ctx: FastMCP context (injected automatically)
    """
    try:
        service = await get_service('gmail', 'v1', ctx)
        results = service.users().messages().list(
            userId='me',
            maxResults=max_results,
            q=query
        ).execute()

        messages = results.get('messages', [])
        if not messages:
            return "No messages found."

        emails = []
        for msg in messages[:max_results]:
            email = service.users().messages().get(
                userId='me',
                id=msg['id'],
                format='metadata',
                metadataHeaders=['From', 'Subject', 'Date']
            ).execute()

            headers = {h['name']: h['value'] for h in email['payload']['headers']}
            emails.append({
                'id': email['id'],
                'from': headers.get('From', ''),
                'subject': headers.get('Subject', ''),
                'date': headers.get('Date', ''),
                'snippet': email.get('snippet', '')
            })

        return str(emails)
    except HttpError as e:
        return f"Error: {str(e)}"


@mcp.tool()
async def gmail_read_email(message_id: str, ctx: Context = None) -> str:
    """Read a specific email by ID.

    Args:
        message_id: The Gmail message ID
        ctx: FastMCP context (injected automatically)
    """
    try:
        service = await get_service('gmail', 'v1', ctx)
        message = service.users().messages().get(
            userId='me',
            id=message_id,
            format='full'
        ).execute()

        headers = {h['name']: h['value'] for h in message['payload']['headers']}

        # Get email body
        body = ""
        if 'parts' in message['payload']:
            for part in message['payload']['parts']:
                if part['mimeType'] == 'text/plain':
                    import base64
                    body = base64.urlsafe_b64decode(part['body']['data']).decode('utf-8')
                    break
        elif 'body' in message['payload'] and 'data' in message['payload']['body']:
            import base64
            body = base64.urlsafe_b64decode(message['payload']['body']['data']).decode('utf-8')

        return f"""From: {headers.get('From', '')}
To: {headers.get('To', '')}
Subject: {headers.get('Subject', '')}
Date: {headers.get('Date', '')}

{body}"""
    except HttpError as e:
        return f"Error: {str(e)}"


@mcp.tool()
async def gmail_send_email(to: str, subject: str, body: str, ctx: Context = None) -> str:
    """Send an email via Gmail.

    Args:
        to: Recipient email address
        subject: Email subject
        body: Email body text
        ctx: FastMCP context (injected automatically)
    """
    try:
        import base64
        from email.mime.text import MIMEText

        service = await get_service('gmail', 'v1', ctx)

        message = MIMEText(body)
        message['to'] = to
        message['subject'] = subject

        raw = base64.urlsafe_b64encode(message.as_bytes()).decode('utf-8')

        result = service.users().messages().send(
            userId='me',
            body={'raw': raw}
        ).execute()

        return f"Email sent successfully! ID: {result['id']}"
    except HttpError as e:
        return f"Error: {str(e)}"


@mcp.tool()
async def gmail_get_unread_count(ctx: Context = None) -> str:
    """Get the count of unread emails.

    Args:
        ctx: FastMCP context (injected automatically)
    """
    try:
        service = await get_service('gmail', 'v1', ctx)
        results = service.users().messages().list(
            userId='me',
            q='is:unread'
        ).execute()

        count = results.get('resultSizeEstimate', 0)
        return f"Unread emails: {count}"
    except HttpError as e:
        return f"Error: {str(e)}"


# ============================================================================
# GOOGLE DRIVE TOOLS
# ============================================================================

@mcp.tool()
async def drive_list_files(page_size: int = 10, query: str = "", ctx: Context = None) -> str:
    """List files in Google Drive.

    Args:
        page_size: Number of files to return (default: 10)
        query: Drive query filter (e.g., "mimeType='application/pdf'")
        ctx: FastMCP context (injected automatically)
    """
    try:
        service = await get_service('drive', 'v3', ctx)

        results = service.files().list(
            pageSize=page_size,
            q=query,
            fields="files(id, name, mimeType, modifiedTime, size, webViewLink)"
        ).execute()

        files = results.get('files', [])
        if not files:
            return "No files found."

        return str([{
            'id': f['id'],
            'name': f['name'],
            'type': f['mimeType'],
            'modified': f.get('modifiedTime', ''),
            'size': f.get('size', 'N/A'),
            'link': f.get('webViewLink', '')
        } for f in files])
    except HttpError as e:
        return f"Error: {str(e)}"


@mcp.tool()
async def drive_search_files(query: str, page_size: int = 20, ctx: Context = None) -> str:
    """Search for files in Google Drive.

    Args:
        query: Search query (searches in file names and content)
        page_size: Maximum results (default: 20)
        ctx: FastMCP context (injected automatically)
    """
    try:
        service = await get_service('drive', 'v3', ctx)

        search_query = f"name contains '{query}' or fullText contains '{query}'"

        results = service.files().list(
            pageSize=page_size,
            q=search_query,
            fields="files(id, name, mimeType, modifiedTime)"
        ).execute()

        files = results.get('files', [])
        if not files:
            return f"No files found matching '{query}'"

        return str([{
            'id': f['id'],
            'name': f['name'],
            'type': f['mimeType']
        } for f in files])
    except HttpError as e:
        return f"Error: {str(e)}"


@mcp.tool()
async def drive_create_file(name: str, content: str, mime_type: str = "text/plain", ctx: Context = None) -> str:
    """Create a new file in Google Drive.

    Args:
        name: File name
        content: File content
        mime_type: MIME type (default: text/plain)
        ctx: FastMCP context (injected automatically)
    """
    try:
        from googleapiclient.http import MediaInMemoryUpload

        service = await get_service('drive', 'v3', ctx)

        file_metadata = {'name': name}
        media = MediaInMemoryUpload(
            content.encode('utf-8'),
            mimetype=mime_type
        )

        file = service.files().create(
            body=file_metadata,
            media_body=media,
            fields='id, name, webViewLink'
        ).execute()

        return f"File created: {file['name']}\nID: {file['id']}\nLink: {file.get('webViewLink', 'N/A')}"
    except HttpError as e:
        return f"Error: {str(e)}"


# ============================================================================
# GOOGLE CALENDAR TOOLS
# ============================================================================

@mcp.tool()
async def calendar_list_events(max_results: int = 10, ctx: Context = None) -> str:
    """List upcoming calendar events.

    Args:
        max_results: Maximum number of events (default: 10)
        ctx: FastMCP context (injected automatically)
    """
    try:
        from datetime import datetime

        service = await get_service('calendar', 'v3', ctx)

        now = datetime.utcnow().isoformat() + 'Z'
        events_result = service.events().list(
            calendarId='primary',
            timeMin=now,
            maxResults=max_results,
            singleEvents=True,
            orderBy='startTime'
        ).execute()

        events = events_result.get('items', [])
        if not events:
            return "No upcoming events found."

        return str([{
            'id': e['id'],
            'summary': e.get('summary', 'No title'),
            'start': e['start'].get('dateTime', e['start'].get('date')),
            'end': e['end'].get('dateTime', e['end'].get('date')),
            'location': e.get('location', '')
        } for e in events])
    except HttpError as e:
        return f"Error: {str(e)}"


@mcp.tool()
async def calendar_get_today(ctx: Context = None) -> str:
    """Get today's calendar events.

    Args:
        ctx: FastMCP context (injected automatically)
    """
    try:
        from datetime import datetime, timedelta

        service = await get_service('calendar', 'v3', ctx)

        now = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        end = now + timedelta(days=1)

        events_result = service.events().list(
            calendarId='primary',
            timeMin=now.isoformat() + 'Z',
            timeMax=end.isoformat() + 'Z',
            singleEvents=True,
            orderBy='startTime'
        ).execute()

        events = events_result.get('items', [])
        if not events:
            return "No events today"

        return str([{
            'summary': e.get('summary', 'No title'),
            'start': e['start'].get('dateTime', e['start'].get('date')),
            'location': e.get('location', '')
        } for e in events])
    except HttpError as e:
        return f"Error: {str(e)}"


@mcp.tool()
async def calendar_create_event(
    summary: str,
    start: str,
    end: str,
    description: str = "",
    location: str = "",
    ctx: Context = None
) -> str:
    """Create a new calendar event.

    Args:
        summary: Event title
        start: Start time (ISO 8601 format, e.g., '2024-01-25T10:00:00-05:00')
        end: End time (ISO 8601 format)
        description: Event description (optional)
        location: Event location (optional)
        ctx: FastMCP context (injected automatically)
    """
    try:
        service = await get_service('calendar', 'v3', ctx)

        event = {
            'summary': summary,
            'start': {'dateTime': start},
            'end': {'dateTime': end},
        }

        if description:
            event['description'] = description
        if location:
            event['location'] = location

        result = service.events().insert(
            calendarId='primary',
            body=event
        ).execute()

        return f"Event created: {result.get('summary')}\nLink: {result.get('htmlLink')}"
    except HttpError as e:
        return f"Error: {str(e)}"


# ============================================================================
# GOOGLE CONTACTS TOOLS
# ============================================================================

@mcp.tool()
async def contacts_list(page_size: int = 50, ctx: Context = None) -> str:
    """List contacts from Google Contacts.

    Args:
        page_size: Number of contacts to return (default: 50)
        ctx: FastMCP context (injected automatically)
    """
    try:
        service = await get_service('people', 'v1', ctx)

        results = service.people().connections().list(
            resourceName='people/me',
            pageSize=page_size,
            personFields='names,emailAddresses,phoneNumbers'
        ).execute()

        connections = results.get('connections', [])
        if not connections:
            return "No contacts found."

        contacts = []
        for person in connections:
            name = person.get('names', [{}])[0].get('displayName', 'No name')
            emails = [e['value'] for e in person.get('emailAddresses', [])]
            phones = [p['value'] for p in person.get('phoneNumbers', [])]

            contacts.append({
                'name': name,
                'emails': emails,
                'phones': phones
            })

        return str(contacts)
    except HttpError as e:
        return f"Error: {str(e)}"


@mcp.tool()
async def contacts_search(query: str, page_size: int = 20, ctx: Context = None) -> str:
    """Search contacts by name.

    Args:
        query: Search query (name)
        page_size: Maximum results (default: 20)
        ctx: FastMCP context (injected automatically)
    """
    try:
        service = await get_service('people', 'v1', ctx)

        results = service.people().searchContacts(
            query=query,
            pageSize=page_size,
            readMask='names,emailAddresses,phoneNumbers'
        ).execute()

        contacts_result = results.get('results', [])
        if not contacts_result:
            return f"No contacts found matching '{query}'"

        contacts = []
        for result in contacts_result:
            person = result.get('person', {})
            name = person.get('names', [{}])[0].get('displayName', 'No name')
            emails = [e['value'] for e in person.get('emailAddresses', [])]
            phones = [p['value'] for p in person.get('phoneNumbers', [])]

            contacts.append({
                'name': name,
                'emails': emails,
                'phones': phones
            })

        return str(contacts)
    except HttpError as e:
        return f"Error: {str(e)}"


# ============================================================================
# RUN SERVER
# ============================================================================

def main():
    """Main entry point for the server."""
    import uvicorn

    port = int(os.getenv('PORT', 3000))
    host = os.getenv('HOST', '0.0.0.0')
    base_url = os.getenv('BASE_URL', f"http://localhost:{port}")
    mcp_path = os.getenv('MCP_PATH', '/mcp')
    mcp_url = f"{base_url}{mcp_path}"

    print(f"Google Workspace MCP Server")
    print(f"  Server:         {base_url}")
    print(f"  MCP endpoint:   {mcp_url}")
    print(f"  MCP OAuth cb:   {base_url}/auth/callback")
    print(f"  Mobile OAuth cb: {base_url}/auth/app/callback")
    print(f"  Health check:   {base_url}/health")
    if _google_auth:
        print(f"  Auth:           GoogleProvider (native MCP OAuth)")
    else:
        print(f"  Auth:           DISABLED (set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET)")
    print()
    print("=" * 60)
    print("Google Cloud Console Setup")
    print("=" * 60)
    print(f"\n1. Go to: https://console.cloud.google.com/apis/credentials")
    print(f"\n2. Create/edit an OAuth 2.0 Client of type 'Web application'")
    print(f"\n3. Add BOTH redirect URIs:")
    print(f"   {base_url}/auth/callback          (MCP protocol — Claude, Cursor)")
    print(f"   {base_url}/auth/app/callback      (Mobile / REST apps)")
    print(f"\n4. Enable these APIs: Gmail, Drive, Calendar, People")
    print()
    print("=" * 60)
    print("MCP Client Config")
    print("=" * 60)
    print(f"""{{
  "mcpServers": {{
    "google-workspace": {{
      "url": "{mcp_url}"
    }}
  }}
}}""")
    print("=" * 60)
    print("\nClients that support MCP OAuth (Claude Desktop, etc.) will")
    print("show a 'Connect' button — click it and authorize with Google.\n")

    # Create the HTTP app
    app = mcp.http_app(path=mcp_path)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    uvicorn.run(app, host=host, port=port)


@mcp.custom_route("/health", methods=["GET"])
async def health_check(request: Request) -> JSONResponse:
    """Health check endpoint for monitoring."""
    return JSONResponse({
        "status": "healthy",
        "service": "Google Workspace MCP Server",
        "version": "1.0.0",
        "auth": "GoogleProvider (OAuthProxy)" if _google_auth else "disabled",
    })


# ============================================================================
# OAUTH PROXY FOR MOBILE / WEB APPS
# ============================================================================
# GoogleProvider handles MCP-protocol OAuth (Claude, Cursor, etc.).
# These endpoints provide the SAME server-side OAuth proxy for REST clients
# (mobile apps, SPAs) that can't speak MCP protocol directly.
#
# Flow:
#   1. App opens /auth/login?redirect=agentcore://auth/callback in WebBrowser
#   2. Server redirects to Google consent screen
#   3. Google redirects back here → /auth/callback
#   4. Server exchanges code for tokens, redirects to app with tokens
#   5. App stores tokens, sends them as Bearer in REST API calls
#
# No per-client redirect URI registration needed.

_pending_auth: dict[str, str] = {}  # state → app redirect URL


def _get_external_base(request: Request) -> str:
    """Derive the external base URL from the incoming request.

    On Cloud Run (and most reverse-proxy setups) the real scheme/host come
    from forwarded headers. Falls back to _base_url from env.
    """
    # Prefer X-Forwarded-* headers (set by Cloud Run, nginx, etc.)
    proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip()
    host = request.headers.get("x-forwarded-host", "").split(",")[0].strip()

    if not host:
        host = request.headers.get("host", "")

    if proto and host:
        return f"{proto}://{host}"

    # Fallback to configured BASE_URL
    return _base_url.rstrip("/")


@mcp.custom_route("/auth/login", methods=["GET"])
async def auth_login(request: Request) -> HTMLResponse:
    """Start Google OAuth for a mobile/web client.

    Query params:
        redirect – URL the server should redirect to after auth
                   (e.g.  agentcore://auth/callback  or  http://localhost:8081)
    """
    app_redirect = request.query_params.get("redirect", "")
    if not app_redirect:
        return HTMLResponse("<h3>Missing 'redirect' query parameter</h3>", status_code=400)

    if not _client_id or not _client_secret:
        return HTMLResponse("<h3>GOOGLE_CLIENT_ID / SECRET not configured</h3>", status_code=500)

    state = secrets.token_urlsafe(32)
    _pending_auth[state] = app_redirect

    # Derive the redirect URI from the actual request URL so it matches
    # what's registered in Google Cloud Console, regardless of BASE_URL env.
    base = _get_external_base(request)
    redirect_uri = f"{base}/auth/app/callback"

    params = urllib.parse.urlencode({
        "client_id": _client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    })
    auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{params}"

    return HTMLResponse(
        f'<html><head><meta http-equiv="refresh" content="0;url={auth_url}">'
        f'</head><body>Redirecting to Google…</body></html>'
    )


@mcp.custom_route("/auth/app/callback", methods=["GET"])
async def auth_callback_rest(request: Request) -> HTMLResponse:
    """Google redirects here for REST/mobile OAuth.

    Uses /auth/app/callback to avoid clashing with FastMCP GoogleProvider's
    built-in /auth/callback (which handles MCP-protocol OAuth for
    Claude, Cursor, etc.).
    """
    state = request.query_params.get("state", "")
    app_redirect = _pending_auth.pop(state, None) if state else None

    # Not a REST-initiated flow → let the default handler deal with it
    if app_redirect is None:
        return HTMLResponse(
            "<h3>Unknown auth state. If you're using an MCP client, "
            "this is handled automatically.</h3>",
            status_code=400,
        )

    error = request.query_params.get("error", "")
    if error:
        return HTMLResponse(f"<h3>Google OAuth error: {error}</h3>", status_code=400)

    code = request.query_params.get("code", "")
    if not code:
        return HTMLResponse("<h3>Missing authorization code</h3>", status_code=400)

    # Must match the redirect_uri sent in /auth/login
    base = _get_external_base(request)
    redirect_uri = f"{base}/auth/app/callback"

    try:
        token_data = urllib.parse.urlencode({
            "client_id": _client_id,
            "client_secret": _client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }).encode()

        token_req = urllib.request.Request(
            "https://oauth2.googleapis.com/token",
            data=token_data,
            method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        with urllib.request.urlopen(token_req) as resp:
            tokens = json.loads(resp.read())
    except Exception as e:
        return HTMLResponse(f"<h3>Token exchange failed: {e}</h3>", status_code=500)

    access_token = tokens.get("access_token", "")
    refresh_token = tokens.get("refresh_token", "")
    expires_in = tokens.get("expires_in", 3600)

    if not access_token:
        return HTMLResponse("<h3>No access token from Google</h3>", status_code=500)

    sep = "&" if "?" in app_redirect else "?"
    redirect_url = (
        f"{app_redirect}{sep}"
        f"access_token={urllib.parse.quote(access_token)}"
        f"&refresh_token={urllib.parse.quote(refresh_token)}"
        f"&expires_in={expires_in}"
    )

    return HTMLResponse(f"""<!DOCTYPE html>
<html><head><title>Authenticated</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;
height:100vh;background:#0B1220;color:white">
<div style="text-align:center">
<h2>Authentication successful!</h2>
<p>Returning to app…</p>
<script>window.location.replace("{redirect_url}");</script>
<noscript><a href="{redirect_url}">Click here to return to the app</a></noscript>
</div></body></html>""")


@mcp.custom_route("/auth/refresh", methods=["POST"])
async def auth_refresh(request: Request) -> JSONResponse:
    """Refresh an expired Google access token.

    Body: {"refresh_token": "..."}
    Returns: {"access_token": "...", "expires_in": 3600}
    """
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    refresh_token = body.get("refresh_token", "")
    if not refresh_token:
        return JSONResponse({"error": "Missing refresh_token"}, status_code=400)

    try:
        data = urllib.parse.urlencode({
            "client_id": _client_id,
            "client_secret": _client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }).encode()

        req = urllib.request.Request(
            "https://oauth2.googleapis.com/token",
            data=data,
            method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        with urllib.request.urlopen(req) as resp:
            tokens = json.loads(resp.read())
    except Exception as e:
        return JSONResponse({"error": f"Refresh failed: {e}"}, status_code=500)

    return JSONResponse({
        "access_token": tokens.get("access_token", ""),
        "expires_in": tokens.get("expires_in", 3600),
    })


# ============================================================================
# REST API FOR WEB ACCESS
# ============================================================================

TOOL_REGISTRY = {}

def register_tool(name: str, func, schema: dict):
    """Register a tool for REST API access."""
    TOOL_REGISTRY[name] = {"func": func, "schema": schema}

register_tool("gmail_list_emails", gmail_list_emails, {
    "name": "gmail_list_emails",
    "description": "List emails from Gmail.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "max_results": {"type": "number", "description": "Maximum number of emails to return", "default": 10},
            "query": {"type": "string", "description": "Gmail search query", "default": ""}
        },
        "required": []
    }
})
register_tool("gmail_read_email", gmail_read_email, {
    "name": "gmail_read_email",
    "description": "Read a specific email by ID.",
    "inputSchema": {
        "type": "object",
        "properties": {"message_id": {"type": "string", "description": "The Gmail message ID"}},
        "required": ["message_id"]
    }
})
register_tool("gmail_send_email", gmail_send_email, {
    "name": "gmail_send_email",
    "description": "Send an email via Gmail.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "to": {"type": "string", "description": "Recipient email address"},
            "subject": {"type": "string", "description": "Email subject"},
            "body": {"type": "string", "description": "Email body text"}
        },
        "required": ["to", "subject", "body"]
    }
})
register_tool("gmail_get_unread_count", gmail_get_unread_count, {
    "name": "gmail_get_unread_count",
    "description": "Get the count of unread emails.",
    "inputSchema": {"type": "object", "properties": {}, "required": []}
})
register_tool("drive_list_files", drive_list_files, {
    "name": "drive_list_files",
    "description": "List files in Google Drive.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "page_size": {"type": "number", "description": "Number of files to return", "default": 10},
            "query": {"type": "string", "description": "Drive query filter", "default": ""}
        },
        "required": []
    }
})
register_tool("drive_search_files", drive_search_files, {
    "name": "drive_search_files",
    "description": "Search for files in Google Drive.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search query"},
            "page_size": {"type": "number", "description": "Maximum results", "default": 20}
        },
        "required": ["query"]
    }
})
register_tool("drive_create_file", drive_create_file, {
    "name": "drive_create_file",
    "description": "Create a new file in Google Drive.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "File name"},
            "content": {"type": "string", "description": "File content"},
            "mime_type": {"type": "string", "description": "MIME type", "default": "text/plain"}
        },
        "required": ["name", "content"]
    }
})
register_tool("calendar_list_events", calendar_list_events, {
    "name": "calendar_list_events",
    "description": "List upcoming calendar events.",
    "inputSchema": {
        "type": "object",
        "properties": {"max_results": {"type": "number", "description": "Maximum number of events", "default": 10}},
        "required": []
    }
})
register_tool("calendar_get_today", calendar_get_today, {
    "name": "calendar_get_today",
    "description": "Get today's calendar events.",
    "inputSchema": {"type": "object", "properties": {}, "required": []}
})
register_tool("calendar_create_event", calendar_create_event, {
    "name": "calendar_create_event",
    "description": "Create a new calendar event.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "summary": {"type": "string", "description": "Event title"},
            "start": {"type": "string", "description": "Start time (ISO 8601 format)"},
            "end": {"type": "string", "description": "End time (ISO 8601 format)"},
            "description": {"type": "string", "description": "Event description", "default": ""},
            "location": {"type": "string", "description": "Event location", "default": ""}
        },
        "required": ["summary", "start", "end"]
    }
})
register_tool("contacts_list", contacts_list, {
    "name": "contacts_list",
    "description": "List contacts from Google Contacts.",
    "inputSchema": {
        "type": "object",
        "properties": {"page_size": {"type": "number", "description": "Number of contacts to return", "default": 50}},
        "required": []
    }
})
register_tool("contacts_search", contacts_search, {
    "name": "contacts_search",
    "description": "Search contacts by name.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search query (name)"},
            "page_size": {"type": "number", "description": "Maximum results", "default": 20}
        },
        "required": ["query"]
    }
})


@mcp.custom_route("/api/tools", methods=["GET"])
async def list_tools_rest(request: Request) -> JSONResponse:
    """REST endpoint to list available tools."""
    tools = [info["schema"] for info in TOOL_REGISTRY.values()]
    return JSONResponse({"tools": tools})


@mcp.custom_route("/api/call", methods=["POST"])
async def call_tool_rest(request: Request) -> JSONResponse:
    """REST endpoint to call a tool.

    Accepts Google access token via  Authorization: Bearer <token>
    The token is threaded through to get_service() via a context variable
    so every tool can use it without signature changes.
    """
    # --- auth: extract Bearer token ---
    auth_header = request.headers.get("authorization", "")
    bearer_token: Optional[str] = None
    if auth_header.lower().startswith("bearer "):
        bearer_token = auth_header[7:].strip()

    if not bearer_token:
        return JSONResponse(
            {"error": "Missing Authorization: Bearer <token> header"},
            status_code=401,
        )

    try:
        body = await request.json()
        tool_name = body.get("name")
        arguments = body.get("arguments", {})

        if not tool_name:
            return JSONResponse({"error": "Missing 'name' field"}, status_code=400)

        if tool_name not in TOOL_REGISTRY:
            return JSONResponse({"error": f"Unknown tool: {tool_name}"}, status_code=404)

        tool_info = TOOL_REGISTRY[tool_name]
        func = tool_info["func"]

        # Inject token so get_service() picks it up
        reset = _rest_google_token.set(bearer_token)
        try:
            import inspect
            if inspect.iscoroutinefunction(func):
                result = await func(**arguments)
            else:
                result = func(**arguments)
        finally:
            _rest_google_token.reset(reset)

        return JSONResponse({
            "result": {"content": [{"type": "text", "text": result}]}
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse({"error": str(e)}, status_code=500)


if __name__ == "__main__":
    main()
