import logging
import os
import sys
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import functions_framework
import httpx
from cachetools import TTLCache
from fastapi import Depends, FastAPI, HTTPException, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel

# --- Configuration & Logging ---
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    stream=sys.stdout
)
logger = logging.getLogger(__name__)

# Clerk Config (Set these in your Environment Variables)
CLERK_JWKS_URL = os.getenv("CLERK_JWKS_URL")

# JWKS Cache: Keep public keys for 24 hours to avoid hitting Clerk on every request
jwks_cache = TTLCache(maxsize=1, ttl=86400)

# --- FastAPI Setup ---
app = FastAPI(
    title="2nd Brain API",
    description="A secure personal memory and knowledge management system with Clerk authentication.",
    version="1.0.0"
)

security = HTTPBearer()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Memory Initialization with Detailed Error Logging ---
import asyncio

memory = None
memory_error = None

async def initialize_memory():
    """Initialize Mem0 with detailed error reporting."""
    global memory, memory_error
    try:
        logger.info("=" * 80)
        logger.info("STARTING MEM0 INITIALIZATION")
        logger.info("=" * 80)
        
        from mem0 import AsyncMemory
        logger.info("✓ Successfully imported AsyncMemory from mem0")
        
        # Get configuration from environment variables
        neo4j_username = os.getenv("NEO4J_USERNAME", "neo4j")
        neo4j_password = os.getenv("NEO4J_PASSWORD")
        qdrant_host = os.getenv("QDRANT_HOST")
        neo4j_url = os.getenv("NEO4J_URL")
        openai_api_key = os.getenv("OPENAI_API_KEY")
        logger.info(f"Configuration:")
        logger.info(f"  - Qdrant Host: {qdrant_host}:6333")
        logger.info(f"  - Neo4j URL: {neo4j_url}")
        logger.info(f"  - Neo4j Username: {neo4j_username}")
        logger.info(f"  - Neo4j Password: {'***' if neo4j_password else '(not set)'}")
        
        #we can add reranking here as well, 
        config = {

            "llm": {
                "provider": "openai",
                "config": {
                    "model": "gpt-4o-mini",
                    "api_key": openai_api_key, # Injecting the key here
                }
            },
            "embedder": {
                "provider": "openai",
                "config": {
                    "model": "text-embedding-3-small",
                    "api_key": openai_api_key
                },
            },
            "vector_store": {
                "provider": "qdrant",
                "config": {
                    "host": qdrant_host,
                    "port": 6333
                }
            },
            "graph_store": {
                "provider": "neo4j",
                "config": {
                    "url": neo4j_url,
                    "database": "neo4j",
                    "username": neo4j_username,
                    "password": neo4j_password
                }
            },
            "version": "v1.1"
        }
        
        logger.info(f"Calling AsyncMemory.from_config()...")
        memory = await AsyncMemory.from_config(config)
        logger.info("✓ Mem0 AsyncMemory successfully initialized")
        logger.info("=" * 80)
        return True
        
    except ImportError as e:
        memory_error = f"Mem0 library not installed: {e}"
        logger.error(f"✗ Import Error: {memory_error}")
        logger.error("=" * 80)
        return False
    except ValueError as e:
        memory_error = f"Configuration Error: {e}"
        logger.error(f"✗ Configuration Error: {memory_error}")
        logger.error("=" * 80)
        return False
    except Exception as e:
        memory_error = f"Initialization Error: {type(e).__name__}: {str(e)}"
        logger.error(f"✗ Mem0 Init Failed: {memory_error}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        logger.error("=" * 80)
        return False

# Call initialization on startup using FastAPI startup event
@app.on_event("startup")
async def startup_event():
    logger.info("🚀 FastAPI app startup - initializing memory...")
    await initialize_memory()

# --- Auth Dependency ---
async def get_current_user(auth: HTTPAuthorizationCredentials = Security(security)) -> str:
    """
    Decodes Clerk JWT and returns user_id (sub).
    
    This function validates the Bearer token against Clerk's public keys (JWKS).
    The token must be provided in the Authorization header as: Bearer <token>
    """
    token = auth.credentials
    try:
        # Get JWKS (from cache or Clerk)
        jwks = jwks_cache.get("keys")
        if not jwks:
            async with httpx.AsyncClient() as client:
                resp = await client.get(CLERK_JWKS_URL, timeout=10.0)
                resp.raise_for_status()
                jwks = resp.json()
                jwks_cache["keys"] = jwks
        
        # Verify JWT
        payload = jwt.decode(
            token,
            jwks,
            algorithms=["RS256"],
            options={"verify_at_hash": False}
        )
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="User ID missing in token")
        logger.info(f"✓ User authenticated: {user_id}")
        return user_id
    except JWTError as e:
        logger.warning(f"JWT Validation Error: {e}")
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    except httpx.HTTPError as e:
        logger.error(f"Clerk JWKS fetch failed: {e}")
        raise HTTPException(status_code=502, detail="Authentication service unavailable")
    except Exception as e:
        logger.error(f"Auth Exception: {type(e).__name__}: {e}")
        raise HTTPException(status_code=500, detail="Internal Auth Error")

# --- Schemas ---
class Message(BaseModel):
    """Represents a single message in a conversation."""
    role: str
    content: str

class MemoryAddRequest(BaseModel):
    """Request body for adding memories to the brain."""
    messages: List[Message]
    metadata: Optional[Dict[str, Any]] = None

