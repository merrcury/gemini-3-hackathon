# Uber MCP Server

Zero-config Uber integration powered by the Uber API. Get price estimates, time estimates, and available products with Claude Desktop.

## Features

- 🚗 **Price Estimates**: Get ride price estimates between locations
- ⏱️ **Time Estimates**: Check pickup times for Uber rides
- 🚙 **Products**: See available Uber products (X, Black, XL, Pool, etc.)
- 🔑 **Simple Auth**: Uses Uber Server Token (no complex OAuth for read-only)
- 💾 **Smart Caching**: 5-minute cache reduces API costs
- 🚀 **FastMCP v3**: Production-ready MCP server

## Quick Start

### 1. Install Dependencies

```bash
cd mcp-servers/uber
uv sync
```

### 2. Get Uber API Credentials

1. Sign up at [Uber Developer Portal](https://developer.uber.com/)
2. Create a new app
3. Get your **Server Token** from the dashboard
4. Server Token allows read-only access (price estimates, products)

### 3. Configure Environment

Create `.env` file:

```bash
cp .env.example .env
```

Add your Uber Server Token to `.env`:

```env
UBER_SERVER_TOKEN=your_server_token_here
PORT=3002
BASE_URL=http://localhost:3002
```

### 4. Run Server

```bash
uv run server.py
```

Output:

```
🚗===========================================================
🚀 Starting Uber MCP Server
============================================================
📡 Server: http://localhost:3002
📡 MCP endpoint: http://localhost:3002/mcp
✅ Uber Server Token configured
```

### 5. Configure Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "uber": {
      "url": "http://localhost:3002/mcp"
    }
  }
}
```

### 6. Start Using

Open Claude Desktop and try:

```
"Get Uber price estimate from San Francisco Airport to downtown"
"What Uber products are available at 37.7749, -122.4194?"
"How long will it take for an Uber to arrive at Times Square?"
```

## Available Tools

### Price Estimates (1 tool)

#### `get_price_estimate`

Get price estimates for rides between two locations.

**Parameters:**

- `start_latitude` - Starting location latitude
- `start_longitude` - Starting location longitude
- `end_latitude` - Destination latitude
- `end_longitude` - Destination longitude

**Example:**

```python
get_price_estimate(
    start_latitude=37.7749,
    start_longitude=-122.4194,
    end_latitude=37.7849,
    end_longitude=-122.4094
)
```

**Returns:**

```json
{
  "route": {
    "start": {"lat": 37.7749, "lng": -122.4194},
    "end": {"lat": 37.7849, "lng": -122.4094}
  },
  "estimates": [
    {
      "product_name": "UberX",
      "estimate": "$8-10",
      "low_estimate": 8,
      "high_estimate": 10,
      "currency_code": "USD",
      "duration": 420,
      "distance": 2.5,
      "surge_multiplier": 1.0
    }
  ]
}
```

### Time Estimates (1 tool)

#### `get_time_estimate`

Get estimated pickup time for Uber rides.

**Parameters:**

- `start_latitude` - Starting location latitude
- `start_longitude` - Starting location longitude
- `product_id` - Optional specific product ID

**Example:**

```python
get_time_estimate(
    start_latitude=37.7749,
    start_longitude=-122.4194
)
```

### Product Tools (1 tool)

#### `get_products`

Get available Uber products at a location.

**Parameters:**

- `latitude` - Location latitude
- `longitude` - Location longitude

**Example:**

```python
get_products(
    latitude=37.7749,
    longitude=-122.4194
)
```

**Returns:**

```json
{
  "location": {"lat": 37.7749, "lng": -122.4194},
  "products": [
    {
      "product_id": "abc123",
      "name": "UberX",
      "description": "Affordable rides, all to yourself",
      "capacity": 4,
      "shared": false
    },
    {
      "product_id": "def456",
      "name": "UberXL",
      "description": "Affordable rides for groups up to 6",
      "capacity": 6,
      "shared": false
    }
  ]
}
```

### Utility Tools (3 tools)

- `geocode_address` - Helper for converting addresses to coordinates
- `get_cache_stats` - Monitor API cache
- `clear_cache` - Clear cache for fresh results

## Usage Examples

### Get Price Estimate

```
"What's the Uber price from SF Airport (37.6213, -122.3790) to downtown SF (37.7749, -122.4194)?"
"Compare Uber prices from Times Square to JFK airport"
```

### Check Available Products

```
"What Uber rides are available in San Francisco?"
"Show me Uber options at 40.7128, -74.0060"
```

### Check Pickup Time

```
"How long for an Uber to arrive at my location?"
"Uber wait time at LAX airport"
```

## Common City Coordinates

For quick testing:

| City | Coordinates |
|------|-------------|
| **San Francisco** | 37.7749, -122.4194 |
| **New York** | 40.7128, -74.0060 |
| **Los Angeles** | 34.0522, -118.2437 |
| **Chicago** | 41.8781, -87.6298 |
| **Austin** | 30.2672, -97.7431 |
| **Seattle** | 47.6062, -122.3321 |
| **Boston** | 42.3601, -71.0589 |

### Airports

| Airport | Coordinates |
|---------|-------------|
| **SFO** (San Francisco) | 37.6213, -122.3790 |
| **LAX** (Los Angeles) | 33.9416, -118.4085 |
| **JFK** (New York) | 40.6413, -73.7781 |
| **ORD** (Chicago) | 41.9742, -87.9073 |

## Authentication

### Server Token (Current Implementation)

**What it allows:**

- ✅ Price estimates
- ✅ Time estimates  
- ✅ Product availability
- ❌ No ride requests
- ❌ No ride history

**How to get it:**

1. Go to <https://developer.uber.com/>
2. Create an app
3. Copy the Server Token from dashboard
4. Add to `.env` file

### OAuth (For Future Enhancement)

For requesting rides and accessing user data:

- Requires OAuth 2.0 flow
- User must authenticate
- More complex setup
- Can request/cancel rides
- Access ride history

## API Rate Limits

Uber API has rate limits:

- **Server Token**: Higher limits for read-only operations
- **User Token**: Lower limits per user

**Caching helps:**

- 5-minute cache on all GET requests
- Reduces API calls by 50-70%
- Saves on rate limit quota

## Cost & Usage

**Uber API Pricing:**

- **Free tier**: Limited requests per month
- **Standard tier**: Pay per request
- **Enterprise**: Custom pricing

Check [Uber API Pricing](https://developer.uber.com/docs/pricing) for current rates.

## Health Check

Test if the server is running:

```bash
curl http://localhost:3002/health
```

Response:

```json
{
  "status": "healthy",
  "service": "Uber MCP Server",
  "version": "1.0.0",
  "provider": "Uber API",
  "server_token_configured": true
}
```

## Development

**Project Structure:**

```
mcp-servers/uber/
├── server.py          # FastMCP server with Uber API
├── pyproject.toml     # Dependencies (uv)
├── .env              # Your Uber API token
├── .env.example      # Template
└── README.md         # This file
```

**Run in dev mode:**

```bash
uv run server.py
```

## Troubleshooting

### "UBER_SERVER_TOKEN not configured"

- Make sure `.env` file exists
- Check that `UBER_SERVER_TOKEN=your_token` is set correctly
- Restart the server after adding the token

### "401 Unauthorized"

- Your Server Token may be invalid or expired
- Regenerate token from Uber Developer Portal
- Make sure token has correct permissions

### "No products available"

- Uber may not operate in that location
- Check coordinates are correct (latitude, longitude)
- Try a major city like SF, NYC, LA

### Rate Limit Errors

- Use `get_cache_stats()` to check cache
- Wait a few minutes before retrying
- Upgrade to higher API tier if needed

## Deployment

### Option 1: Prefect Horizon

1. Push to GitHub
2. Create project in Horizon
3. Set environment variables:
   - `UBER_SERVER_TOKEN`
   - `BASE_URL`

### Option 2: Docker

```bash
docker build -t uber-mcp .
docker run -p 3002:3002 -e UBER_SERVER_TOKEN=your_token uber-mcp
```

### Option 3: Local Only

Keep it running on your machine - Claude Desktop connects to `http://localhost:3002/mcp`

## Future Enhancements

**Possible additions:**

- 🔐 OAuth 2.0 for ride requests
- 🚗 Request rides programmatically
- 📊 Ride history and receipts
- 🗺️ Built-in geocoding
- 📍 Save favorite locations
- 💳 Payment methods management

## Links

- [Uber Developer Portal](https://developer.uber.com/)
- [Uber API Docs](https://developer.uber.com/docs/riders/introduction)
- [FastMCP Docs](https://gofastmcp.com/)
- [Prefect Horizon](https://horizon.prefect.io)

## License

MIT
