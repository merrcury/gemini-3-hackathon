import json
import os
import secrets
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

import httpx
from dotenv import load_dotenv
from fastmcp import FastMCP
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

# Load environment variables
load_dotenv()

# =============================================================================
# STATIC API KEY AUTH
# =============================================================================

API_KEY = os.getenv("API_KEY", "")

class APIKeyMiddleware(BaseHTTPMiddleware):
    """Middleware that enforces a static API key on all routes except /health."""

    async def dispatch(self, request: Request, call_next):
        # Always allow health checks (Cloud Run needs this unauthenticated)
        if request.url.path == "/health":
            return await call_next(request)

        # If no API_KEY is configured, allow all requests (local dev)
        if not API_KEY:
            return await call_next(request)

        # Check X-API-Key header
        provided_key = request.headers.get("x-api-key", "")

        # Also accept Authorization: Bearer <API_KEY> (e.g. for Cloud Run / travel-mcp-server)
        if not provided_key:
            auth = request.headers.get("authorization", "")
            if auth.lower().startswith("bearer "):
                provided_key = auth[7:].strip()

        # Query param as fallback (useful for browser/quick testing)
        if not provided_key:
            provided_key = request.query_params.get("api_key", "")

        # Constant-time comparison to prevent timing attacks
        if not provided_key or not secrets.compare_digest(provided_key, API_KEY):
            return JSONResponse(
                {"error": "Unauthorized", "message": "Invalid or missing API key"},
                status_code=401,
            )

        return await call_next(request)


# =============================================================================
# MCP SERVER
# =============================================================================

# Create FastMCP server (Travel + web search — all via SerpAPI)
mcp = FastMCP(
    name="Travel Search MCP",
    instructions="""
This server provides flight/hotel search and web search via SerpAPI.

Available tools:
- Flights: search_flights, get_cheapest_flights
- Hotels: search_hotels, get_hotel_details, find_budget_hotels
- Web search: search (Google search for weather, news, lookups, real-time info)

Authentication: Requires X-API-Key header when API_KEY is set.
    """.strip(),
    version="1.0.0",
    website_url="https://github.com/merrcury/gemini-3-hack",
)

# SerpApi configuration
SERPAPI_KEY = os.getenv("SERPAPI_KEY", "")
SERPAPI_BASE_URL = "https://serpapi.com/search"

# Simple in-memory cache with timestamps
_cache: Dict[str, Dict[str, Any]] = {}
CACHE_TTL_SECONDS = 300  # 5 minutes

def _get_cache_key(endpoint: str, params: Dict) -> str:
    """Generate cache key from endpoint and params."""
    sorted_params = sorted(params.items())
    return f"{endpoint}:{json.dumps(sorted_params, sort_keys=True)}"

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