# --- Custom OpenAPI Schema ---
def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    
    openapi_schema = get_openapi(
        title="2nd Brain API",
        version="1.0.0",
        description="A secure personal memory and knowledge management system. All endpoints require Clerk authentication.",
        routes=app.routes,
    )
    
    # Add security scheme for Bearer token
    openapi_schema["components"]["securitySchemes"] = {
        "bearerAuth": {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
            "description": "Clerk JWT Bearer token. Obtain from Clerk authentication."
        }
    }
    
    # Apply security globally
    openapi_schema["security"] = [{"bearerAuth": []}]
    
    app.openapi_schema = openapi_schema
    return app.openapi_schema

app.openapi = custom_openapi

# --- API Endpoints ---

@app.get(
    "/health",
    tags=["System"],
    summary="Health Check",
    description="Check if the API and memory service are operational.",
    include_in_schema=False  # Don't require auth for health check
)
async def health():
    """Returns the health status of the API and memory service."""
    status = "healthy"
    memory_status = "connected" if memory else "disconnected"
    
    result = {
        "status": status,
        "memory": memory_status,
        "timestamp": datetime.utcnow().isoformat()
    }
    
    # Include error details if memory failed to initialize
    if not memory and memory_error:
        result["memory_error"] = memory_error
        result["status"] = "degraded"
    
    return result

@app.post(
    "/add",
    tags=["Memory"],
    summary="Add to Brain",
    description="Add messages and metadata to your personal brain. Requires authentication.",
    responses={
        200: {"description": "Successfully added to memory"},
        401: {"description": "Unauthorized - invalid or missing token"},
        503: {"description": "Memory service unavailable"}
    }
)
async def add_to_brain(request: MemoryAddRequest, user_id: str = Depends(get_current_user)):
    """
    Add new memories to your personal brain.
    
    - **messages**: List of Message objects with role and content
    - **metadata**: Optional metadata dictionary associated with the memories
    
    Returns the result of the memory operation including status and data.
    """
    if not memory:
        logger.error(f"Memory service unavailable: {memory_error}")
        raise HTTPException(
            status_code=503,
            detail=f"Memory service unavailable. Error: {memory_error}"
        )
    
    try:
        msg_list = [m.model_dump() for m in request.messages]
        logger.info(f"Adding {len(msg_list)} messages for user {user_id}")
        result = await memory.add(msg_list, user_id=user_id, metadata=request.metadata)
        logger.info(f"✓ Successfully added memories for user {user_id}")
        return {"status": "success", "user_id": user_id, "data": result}
    except Exception as e:
        logger.error(f"Memory add failed: {type(e).__name__}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to add memories: {str(e)}")

@app.get(
    "/memories",
    tags=["Memory"],
    summary="List All Memories",
    description="Retrieve all memories for the authenticated user.",
    responses={
        200: {"description": "Successfully retrieved memories"},
        401: {"description": "Unauthorized - invalid or missing token"},
        503: {"description": "Memory service unavailable"}
    }
)
async def list_memories(user_id: str = Depends(get_current_user)):
    """
    Get all memories stored for your account.
    
    Returns a list of all memories associated with your user ID.
    """
    if not memory:
        raise HTTPException(status_code=503, detail=f"Memory service unavailable: {memory_error}")
    
    try:
        logger.info(f"Retrieving all memories for user {user_id}")
        results = await memory.get_all(user_id=user_id)
        logger.info(f"✓ Retrieved {len(results) if results else 0} memories for user {user_id}")
        return {"user_id": user_id, "memories": results}
    except Exception as e:
        logger.error(f"Memory retrieval failed: {type(e).__name__}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to retrieve memories: {str(e)}")

@app.post(
    "/search",
    tags=["Memory"],
    summary="Search Memories",
    description="Search through your memories using a query string.",
    responses={
        200: {"description": "Successfully retrieved search results"},
        401: {"description": "Unauthorized - invalid or missing token"},
        503: {"description": "Memory service unavailable"}
    }
)
async def query_brain(query: str, limit: int = 5, user_id: str = Depends(get_current_user)):
    """
    Search your brain for relevant memories.
    
    - **query**: Search query string
    - **limit**: Maximum number of results to return (default: 5)
    
    Returns matching memories based on semantic similarity.
    """
    if not memory:
        raise HTTPException(status_code=503, detail=f"Memory service unavailable: {memory_error}")
    
    try:
        logger.info(f"Searching memories for user {user_id} with query: '{query}' (limit: {limit})")
        results = await memory.search(query=query, user_id=user_id, limit=limit)
        logger.info(f"✓ Found {len(results) if results else 0} results for user {user_id}")
        return {"results": results}
    except Exception as e:
        logger.error(f"Memory search failed: {type(e).__name__}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to search memories: {str(e)}")

# --- Cloud Function Entry Point (Improved) ---
@functions_framework.http
def api(request):
    """
    Cloud Functions HTTP handler that routes requests to FastAPI.
    """
    from starlette.testclient import TestClient
    
    try:
        with TestClient(app) as client:
            # Map Cloud Function request to FastAPI via TestClient
            method = request.method.lower()
            path = request.path
            
            # Preserve query parameters
            if request.args:
                path += "?" + "&".join(f"{k}={v}" for k, v in request.args.items())
            
            # Extract request body if JSON
            json_data = request.get_json(silent=True) if request.is_json else None
            
            # Preserve headers
            headers = dict(request.headers)
            
            # Make request to FastAPI
            response = client.request(method, path, json=json_data, headers=headers)
            
            # Return response
            from flask import Response
            return Response(
                response.content,
                status=response.status_code,
                headers=dict(response.headers)
            )
    except Exception as e:
        logger.error(f"Cloud Function handler error: {type(e).__name__}: {e}")
        from flask import Response
        return Response(
            f'{{"error": "Internal server error: {str(e)}"}}',
            status=500,
            mimetype="application/json"
        )