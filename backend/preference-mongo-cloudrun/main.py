import logging
import os
import sys
from typing import Any, Dict, List, Optional

import functions_framework
import httpx
from bson.objectid import ObjectId
from cachetools import TTLCache
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt
from pydantic import BaseModel
from pymongo import MongoClient

# Load environment variables from .env file
load_dotenv()

# --- Setup & Config ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Environment Variables
CLERK_JWKS_URL = os.getenv("CLERK_JWKS_URL")
MONGODB_URI = os.getenv("MONGODB_URI")
jwks_cache = TTLCache(maxsize=1, ttl=86400)


# Initialize MongoDB (lazy - don't block startup)
mongo_client = None
db = None
preferences_collection = None

def get_mongo_collection():
    """Lazy initialization of MongoDB connection."""
    global mongo_client, db, preferences_collection
    if preferences_collection is None:
        try:
            if not MONGODB_URI:
                raise ValueError("MONGODB_URI environment variable not set")
            mongo_client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=10000, connectTimeoutMS=10000)
            db = mongo_client.get_database("2ndmind")
            preferences_collection = db["user_preferences"]
            logger.info("MongoDB initialized successfully")
        except Exception as e:
            logger.error(f"MongoDB connection error: {e}")
            raise
    return preferences_collection

app = FastAPI(title="2nd Brain Preference API")
security = HTTPBearer()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- JWT Auth Dependency ---
async def get_user_id(auth: HTTPAuthorizationCredentials = Security(security)) -> str:
    token = auth.credentials
    try:
        jwks = jwks_cache.get("keys")
        if not jwks:
            async with httpx.AsyncClient() as client:
                jwks = (await client.get(CLERK_JWKS_URL)).json()
                jwks_cache["keys"] = jwks
        
        payload = jwt.decode(token, jwks, algorithms=["RS256"])
        user_id = payload.get("user_id") or payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token: No user_id")
        return user_id
    except Exception as e:
        logger.error(f"Auth error: {e}")
        raise HTTPException(status_code=401, detail="Authentication failed")

# --- Schemas ---
class UserPreferences(BaseModel):
    preferences: dict  # Dynamic key-value pairs

# --- Endpoints ---

@app.get("/health")
async def health_check():
    """Health check endpoint for Cloud Run."""
    try:
        collection = get_mongo_collection()
        collection.database.client.admin.command('ping')
        return {"status": "healthy"}
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return {"status": "unhealthy", "error": str(e)}

@app.get("/preferences")
async def get_prefs(user_id: str = Depends(get_user_id)):
    """Retrieves all user preferences."""
    try:
        collection = get_mongo_collection()
        doc = collection.find_one({"user_id": user_id})
        if doc:
            doc.pop("_id", None)
            return doc
        return {"preferences": {}}
    except Exception as e:
        logger.error(f"Error retrieving preferences: {e}")
        raise HTTPException(status_code=500, detail="Error retrieving preferences")

@app.put("/preferences")
async def set_prefs(data: UserPreferences, user_id: str = Depends(get_user_id)):
    """Overwrites or creates the entire preferences object."""
    try:
        collection = get_mongo_collection()
        collection.replace_one(
            {"user_id": user_id},
            {"user_id": user_id, **data.model_dump()},
            upsert=True
        )
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Error setting preferences: {e}")
        raise HTTPException(status_code=500, detail="Error setting preferences")

@app.patch("/preferences")
async def update_pref(key: str, value: Any, user_id: str = Depends(get_user_id)):
    """Updates a single key-value pair without overwriting the whole document."""
    try:
        collection = get_mongo_collection()
        result = collection.update_one(
            {"user_id": user_id},
            {"$set": {f"preferences.{key}": value}},
            upsert=True
        )
        if result.matched_count == 0 and result.upserted_id is None:
            collection.insert_one({
                "user_id": user_id,
                "preferences": {key: value}
            })
        return {"status": "updated", "key": key, "value": value}
    except Exception as e:
        logger.error(f"Error updating preference: {e}")
        raise HTTPException(status_code=500, detail="Error updating preference")

@app.delete("/preferences")
async def delete_prefs(user_id: str = Depends(get_user_id)):
    """Deletes the user's preference document."""
    try:
        collection = get_mongo_collection()
        collection.delete_one({"user_id": user_id})
        return {"status": "deleted"}
    except Exception as e:
        logger.error(f"Error deleting preferences: {e}")
        raise HTTPException(status_code=500, detail="Error deleting preferences")

# --- Cloud Function Entry ---
@functions_framework.http
def api(request):
    """HTTP Cloud Function entry point."""
    from starlette.testclient import TestClient
    
    with TestClient(app) as client:
        method = request.method.lower()
        path = request.path
        
        # Reconstruct query string
        if request.args:
            path += "?" + "&".join(f"{k}={v}" for k, v in request.args.items())
        
        # Make request through FastAPI
        response = client.request(
            method, 
            path,
            json=request.get_json(silent=True) if request.is_json else None,
            headers=dict(request.headers)
        )
        
        from flask import Response
        return Response(response.content, status=response.status_code, headers=dict(response.headers))