async def _call_serpapi(engine: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """Call SerpApi with caching."""
    # Add API key and engine
    all_params = {
        "api_key": SERPAPI_KEY,
        "engine": engine,
        **params
    }
    
    # Check cache
    cache_key = _get_cache_key(engine, params)
    cached = _get_cached(cache_key)
    if cached:
        return cached
    
    # Make API request
    async with httpx.AsyncClient() as client:
        response = await client.get(SERPAPI_BASE_URL, params=all_params, timeout=30.0)
        response.raise_for_status()
        data = response.json()
    
    # Cache the result
    _set_cache(cache_key, data)
    
    return data


# ============================================================================
# FLIGHT TOOLS
# ============================================================================

@mcp.tool()
async def search_flights(
    departure_id: str,
    arrival_id: str,
    outbound_date: str,
    return_date: Optional[str] = None,
    adults: int = 1,
    currency: str = "USD",
    max_results: int = 10
) -> str:
    """Search for flights between two airports using Google Flights.
    
    Args:
        departure_id: Departure airport code (e.g., "LAX", "JFK")
        arrival_id: Arrival airport code (e.g., "SFO", "LHR")
        outbound_date: Departure date in YYYY-MM-DD format (e.g., "2026-03-15")
        return_date: Optional return date for round-trip (YYYY-MM-DD)
        adults: Number of adult passengers (default: 1)
        currency: Currency code (default: "USD")
        max_results: Maximum number of results to return (default: 10)
    
    Returns:
        JSON string with flight options including price, duration, airlines, stops
    """
    if not SERPAPI_KEY:
        return "❌ Error: SERPAPI_KEY not configured. Please add it to .env file."
    
    try:
        params = {
            "departure_id": departure_id.upper(),
            "arrival_id": arrival_id.upper(),
            "outbound_date": outbound_date,
            "adults": str(adults),
            "currency": currency,
            "hl": "en",
        }
        
        if return_date:
            params["return_date"] = return_date
            params["type"] = "1"  # Round trip
        else:
            params["type"] = "2"  # One way
        
        data = await _call_serpapi("google_flights", params)
        
        # Parse flight results
        best_flights = data.get("best_flights", [])
        other_flights = data.get("other_flights", [])
        all_flights = (best_flights + other_flights)[:max_results]
        
        if not all_flights:
            return f"No flights found from {departure_id} to {arrival_id} on {outbound_date}"
        
        # Format results
        results = []
        for flight in all_flights:
            # Get first flight segment details
            first_leg = flight["flights"][0]
            
            result = {
                "price": flight.get("price"),
                "currency": currency,
                "type": flight.get("type", "Unknown"),
                "airline": first_leg.get("airline"),
                "flight_number": first_leg.get("flight_number"),
                "departure_airport": first_leg.get("departure_airport", {}).get("id"),
                "arrival_airport": first_leg.get("arrival_airport", {}).get("id"),
                "departure_time": first_leg.get("departure_airport", {}).get("time"),
                "arrival_time": first_leg.get("arrival_airport", {}).get("time"),
                "duration": first_leg.get("duration"),
                "stops": flight.get("total_duration", ""),
                "layovers": [leg.get("layovers", []) for leg in flight.get("flights", [])],
                "carbon_emissions": flight.get("carbon_emissions", {}),
                "booking_token": flight.get("booking_token", "")
            }
            results.append(result)
        
        # Add search info
        search_params = data.get("search_parameters", {})
        output = {
            "search": {
                "from": departure_id.upper(),
                "to": arrival_id.upper(),
                "outbound_date": outbound_date,
                "return_date": return_date,
                "adults": adults,
            },
            "flights": results,
            "total_results": len(results),
            "cached": "from cache" if _get_cached(_get_cache_key("google_flights", params)) else "live"
        }
        
        return json.dumps(output, indent=2)
        
    except httpx.HTTPStatusError as e:
        return f"❌ SerpApi Error: {e.response.status_code} - {e.response.text}"
    except Exception as e:
        return f"❌ Error: {str(e)}"


@mcp.tool()
async def get_cheapest_flights(
    departure_id: str,
    arrival_id: str,
    days_from_now: int = 7,
    trip_length: int = 7,
    adults: int = 1
) -> str:
    """Find the cheapest round-trip flights within a flexible date range.
    
    Args:
        departure_id: Departure airport code (e.g., "LAX")
        arrival_id: Arrival airport code (e.g., "NYC")
        days_from_now: Start searching this many days from today (default: 7)
        trip_length: Length of trip in days (default: 7)
        adults: Number of adult passengers (default: 1)
    
    Returns:
        JSON string with cheapest flight options
    """
    if not SERPAPI_KEY:
        return "❌ Error: SERPAPI_KEY not configured. Please add it to .env file."
    
    try:
        # Calculate dates
        departure_date = (datetime.now() + timedelta(days=days_from_now)).strftime("%Y-%m-%d")
        return_date = (datetime.now() + timedelta(days=days_from_now + trip_length)).strftime("%Y-%m-%d")
        
        return await search_flights(
            departure_id=departure_id,
            arrival_id=arrival_id,
            outbound_date=departure_date,
            return_date=return_date,
            adults=adults,
            max_results=5
        )
        
    except Exception as e:
        return f"❌ Error: {str(e)}"


# ============================================================================
# HOTEL TOOLS
# ============================================================================

@mcp.tool()
async def search_hotels(
    query: str,
    check_in_date: str,
    check_out_date: str,
    adults: int = 2,
    currency: str = "USD",
    sort_by: str = "lowest_price",
    max_results: int = 10
) -> str:
    """Search for hotels in a location using Google Hotels.
    
    Args:
        query: Location to search (e.g., "New York, NY", "Paris, France")
        check_in_date: Check-in date in YYYY-MM-DD format
        check_out_date: Check-out date in YYYY-MM-DD format
        adults: Number of adults (default: 2)
        currency: Currency code (default: "USD")
        sort_by: Sort order - "lowest_price", "highest_rating", or "most_reviewed"
        max_results: Maximum number of results (default: 10)
    
    Returns:
        JSON string with hotel options including price, rating, amenities, location
    """
    if not SERPAPI_KEY:
        return "❌ Error: SERPAPI_KEY not configured. Please add it to .env file."
    
    try:
        # Map sort_by string to SerpApi numeric values
        sort_by_map = {
            "lowest_price": "3",
            "highest_rating": "8",
            "most_reviewed": "13"
        }
        sort_by_value = sort_by_map.get(sort_by, "3")  # Default to lowest_price
        
        params = {
            "q": query,
            "check_in_date": check_in_date,
            "check_out_date": check_out_date,
            "adults": str(adults),
            "currency": currency,
            "sort_by": sort_by_value,
            "hl": "en",
        }
        
        data = await _call_serpapi("google_hotels", params)
        
        # Parse hotel results
        properties = data.get("properties", [])[:max_results]
        
        if not properties:
            return f"No hotels found in {query} for {check_in_date} to {check_out_date}"
        
        # Format results
        results = []
        for hotel in properties:
            result = {
                "name": hotel.get("name"),
                "type": hotel.get("type"),
                "description": hotel.get("description", ""),
                "price": hotel.get("rate_per_night", {}).get("lowest"),
                "currency": currency,
                "total_rate": hotel.get("total_rate", {}),
                "rating": hotel.get("overall_rating"),
                "reviews": hotel.get("reviews"),
                "hotel_class": hotel.get("hotel_class"),
                "amenities": hotel.get("amenities", []),
                "location": {
                    "gps": hotel.get("gps_coordinates", {}),
                    "address": hotel.get("location", "")
                },
                "check_in_time": hotel.get("check_in_time"),
                "check_out_time": hotel.get("check_out_time"),
                "images": hotel.get("images", [])[:3],  # First 3 images
                "link": hotel.get("link", ""),
                "hotel_id": hotel.get("property_token", "")
            }
            results.append(result)
        
        # Add search info
        output = {
            "search": {
                "location": query,
                "check_in": check_in_date,
                "check_out": check_out_date,
                "adults": adults,
                "nights": (datetime.fromisoformat(check_out_date) - datetime.fromisoformat(check_in_date)).days
            },
            "hotels": results,
            "total_results": len(results),
            "cached": "from cache" if _get_cached(_get_cache_key("google_hotels", params)) else "live"
        }
        
        return json.dumps(output, indent=2)
        
    except httpx.HTTPStatusError as e:
        return f"❌ SerpApi Error: {e.response.status_code} - {e.response.text}"
    except Exception as e:
        return f"❌ Error: {str(e)}"


@mcp.tool()
async def get_hotel_details(
    hotel_id: str,
    check_in_date: str,
    check_out_date: str,
    adults: int = 2,
    currency: str = "USD"
) -> str:
    """Get detailed information about a specific hotel.
    
    Args:
        hotel_id: Hotel property token from search results
        check_in_date: Check-in date in YYYY-MM-DD format
        check_out_date: Check-out date in YYYY-MM-DD format
        adults: Number of adults (default: 2)
        currency: Currency code (default: "USD")
    
    Returns:
        JSON string with detailed hotel information including reviews, policies, amenities
    """
    if not SERPAPI_KEY:
        return "❌ Error: SERPAPI_KEY not configured. Please add it to .env file."
    
    try:
        params = {
            "property_token": hotel_id,
            "check_in_date": check_in_date,
            "check_out_date": check_out_date,
            "adults": str(adults),
            "currency": currency,
            "hl": "en",
        }
        
        data = await _call_serpapi("google_hotels", params)
        
        # Get property details
        property_info = data.get("property", {})
        
        if not property_info:
            return f"Hotel details not found for ID: {hotel_id}"
        
        result = {
            "name": property_info.get("name"),
            "type": property_info.get("type"),
            "description": property_info.get("description"),
            "rating": property_info.get("overall_rating"),
            "reviews_count": property_info.get("reviews"),
            "hotel_class": property_info.get("hotel_class"),
            "amenities": property_info.get("amenities", []),
            "prices": {
                "per_night": property_info.get("rate_per_night", {}),
                "total": property_info.get("total_rate", {})
            },
            "location": {
                "address": property_info.get("address"),
                "gps": property_info.get("gps_coordinates", {}),
                "neighborhood": property_info.get("neighborhood", "")
            },
            "policies": {
                "check_in": property_info.get("check_in_time"),
                "check_out": property_info.get("check_out_time"),
                "children_policy": property_info.get("children_policy", ""),
                "pets_policy": property_info.get("pets_policy", "")
            },
            "images": property_info.get("images", []),
            "nearby_places": property_info.get("nearby_places", []),
            "link": property_info.get("link")
        }
        
        return json.dumps(result, indent=2)
        
    except httpx.HTTPStatusError as e:
        return f"❌ SerpApi Error: {e.response.status_code} - {e.response.text}"
    except Exception as e:
        return f"❌ Error: {str(e)}"


@mcp.tool()
async def find_budget_hotels(
    query: str,
    check_in_date: str,
    check_out_date: str,
    max_price_per_night: int = 100,
    adults: int = 2,
    min_rating: float = 3.5
) -> str:
    """Find budget-friendly hotels with good ratings.
    
    Args:
        query: Location to search (e.g., "San Francisco, CA")
        check_in_date: Check-in date in YYYY-MM-DD format
        check_out_date: Check-out date in YYYY-MM-DD format
        max_price_per_night: Maximum price per night in USD (default: 100)
        adults: Number of adults (default: 2)
        min_rating: Minimum rating (1.0-5.0, default: 3.5)
    
    Returns:
        JSON string with budget hotel options filtered by price and rating
    """
    # Search hotels sorted by lowest price
    results_str = await search_hotels(
        query=query,
        check_in_date=check_in_date,
        check_out_date=check_out_date,
        adults=adults,
        sort_by="lowest_price",
        max_results=20
    )
    
    # Check if there was an error
    if results_str.startswith("❌"):
        return results_str
    
    try:
        results = json.loads(results_str)
        
        # Filter by price and rating
        filtered_hotels = []
        for hotel in results.get("hotels", []):
            price = hotel.get("price", "")
            rating = hotel.get("rating", 0)
            
            # Extract numeric price
            if isinstance(price, str):
                price_num = float(price.replace("$", "").replace(",", "").split()[0]) if price else 999999
            else:
                price_num = price or 999999
            
            if price_num <= max_price_per_night and rating >= min_rating:
                filtered_hotels.append(hotel)
        
        results["hotels"] = filtered_hotels[:10]
        results["total_results"] = len(filtered_hotels)
        results["filters"] = {
            "max_price_per_night": max_price_per_night,
            "min_rating": min_rating
        }
        
        if not filtered_hotels:
            return f"No hotels found under ${max_price_per_night}/night with rating >= {min_rating} in {query}"
        
        return json.dumps(results, indent=2)
        
    except Exception as e:
        return f"❌ Error filtering results: {str(e)}"


# ============================================================================
# WEB SEARCH (SerpAPI — compatible with https://serpapi.com/mcp)
# ============================================================================
# Tool signature matches SerpApi MCP: params (engine-specific), mode (complete | compact).

@mcp.tool()
async def search(
    params: Dict[str, Any],
    mode: str = "complete"
) -> str:
    """Run a web search via SerpAPI. Compatible with SerpApi MCP (https://serpapi.com/mcp).
    
    Args:
        params: Engine-specific parameters. Must include "q" (search query). Optional: "location" (e.g. "New York, NY"), "engine" ("google" | "google_light"), "num" (results count, default 10).
        mode: "complete" (default) for full response, "compact" for concise output.
    
    Returns:
        JSON string with organic results, answer box, and related queries. Use Request Metadata User Location in params.location when relevant.
    """
    if not SERPAPI_KEY:
        return "❌ Error: SERPAPI_KEY not configured. Please add it to .env file."
    
    if not isinstance(params, dict) or not params.get("q"):
        return "❌ Error: params must be an object with at least \"q\" (search query). See https://serpapi.com/mcp"
    
    try:
        q = str(params.get("q", "")).strip()
        if not q:
            return "❌ Error: params.q is required."
        location = params.get("location")
        if location is not None:
            location = str(location).strip() or None
        num = 10
        if "num" in params:
            try:
                num = min(max(int(params["num"]), 1), 20)
            except (TypeError, ValueError):
                pass
        engine = str(params.get("engine", "google")).strip() or "google"
        
        api_params: Dict[str, Any] = {
            "q": q,
            "num": num,
            "hl": "en",
        }
        if location:
            api_params["location"] = location
        data = await _call_serpapi(engine, api_params)
        
        organic = data.get("organic_results", [])
        answer_box = data.get("answer_box") or data.get("knowledge_graph") or {}
        answer_text = None
        if answer_box:
            answer_text = answer_box.get("answer") or answer_box.get("title")
            if not answer_text and isinstance(answer_box, dict):
                answer_text = json.dumps(answer_box)[:500]
        
        if mode == "compact":
            output = {
                "q": q,
                "results": [
                    {"title": r.get("title"), "link": r.get("link"), "snippet": (r.get("snippet") or "")[:200]}
                    for r in organic[:num]
                ],
                "answer": answer_text,
            }
        else:
            output = {
                "query": q,
                "location": location,
                "organic_results": [
                    {"title": r.get("title"), "link": r.get("link"), "snippet": r.get("snippet")}
                    for r in organic[:num]
                ],
                "answer_box": answer_text,
                "related_queries": [r.get("query") for r in data.get("related_questions", [])[:5]],
            }
        return json.dumps(output, indent=2)
    except httpx.HTTPStatusError as e:
        return f"❌ SerpApi Error: {e.response.status_code} - {e.response.text}"
    except Exception as e:
        return f"❌ Error: {str(e)}"


# ============================================================================
# UTILITY TOOLS
# ============================================================================

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
    
    port = int(os.getenv('PORT', 3001))
    host = os.getenv('HOST', '0.0.0.0')
    base_url = os.getenv('BASE_URL', f"http://localhost:{port}")
    
    print("="*60)
    print("  Travel Search MCP Server (SerpApi)")
    print("="*60)
    print(f"  Server:       {base_url}")
    print(f"  MCP endpoint: {base_url}/mcp")
    print(f"  Health check: {base_url}/health")
    print(f"  Host:         {host}")
    print(f"  Port:         {port}")
    print(f"  API Key auth: {'ENABLED' if API_KEY else 'DISABLED (set API_KEY to enable)'}")
    print(f"  SerpApi key:  {'configured' if SERPAPI_KEY else 'MISSING'}")
    print(f"  Cache TTL:    {CACHE_TTL_SECONDS}s")
    print("="*60)
    
    if not SERPAPI_KEY:
        print("\nWARNING: SERPAPI_KEY not set. Tool calls will fail.")
    
    # Get the HTTP app from FastMCP
    app = mcp.http_app()

    # Add API key middleware FIRST (outermost = checked first)
    app.add_middleware(APIKeyMiddleware)

    # CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # Run with uvicorn
    uvicorn.run(app, host=host, port=port)


@mcp.custom_route("/health", methods=["GET"])
async def health_check(request: Request) -> JSONResponse:
    """Health check endpoint for monitoring (no auth required)."""
    base = os.getenv("BASE_URL", "http://localhost:3001")
    return JSONResponse({
        "status": "healthy",
        "service": "Travel Search MCP Server",
        "version": "1.0.0",
        "provider": "SerpApi (Google Flights, Hotels, Web Search)",
        "auth": "api_key" if API_KEY else "none",
        "serpapi_configured": bool(SERPAPI_KEY),
        "cache": {
            "entries": len(_cache),
            "ttl_seconds": CACHE_TTL_SECONDS,
        },
        "endpoints": {
            "mcp": f"{base}/mcp",
            "health": f"{base}/health",
        },
    })


if __name__ == "__main__":
    main()
