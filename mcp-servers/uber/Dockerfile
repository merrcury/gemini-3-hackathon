# Dockerfile for Uber MCP Server
FROM python:3.12-slim

# Install uv
RUN pip install uv

# Set working directory
WORKDIR /app

# Copy project files
COPY pyproject.toml .
COPY server.py .

# Install dependencies
RUN uv sync

# Expose port
EXPOSE 3002

# Set environment variables
ENV PORT=3002
ENV BASE_URL=http://localhost:3002

# Run server
CMD ["uv", "run", "server.py"]
