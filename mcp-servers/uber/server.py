"""Uber MCP Server using FastMCP with Uber API.

Zero-config Uber integration for ride estimates, requests, and tracking.
"""

import os
import json
from datetime import datetime
from typing import Optional, Dict, Any
from dotenv import load_dotenv
from fastmcp import FastMCP, Context
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware
import httpx

# Load environment variables
load_dotenv()

# Create FastMCP server
mcp = FastMCP(
    name="Uber MCP",
    instructions="""
This server provides access to Uber ride services via the Uber API.

Available tools:
- Price Estimates: Get ride price estimates between locations
- Time Estimates: Check pickup time estimates
- Ride Products: See available Uber products (X, Black, XL, etc.)

SETUP: First run 'uber_auth_setup' to authenticate with your Uber account.
This will open a browser window for you to log in. After that, all tools will work!

Check auth status anytime with 'uber_auth_status'.
    """.strip(),
    version="1.0.0",
    website_url="https://github.com/merrcury/gemini-3-hack",
)

# Uber API configuration
UBER_CLIENT_ID = os.getenv("UBER_CLIENT_ID", "")
UBER_CLIENT_SECRET = os.getenv("UBER_CLIENT_SECRET", "")
UBER_ENVIRONMENT = os.getenv("UBER_ENVIRONMENT", "sandbox")  # "sandbox" or "production"

if UBER_ENVIRONMENT == "sandbox":
    UBER_API_BASE = "https://test-api.uber.com/v1.2"  # Testing API endpoint
    UBER_LOGIN_URL = "https://sandbox-login.uber.com"  # Sandbox login endpoint
    UBER_TOKEN_URL = "https://sandbox-login.uber.com/oauth/v2/token"  # Sandbox token endpoint
else:
    UBER_API_BASE = "https://api.uber.com/v1.2"
    UBER_LOGIN_URL = "https://login.uber.com"
    UBER_TOKEN_URL = "https://login.uber.com/oauth/v2/token"

# Simple in-memory cache
_cache: Dict[str, Dict[str, Any]] = {}
CACHE_TTL_SECONDS = 300  # 5 minutes

# OAuth token cache
_oauth_token: Optional[Dict[str, Any]] = None


def _get_cache_key(endpoint: str, params: Dict) -> str:
    """Generate cache key from endpoint and params."""
    sorted_params = json.dumps(params, sort_keys=True)
    return f"{endpoint}:{sorted_params}"


def _get_cached(key: str) -> Optional[Any]:
    """Get cached data if not expired."""
    if key in _cache:
        cached = _cache[key]
        if datetime.now().timestamp() - cached["timestamp"] < CACHE_TTL_SECONDS:
            return cached["data"]
        else:
            del _cache[key]
    return None


def _set_cache(key: str, data: Any) -> None:
    """Store data in cache with timestamp."""
    _cache[key] = {
        "data": data,
        "timestamp": datetime.now().timestamp()
    }


async def _get_oauth_token() -> str:
    """Get OAuth 2.0 access token. Prefers user token from authorization flow."""
    global _oauth_token
    
    # Check if we have a valid user token from authorization flow
    if _oauth_token and _oauth_token.get("access_token"):
        expires_at = _oauth_token.get("expires_at", 0)
        if datetime.now().timestamp() < expires_at:
            return _oauth_token["access_token"]
        
        # Try to refresh if we have a refresh token
        if _oauth_token.get("refresh_token"):
            try:
                return await _refresh_oauth_token(_oauth_token["refresh_token"])
            except:
                pass  # Fall through to re-auth message
    
    # No valid token - user needs to authorize
    raise ValueError("""
❌ No valid Uber OAuth token found.

Testing apps require user authorization. Please:

1. Use the 'get_authorization_url' tool to get the auth URL
2. Visit that URL and log in with your Uber account
3. Copy the authorization code from the redirect URL
4. Use the 'exchange_authorization_code' tool with that code

Then you can use the API tools.
""")


async def _refresh_oauth_token(refresh_token: str) -> str:
    """Refresh an expired OAuth token."""
    global _oauth_token
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            UBER_TOKEN_URL,
            data={
                "client_id": UBER_CLIENT_ID,
                "client_secret": UBER_CLIENT_SECRET,
                "grant_type": "refresh_token",
                "refresh_token": refresh_token
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=30.0
        )
        response.raise_for_status()
        token_data = response.json()
    
    # Update cached token
    _oauth_token = {
        "access_token": token_data["access_token"],
        "refresh_token": token_data.get("refresh_token", refresh_token),
        "expires_at": datetime.now().timestamp() + token_data.get("expires_in", 3600) - 60
    }
    
    return _oauth_token["access_token"]


