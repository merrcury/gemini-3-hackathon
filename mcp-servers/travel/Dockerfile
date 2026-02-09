# Travel Search MCP Server — Cloud Run
FROM python:3.11-slim

WORKDIR /app

# Install uv (fast Python package manager)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy project files (uv.lock needed for --frozen, README.md needed by hatchling)
COPY pyproject.toml uv.lock README.md ./
COPY server.py ./

# Install dependencies with frozen lockfile (reproducible builds)
RUN uv sync --frozen

# Cloud Run sets $PORT automatically (default 8080)
# Our server reads PORT from env, so no EXPOSE needed

# Run server
CMD ["uv", "run", "server.py"]
