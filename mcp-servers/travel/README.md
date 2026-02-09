# Travel Search MCP Server

Zero-config travel search powered by SerpApi. Search flights and hotels with Claude Desktop using real Google Flights and Google Hotels data.

## Features

- ✈️ **Flights**: Search flights, find cheapest options, compare airlines
- 🏨 **Hotels**: Search hotels, filter by price/rating, get detailed info
- 🔍 **Web search**: `search` tool compatible with [SerpApi MCP](https://serpapi.com/mcp) (params.q, params.location, mode)
- 🔑 **Zero Config**: Users just install - your API key is baked in
- 💾 **Smart Caching**: 5-minute cache reduces API costs by 50-70%
- 🚀 **FastMCP v3**: Production-ready MCP server
- 🌐 **Real Data**: Google Flights & Hotels via SerpApi

## Quick Start

### 1. Install Dependencies

```bash
cd mcp-servers/travel
uv sync
```

### 2. Get SerpApi Key

1. Sign up at [SerpApi](https://serpapi.com/)
2. Get your API key from the dashboard
3. Free tier: **250 searches/month**
4. Paid plans start at $25/month for 1,000 searches

### 3. Configure Environment

Create `.env` file:

```bash
cp .env.example .env
```

Add your SerpApi key to `.env`:

```env
SERPAPI_KEY=your_api_key_here
PORT=3001
BASE_URL=http://localhost:3001
```

### 4. Run Server

```bash
uv run server.py
```

Output:

```
✈️  🏨==========================================================
🚀 Starting Travel Search MCP Server (SerpApi)
============================================================
📡 Server: http://localhost:3001
📡 MCP endpoint: http://localhost:3001/mcp
```

### 5. Configure Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "travel": {
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

### 6. Start Searching

Open Claude Desktop and try:

```
"Find me flights from LAX to JFK on March 15, 2026"
"Search hotels in Paris for March 20-25"
"Find the cheapest round-trip from SFO to NYC next week"
"Show me budget hotels in Tokyo under $100/night"
```

## Available Tools

### Flight Tools (3 tools)

#### `search_flights`

Search for flights between two airports.

**Parameters:**

- `departure_id` - Airport code (e.g., "LAX", "JFK")
- `arrival_id` - Destination airport code
- `outbound_date` - Departure date (YYYY-MM-DD)
- `return_date` - Optional return date for round-trip
- `adults` - Number of passengers (default: 1)
- `currency` - Currency code (default: "USD")
- `max_results` - Max results (default: 10)

**Example:**

```python
search_flights(
    departure_id="LAX",
    arrival_id="JFK",
    outbound_date="2026-03-15",
    return_date="2026-03-22",
    adults=2
)
```

#### `get_cheapest_flights`

Find cheapest round-trip flights with flexible dates.

**Parameters:**

- `departure_id` - Airport code
- `arrival_id` - Destination airport code
- `days_from_now` - Start searching X days from today (default: 7)
- `trip_length` - Trip duration in days (default: 7)
- `adults` - Number of passengers (default: 1)

### Web search (SerpApi MCP compatible)

The `search` tool follows [SerpApi MCP](https://serpapi.com/mcp): same parameters and response shape as the hosted MCP.

#### `search`

**Arguments:**

- `params` (object) — engine-specific parameters. Required: `params.q` (search query). Optional: `params.location`, `params.engine` ("google" | "google_light"), `params.num`
- `mode` (string) — `"complete"` (default) or `"compact"` for concise output

**Example:**

```json
{"name": "search", "arguments": {"params": {"q": "best coffee in Austin", "location": "Austin, TX"}, "mode": "complete"}}
```

#### `get_cache_stats` & `clear_cache`

Monitor and manage the API cache (utility tools).

### Hotel Tools (3 tools)

#### `search_hotels`

Search for hotels in a location.

**Parameters:**

- `query` - Location (e.g., "New York, NY", "Paris, France")
- `check_in_date` - Check-in date (YYYY-MM-DD)
- `check_out_date` - Check-out date (YYYY-MM-DD)
- `adults` - Number of adults (default: 2)
- `currency` - Currency code (default: "USD")
- `sort_by` - Sort: "lowest_price", "highest_rating", "most_reviewed"
- `max_results` - Max results (default: 10)

**Example:**

```python
search_hotels(
    query="San Francisco, CA",
    check_in_date="2026-04-10",
    check_out_date="2026-04-15",
    adults=2,
    sort_by="lowest_price"
)
```

#### `get_hotel_details`

Get detailed information about a specific hotel.

**Parameters:**

- `hotel_id` - Property token from search results
- `check_in_date` - Check-in date (YYYY-MM-DD)
- `check_out_date` - Check-out date (YYYY-MM-DD)
- `adults` - Number of adults (default: 2)

#### `find_budget_hotels`

Find budget-friendly hotels with good ratings.

**Parameters:**

- `query` - Location to search
- `check_in_date` - Check-in date (YYYY-MM-DD)
- `check_out_date` - Check-out date (YYYY-MM-DD)
- `max_price_per_night` - Max price in USD (default: 100)
- `adults` - Number of adults (default: 2)
- `min_rating` - Minimum rating 1-5 (default: 3.5)

## Usage Examples

### Find Flights

```
"Search flights from San Francisco to Tokyo leaving March 20"
"What are the cheapest flights from NYC to London next month?"
"Show me round-trip flights LAX to MIA, departing April 1, returning April 8"
```

### Find Hotels

```
"Find hotels in Barcelona for May 10-15"
"Show me luxury hotels in Dubai with rating above 4.5"
"Find budget hotels in Rome under $80/night"
```

### Combined Searches

```
"I want to visit Paris next month for 5 days. Find me flights from NYC and hotels"
"Plan a trip to Tokyo - flights from LAX in April and budget hotels"
```

## Cost Management

### Caching Strategy

- **5-minute cache** on all searches
- Identical searches within 5 minutes = **free**
- Reduces API costs by **50-70%** in typical usage

### API Usage Estimates

**Light User** (5 searches/day):

- 150 searches/month
- Cost: **Free tier**

**Moderate User** (10 searches/day):

- 300 searches/month
- Cost: **$25/month** (Starter plan)

**Heavy User** (30 searches/day):

- 900 searches/month
- Cost: **$75/month** (Developer plan)

With caching:

- Heavy user effective: ~300-450 searches/month
- Cost: **$25-$75/month**

## Health Check

Test if the server is running:

```bash
curl http://localhost:3001/health
```

Response:

```json
{
  "status": "healthy",
  "service": "Travel Search MCP Server",
  "version": "1.0.0",
  "provider": "SerpApi (Google Flights & Hotels)",
  "cache": {
    "total_entries": 12,
    "cache_ttl_seconds": 300
  },
  "api_key_configured": true
}
```

## Development

**Project Structure:**

```
mcp-servers/travel/
├── server.py          # FastMCP server with SerpApi
├── pyproject.toml     # Dependencies (uv)
├── .env              # Your SerpApi key
├── .env.example      # Template
└── README.md         # This file
```

**Run in dev mode:**

```bash
uv run server.py
```

## Deployment

### Option 1: Prefect Horizon (Recommended)

1. Push to GitHub
2. Sign in to [Prefect Horizon](https://horizon.prefect.io)
3. Create new project from your repo
4. Set entrypoint: `server.py:mcp`
5. Add environment variable:
   - `SERPAPI_KEY`
   - `BASE_URL` (will be your Horizon URL)

Your server will be live at: `https://your-project.fastmcp.app/mcp`

### Option 2: Railway / Render

1. Connect GitHub repo
2. Set environment variables:
   - `SERPAPI_KEY`
   - `PORT` (auto-assigned)
3. Deploy automatically on push

### Option 3: Local Only

Just keep it running on your machine:

```bash
uv run server.py
```

Claude Desktop connects to `http://localhost:3001/mcp`

## Why SerpApi?

- ✅ **Zero user setup** - Your key, their convenience
- ✅ **Real Google data** - Actual Flights & Hotels results
- ✅ **No OAuth complexity** - Simple API key
- ✅ **CAPTCHA handling** - They solve it
- ✅ **Structured JSON** - Clean, parsed data
- ✅ **Legal protection** - U.S. Legal Shield included
- ✅ **Reliable** - 99.95% SLA guarantee

## SerpApi Pricing

| Plan | Searches | Cost | Throughput |
|------|----------|------|------------|
| **Free** | 250/month | $0 | 50/hour |
| **Starter** | 1,000/month | $25 | 200/hour |
| **Developer** | 5,000/month | $75 | 1,000/hour |
| **Production** | 15,000/month | $150 | 3,000/hour |

[View all plans](https://serpapi.com/pricing)

## Troubleshooting

### "SERPAPI_KEY not configured"

- Make sure `.env` file exists
- Check that `SERPAPI_KEY=your_key` is set correctly
- Restart the server after adding the key

### "No results found"

- Check airport codes are valid (IATA 3-letter codes)
- Verify dates are in YYYY-MM-DD format
- Ensure dates are in the future
- Try broadening search parameters

### Cache issues

- Use `clear_cache()` tool to force fresh results
- Check `get_cache_stats()` to see cache status

## Links

- [SerpApi](https://serpapi.com/)
- [SerpApi Google Flights Docs](https://serpapi.com/google-flights-api)
- [SerpApi Google Hotels Docs](https://serpapi.com/google-hotels-api)
- [FastMCP Docs](https://gofastmcp.com/)
- [Prefect Horizon](https://horizon.prefect.io)

## License

MIT
