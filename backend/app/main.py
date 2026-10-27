from contextlib import asynccontextmanager
from typing import AsyncGenerator, Dict
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.database import get_db, mongo_manager

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan manager managing database initialization and cleanup."""
    await mongo_manager.connect(app=app)
    yield
    await mongo_manager.close(app=app)


app = FastAPI(
    title="Mock-interview simulator API",
    description="Backend services for real-time telemetry processing, adaptive LangGraph interviewing, and multi-dimensional scoring.",
    version="1.0.0",
    lifespan=lifespan,
)

# Enforce explicit CORS whitelist from settings - never use wildcard in authenticated environments
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
)


import time
from fastapi.responses import JSONResponse
from pymongo.errors import ConnectionFailure
from app.core.database import get_error_hint


@app.get("/health", tags=["health"])
async def health_check() -> Dict[str, str]:
    """Health check endpoint to verify ASGI backend vitality."""
    return {"status": "ok"}


@app.get("/health/db", tags=["health"])
async def health_db_check() -> JSONResponse:
    """
    Database connectivity, health, and auth collection diagnostic check.
    Returns 200 with status, database name, auth_collection_exists, and auth_document_count.
    Returns 503 if database is disconnected or unreachable.
    Never exposes raw URI, credentials, or user data.
    """
    start_time = time.perf_counter()
    try:
        db = await get_db()
        if mongo_manager.client is None or not mongo_manager._is_connected or db is None:
            raise ConnectionFailure("MongoDB client is not connected to active database")
        await mongo_manager.client.admin.command("ping")

        collections = await db.list_collection_names()
        auth_collection_exists = "auth" in collections
        auth_document_count = 0
        if auth_collection_exists:
            auth_document_count = await mongo_manager.db["auth"].count_documents({})

        latency_ms = round((time.perf_counter() - start_time) * 1000, 2)
        return JSONResponse(
            status_code=200,
            content={
                "status": "ok",
                "database": settings.MONGODB_DB_NAME,
                "auth_collection_exists": auth_collection_exists,
                "auth_document_count": auth_document_count,
                "latency_ms": latency_ms,
            },
        )
    except Exception as exc:
        hint = get_error_hint(exc)
        return JSONResponse(
            status_code=503,
            content={
                "status": "error",
                "database": settings.MONGODB_DB_NAME,
                "auth_collection_exists": False,
                "auth_document_count": 0,
                "message": hint,
            },
        )


# Mount versioned API routes
app.include_router(api_router, prefix="/api/v1")

# Mount production frontend static distribution if built
import os
from fastapi.staticfiles import StaticFiles

static_dir = os.environ.get("STATIC_DIR", "/app/static")
if not os.path.isdir(static_dir):
    for candidate in ["dist", "frontend/dist", "../dist", "/app/applet/dist"]:
        if os.path.isdir(candidate):
            static_dir = candidate
            break

if os.path.isdir(static_dir):
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=(settings.ENVIRONMENT == "development"),
    )