async def _call_uber_api(
    endpoint: str,
    method: str = "GET",
    params: Optional[Dict[str, Any]] = None,
    data: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Call Uber API with OAuth 2.0 authentication and caching for GET requests."""
    url = f"{UBER_API_BASE}/{endpoint}"
    
    # Get OAuth token
    token = await _get_oauth_token()
    
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept-Language": "en_US",
        "Content-Type": "application/json"
    }
    
    # Check cache for GET requests
    if method == "GET" and params:
        cache_key = _get_cache_key(endpoint, params)
        cached = _get_cached(cache_key)
        if cached:
            return cached
    
    # Make API request
    async with httpx.AsyncClient() as client:
        if method == "GET":
            response = await client.get(url, headers=headers, params=params, timeout=30.0)
        elif method == "POST":
            response = await client.post(url, headers=headers, json=data, timeout=30.0)
        elif method == "DELETE":
            response = await client.delete(url, headers=headers, timeout=30.0)
        else:
            raise ValueError(f"Unsupported HTTP method: {method}")
        
        response.raise_for_status()
        result = response.json()
    
    # Cache GET requests
    if method == "GET" and params:
        _set_cache(cache_key, result)
    
    return result


# ============================================================================
# OAUTH AUTHORIZATION TOOLS
# ============================================================================

@mcp.tool()
def uber_auth_setup(ctx: Context) -> str:
    """Set up Uber OAuth authentication. Opens browser for authorization.
    
    Run this tool first to authenticate with Uber.
    Opens a browser window for you to log in with your Uber account.
    
    Note: Uses port 8765 for OAuth callback.
    """
    try:
        import webbrowser
        from http.server import HTTPServer, BaseHTTPRequestHandler
        from urllib.parse import urlparse, parse_qs, urlencode
        import asyncio
        
        if not UBER_CLIENT_ID or not UBER_CLIENT_SECRET:
            return "❌ Error: UBER_CLIENT_ID and UBER_CLIENT_SECRET not configured"
        
        # Store the authorization code
        auth_code = {"code": None, "error": None}
        
        # Create a simple HTTP server to receive the callback
        class CallbackHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                parsed = urlparse(self.path)
                params = parse_qs(parsed.query)
                
                if 'code' in params:
                    auth_code['code'] = params['code'][0]
                    self.send_response(200)
                    self.send_header('Content-type', 'text/html')
                    self.end_headers()
                    self.wfile.write(b'''<html><body>
                        <h2>Success!</h2>
                        <p>Authentication successful. You can close this window and return to Claude.</p>
                        <script>setTimeout(() => window.close(), 3000);</script>
                    </body></html>''')
                elif 'error' in params:
                    auth_code['error'] = params['error'][0]
                    self.send_response(400)
                    self.send_header('Content-type', 'text/html')
                    self.end_headers()
                    self.wfile.write(b'<html><body><h2>Error</h2><p>Authentication failed.</p></body></html>')
                else:
                    self.send_response(400)
                    self.end_headers()
            
            def log_message(self, format, *args):
                pass
        
        # Start local server
        server = HTTPServer(('localhost', 8765), CallbackHandler)
        
        # Build auth URL
        redirect_uri = "http://localhost:8765"
        params = {
            "client_id": UBER_CLIENT_ID,
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "scope": "profile history"
        }
        auth_url = f"{UBER_LOGIN_URL}/oauth/v2/authorize?{urlencode(params)}"
        
        # Open browser
        print(f"\n🔐 Opening browser for Uber authentication...")
        webbrowser.open(auth_url)
        
        # Wait for ONE request
        server.handle_request()
        server.server_close()
        
        # Check result
        if auth_code['error']:
            return f"❌ Authentication failed: {auth_code['error']}"
        
        if not auth_code['code']:
            return "❌ No authorization code received. Please try again."
        
        # Exchange code for token (sync httpx)
        import httpx
        response = httpx.post(
            UBER_TOKEN_URL,
            data={
                "client_id": UBER_CLIENT_ID,
                "client_secret": UBER_CLIENT_SECRET,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri,
                "code": auth_code['code']
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=30.0
        )
        
        if response.status_code != 200:
            return f"❌ Token exchange failed: {response.status_code} - {response.text}"
        
        token_data = response.json()
        
        # Store token globally
        global _oauth_token
        _oauth_token = {
            "access_token": token_data["access_token"],
            "refresh_token": token_data.get("refresh_token"),
            "expires_at": datetime.now().timestamp() + token_data.get("expires_in", 3600)
        }
        
        return "✅ Successfully authenticated with Uber! You can now use all tools."
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return f"❌ Authentication failed: {str(e)}\n\nMake sure http://localhost:8765 is added to your Uber app's redirect URIs."


@mcp.tool()
async def get_authorization_url(redirect_uri: str = "http://localhost:3002/callback") -> str:
    """Get the Uber OAuth authorization URL for user authentication.
    
    This is Step 1 of the OAuth flow. User needs to visit this URL to authorize the app.
    
    Args:
        redirect_uri: Where Uber should redirect after authorization (default: http://localhost:3002/callback)
    
    Returns:
        Authorization URL that user should visit
    """
    if not UBER_CLIENT_ID:
        return "❌ Error: UBER_CLIENT_ID not configured"
    
    # Build authorization URL with correct login endpoint
    params = {
        "client_id": UBER_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "scope": "profile"  # Valid Uber scope for basic access
    }
    
    from urllib.parse import urlencode
    auth_url = f"{UBER_LOGIN_URL}/oauth/v2/authorize?{urlencode(params)}"
    
    return f"""
🔐 Uber OAuth Authorization Required

Please visit this URL in your browser to authorize the app:

{auth_url}

Steps:
1. Click the URL above
2. Log in with your Uber account
3. Approve the permissions
4. You'll be redirected to: {redirect_uri}?code=AUTHORIZATION_CODE
5. Copy the 'code' parameter from the URL
6. Use the 'exchange_authorization_code' tool with that code

Note: Make sure {redirect_uri} is added to your app's redirect URIs in Uber Developer Portal.
"""


@mcp.tool()
async def exchange_authorization_code(
    authorization_code: str,
    redirect_uri: str = "http://localhost:3002/callback"
) -> str:
    """Exchange authorization code for access token.
    
    This is Step 2 of the OAuth flow after user has authorized the app.
    
    Args:
        authorization_code: The code from the redirect URL after user authorization
        redirect_uri: Same redirect URI used in authorization (default: http://localhost:3002/callback)
    
    Returns:
        Success message with token info
    """
    if not UBER_CLIENT_ID or not UBER_CLIENT_SECRET:
        return "❌ Error: OAuth credentials not configured"
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                UBER_TOKEN_URL,
                data={
                    "client_id": UBER_CLIENT_ID,
                    "client_secret": UBER_CLIENT_SECRET,
                    "grant_type": "authorization_code",
                    "redirect_uri": redirect_uri,
                    "code": authorization_code
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=30.0
            )
            
            if response.status_code != 200:
                return f"❌ Token exchange failed: {response.status_code} - {response.text}"
            
            token_data = response.json()
            
            # Store the token globally for API calls
            global _oauth_token
            _oauth_token = {
                "access_token": token_data["access_token"],
                "refresh_token": token_data.get("refresh_token"),
                "expires_at": datetime.now().timestamp() + token_data.get("expires_in", 3600)
            }
            
            return f"""✅ Successfully authenticated!

Access Token: {token_data['access_token'][:20]}...
Token Type: {token_data.get('token_type', 'Bearer')}
Expires In: {token_data.get('expires_in', 'N/A')} seconds
Refresh Token: {'Yes' if token_data.get('refresh_token') else 'No'}

You can now use the price estimate and product tools!
"""
            
    except Exception as e:
        return f"❌ Error exchanging code: {str(e)}"


# ============================================================================
# PRICE ESTIMATE TOOLS
# ============================================================================

@mcp.tool()
async def get_price_estimate(
    start_latitude: float,
    start_longitude: float,
    end_latitude: float,
    end_longitude: float
) -> str:
    """Get price estimates for Uber rides between two locations.
    
    Args:
        start_latitude: Starting location latitude
        start_longitude: Starting location longitude
        end_latitude: Destination latitude
        end_longitude: Destination longitude
    
    Returns:
        JSON string with price estimates for different Uber products
    """
    if not UBER_CLIENT_ID or not UBER_CLIENT_SECRET:
        return "❌ Error: UBER_CLIENT_ID and UBER_CLIENT_SECRET not configured. Please add them to .env file."
    
    try:
        params = {
            "start_latitude": start_latitude,
            "start_longitude": start_longitude,
            "end_latitude": end_latitude,
            "end_longitude": end_longitude
        }
        
        data = await _call_uber_api("estimates/price", params=params)
        
        prices = data.get("prices", [])
        if not prices:
            return "No price estimates available for this route"
        
        # Format results
        results = []
        for price in prices:
            result = {
                "product_name": price.get("display_name"),
                "estimate": price.get("estimate"),
                "low_estimate": price.get("low_estimate"),
                "high_estimate": price.get("high_estimate"),
                "currency_code": price.get("currency_code"),
                "duration": price.get("duration"),
                "distance": price.get("distance"),
                "surge_multiplier": price.get("surge_multiplier", 1.0),
                "product_id": price.get("product_id")
            }
            results.append(result)
        
        output = {
            "route": {
                "start": {"lat": start_latitude, "lng": start_longitude},
                "end": {"lat": end_latitude, "lng": end_longitude}
            },
            "estimates": results,
            "cached": "from cache" if _get_cached(_get_cache_key("estimates/price", params)) else "live"
        }
        
        return json.dumps(output, indent=2)
        
    except httpx.HTTPStatusError as e:
        return f"❌ Uber API Error: {e.response.status_code} - {e.response.text}"
    except Exception as e:
        return f"❌ Error: {str(e)}"


@mcp.tool()
async def get_time_estimate(
    start_latitude: float,
    start_longitude: float,
    product_id: Optional[str] = None
) -> str:
    """Get estimated pickup time for Uber rides.
    
    Args:
        start_latitude: Starting location latitude
        start_longitude: Starting location longitude
        product_id: Optional specific Uber product ID (e.g., UberX)
    
    Returns:
        JSON string with time estimates
    """
    if not UBER_CLIENT_ID or not UBER_CLIENT_SECRET:
        return "❌ Error: UBER_CLIENT_ID and UBER_CLIENT_SECRET not configured. Please add them to .env file."
    
    try:
        params = {
            "start_latitude": start_latitude,
            "start_longitude": start_longitude
        }
        
        if product_id:
            params["product_id"] = product_id
        
        data = await _call_uber_api("estimates/time", params=params)
        
        times = data.get("times", [])
        if not times:
            return "No time estimates available for this location"
        
        results = []
        for time_est in times:
            result = {
                "product_name": time_est.get("display_name"),
                "estimate_seconds": time_est.get("estimate"),
                "estimate_minutes": round(time_est.get("estimate", 0) / 60, 1),
                "product_id": time_est.get("product_id")
            }
            results.append(result)
        
        output = {
            "location": {"lat": start_latitude, "lng": start_longitude},
            "time_estimates": results,
            "cached": "from cache" if _get_cached(_get_cache_key("estimates/time", params)) else "live"
        }
        
        return json.dumps(output, indent=2)
        
    except httpx.HTTPStatusError as e:
        return f"❌ Uber API Error: {e.response.status_code} - {e.response.text}"
    except Exception as e:
        return f"❌ Error: {str(e)}"


# ============================================================================
# PRODUCT TOOLS
# ============================================================================

@mcp.tool()
async def get_products(
    latitude: float,
    longitude: float
) -> str:
    """Get available Uber products at a location.
    
    Args:
        latitude: Location latitude
        longitude: Location longitude
    
    Returns:
        JSON string with available Uber products (X, Black, XL, etc.)
    """
    if not UBER_CLIENT_ID or not UBER_CLIENT_SECRET:
        return "❌ Error: UBER_CLIENT_ID and UBER_CLIENT_SECRET not configured. Please add them to .env file."
    
    try:
        params = {
            "latitude": latitude,
            "longitude": longitude
        }
        
        data = await _call_uber_api("products", params=params)
        
        products = data.get("products", [])
        if not products:
            return "No Uber products available at this location"
        
        results = []
        for product in products:
            result = {
                "product_id": product.get("product_id"),
                "name": product.get("display_name"),
                "description": product.get("description"),
                "capacity": product.get("capacity"),
                "image": product.get("image"),
                "shared": product.get("shared", False)
            }
            results.append(result)
        
        output = {
            "location": {"lat": latitude, "lng": longitude},
            "products": results,
            "total_products": len(results),
            "cached": "from cache" if _get_cached(_get_cache_key("products", params)) else "live"
        }
        
        return json.dumps(output, indent=2)
        
    except httpx.HTTPStatusError as e:
        return f"❌ Uber API Error: {e.response.status_code} - {e.response.text}"
    except Exception as e:
        return f"❌ Error: {str(e)}"


# ============================================================================
# UTILITY TOOLS
# ============================================================================

@mcp.tool()
async def uber_auth_status(ctx: Context) -> str:
    """Check the current Uber authentication status.
    
    Returns:
        Current authentication status
    """
    global _oauth_token
    
    if not _oauth_token or not _oauth_token.get("access_token"):
        return "❌ Not authenticated. Run 'uber_auth_setup' to authenticate."
    
    expires_at = _oauth_token.get("expires_at", 0)
    now = datetime.now().timestamp()
    
    if now >= expires_at:
        return "⚠️ Token expired. Run 'uber_auth_setup' to re-authenticate."
    
    time_left = int((expires_at - now) / 60)
    has_refresh = bool(_oauth_token.get("refresh_token"))
    
    return f"""✅ Authenticated with Uber

Token expires in: {time_left} minutes
Has refresh token: {'Yes' if has_refresh else 'No'}
Environment: {UBER_ENVIRONMENT}

You can use all Uber tools!"""


@mcp.tool()
async def geocode_address(address: str) -> str:
    """Convert an address to latitude/longitude coordinates.
    
    Note: This is a helper function. In production, use a proper geocoding service
    like Google Maps Geocoding API or Mapbox.
    
    Args:
        address: Street address to geocode
    
    Returns:
        Instructions to use a geocoding service
    """
    return """To use Uber tools with addresses, you need to convert addresses to coordinates first.

Recommended geocoding services:
1. Google Maps Geocoding API
2. Mapbox Geocoding API
3. OpenStreetMap Nominatim

Example coordinates for common cities:
- San Francisco: 37.7749, -122.4194
- New York: 40.7128, -74.0060
- Los Angeles: 34.0522, -118.2437
- Chicago: 41.8781, -87.6298
- Austin: 30.2672, -97.7431

For now, please provide latitude and longitude directly to the price/time estimate functions."""


@mcp.tool()
async def get_cache_stats() -> str:
    """Get statistics about the API cache.
    
    Returns:
        JSON string with cache statistics
    """
    total_entries = len(_cache)
    expired = 0
    now = datetime.now().timestamp()
    
    for key, value in _cache.items():
        if now - value["timestamp"] >= CACHE_TTL_SECONDS:
            expired += 1
    
    stats = {
        "total_cached_queries": total_entries,
        "expired_entries": expired,
        "active_entries": total_entries - expired,
        "cache_ttl_seconds": CACHE_TTL_SECONDS,
        "cache_ttl_minutes": CACHE_TTL_SECONDS / 60
    }
    
    return json.dumps(stats, indent=2)


@mcp.tool()
async def clear_cache() -> str:
    """Clear the API cache to force fresh results.
    
    Returns:
        Confirmation message
    """
    entries_cleared = len(_cache)
    _cache.clear()
    return f"✅ Cache cleared. {entries_cleared} entries removed."


# ============================================================================
# RUN SERVER
# ============================================================================

def main():
    """Main entry point for the server."""
    import uvicorn
    
    port = int(os.getenv('PORT', 3002))
    base_url = os.getenv('BASE_URL', f"http://localhost:{port}")
    
    print("🚗" + "="*59)
    print("🚀 Starting Uber MCP Server")
    print("="*60)
    print(f"📡 Server: {base_url}")
    print(f"📡 MCP endpoint: {base_url}/mcp")
    print(f"📡 Health check: {base_url}/health")
    print("\n" + "="*60)
    
    if not UBER_CLIENT_ID or not UBER_CLIENT_SECRET:
        print("⚠️  WARNING: UBER_CLIENT_ID or UBER_CLIENT_SECRET not found in .env file")
        print("="*60)
        print("\nTo use this server, you need Uber OAuth credentials:")
        print("1. Sign up at https://developer.uber.com/")
        print("2. Create a new app with 'Others' API suite")
        print("3. Add redirect URI: http://localhost:8765")
        print("4. Get your Client ID and Client Secret")
        print("5. Add to .env file:")
        print("   UBER_CLIENT_ID=your_client_id")
        print("   UBER_CLIENT_SECRET=your_client_secret")
        print("   UBER_ENVIRONMENT=sandbox")
    else:
        print(f"✅ Uber OAuth credentials configured")
        print(f"🔧 Environment: {UBER_ENVIRONMENT}")
        print(f"📍 API Base: {UBER_API_BASE}")
        print(f"\n⚠️  Important: Add redirect URI to your Uber app:")
        print(f"   http://localhost:8765")
    
    print("\n" + "="*60)
    print("Claude Desktop Config:")
    print("="*60)
    print(f"""{{
  "mcpServers": {{
    "uber": {{
      "url": "{base_url}/mcp"
    }}
  }}
}}""")
    print("\n" + "="*60)
    print("\n💾 Caching enabled: 5-minute TTL to reduce API costs")
    print("🔐 Authentication: Use 'uber_auth_setup' tool to authenticate")
    print("🚗 Get Uber price estimates and ride info!\n")
    
    # Get the HTTP app from FastMCP and add CORS middleware
    app = mcp.http_app()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # Run with uvicorn directly
    uvicorn.run(app, host="127.0.0.1", port=port)


@mcp.custom_route("/callback", methods=["GET"])
async def oauth_callback(request: Request) -> JSONResponse:
    """OAuth callback endpoint for Uber authorization."""
    from urllib.parse import parse_qs
    
    # Get authorization code from query params
    code = request.query_params.get("code")
    error = request.query_params.get("error")
    
    if error:
        return JSONResponse({
            "error": error,
            "message": "User denied authorization or authorization failed"
        }, status_code=400)
    
    if not code:
        return JSONResponse({
            "error": "no_code",
            "message": "No authorization code received"
        }, status_code=400)
    
    # Exchange code for token
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                UBER_TOKEN_URL,
                data={
                    "client_id": UBER_CLIENT_ID,
                    "client_secret": UBER_CLIENT_SECRET,
                    "grant_type": "authorization_code",
                    "redirect_uri": f"{os.getenv('BASE_URL', 'http://localhost:3002')}/callback",
                    "code": code
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=30.0
            )
            
            if response.status_code != 200:
                return JSONResponse({
                    "error": "token_exchange_failed",
                    "details": response.text
                }, status_code=response.status_code)
            
            token_data = response.json()
            
            # Store token globally
            global _oauth_token
            _oauth_token = {
                "access_token": token_data["access_token"],
                "refresh_token": token_data.get("refresh_token"),
                "expires_at": datetime.now().timestamp() + token_data.get("expires_in", 3600)
            }
            
            return JSONResponse({
                "status": "success",
                "message": "✅ Successfully authenticated with Uber!",
                "token_type": token_data.get("token_type"),
                "expires_in": token_data.get("expires_in"),
                "has_refresh_token": bool(token_data.get("refresh_token"))
            })
            
    except Exception as e:
        return JSONResponse({
            "error": "exception",
            "message": str(e)
        }, status_code=500)


@mcp.custom_route("/health", methods=["GET"])
async def health_check(request: Request) -> JSONResponse:
    """Health check endpoint for monitoring."""
    cache_stats = {
        "total_entries": len(_cache),
        "cache_ttl_seconds": CACHE_TTL_SECONDS
    }
    
    return JSONResponse({
        "status": "healthy",
        "service": "Uber MCP Server",
        "version": "1.0.0",
        "provider": "Uber API",
        "environment": UBER_ENVIRONMENT,
        "api_base": UBER_API_BASE,
        "cache": cache_stats,
        "oauth_configured": bool(UBER_CLIENT_ID and UBER_CLIENT_SECRET),
        "oauth_token_active": bool(_oauth_token and _oauth_token.get("access_token")),
        "endpoints": {
            "mcp": f"{os.getenv('BASE_URL', 'http://localhost:3002')}/mcp",
            "health": f"{os.getenv('BASE_URL', 'http://localhost:3002')}/health",
            "oauth_callback": f"{os.getenv('BASE_URL', 'http://localhost:3002')}/callback"
        }
    })


if __name__ == "__main__":
    main()
