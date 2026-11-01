import logging
import ssl
import sys
from typing import Any, Dict, List, Optional
import certifi
from fastapi import FastAPI, Request
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase, AsyncIOMotorCollection
from pymongo import ASCENDING, DESCENDING
from pymongo.errors import (
    ConnectionFailure,
    ServerSelectionTimeoutError,
    OperationFailure,
    ConfigurationError,
)

from app.core.config import AUTH_COLLECTION, get_settings

logger = logging.getLogger("uvicorn.error")
settings = get_settings()


def get_error_hint(exc: Exception) -> str:
    """Map MongoDB connection exception to user-actionable, secret-free troubleshooting hint."""
    exc_str = str(exc).lower()

    if (isinstance(exc, OperationFailure) and getattr(exc, "code", None) == 18) or "authenticationfailed" in exc_str or "authentication failed" in exc_str:
        return "Authentication failed. Check username/password and that the user has access to the database."

    if isinstance(exc, ConfigurationError) or "srv" in exc_str or "dns" in exc_str:
        return "SRV DNS lookup failed. Check pymongo[srv]/dnspython and the cluster hostname."

    if isinstance(exc, ServerSelectionTimeoutError):
        return "Atlas unreachable. Check Network Access (IP allowlist) in Atlas and your internet connection."

    if isinstance(exc, ssl.SSLError) or "ssl" in exc_str or "tls" in exc_str:
        return "TLS handshake failed. Update certifi or check system clock/proxy."

    return "Atlas unreachable. Check Network Access (IP allowlist) in Atlas and your internet connection."


class MongoManager:
    """Manages single AsyncIOMotorClient lifecycle, connection verification, and index setup."""

    def __init__(self) -> None:
        self.client: Optional[AsyncIOMotorClient] = None
        self.db: Optional[AsyncIOMotorDatabase] = None
        self._is_connected: bool = False
        self._loop: Any = None

    async def connect(self, app: Optional[FastAPI] = None, override_db_name: Optional[str] = None) -> AsyncIOMotorDatabase:
        """
        Create one AsyncIOMotorClient during FastAPI startup, verify connection via ping,
        initialize required collection indexes, and attach to app.state.
        """
        import asyncio
        try:
            current_loop = asyncio.get_running_loop()
        except RuntimeError:
            current_loop = None

        is_test_env = (settings.ENVIRONMENT == "test") or ("pytest" in sys.modules)

        if is_test_env:
            # If not explicitly overridden, default to the isolated test database
            if override_db_name is None:
                effective_db_name = settings.MONGODB_TEST_DB_NAME
            else:
                effective_db_name = override_db_name

            # Guard: Tests must NEVER run against production database (§M5)
            if effective_db_name == settings.MONGODB_DB_NAME:
                raise RuntimeError(
                    f"CRITICAL SAFETY VIOLATION: Test environment attempted to connect to production database "
                    f"'{effective_db_name}'. Tests must only connect to '{settings.MONGODB_TEST_DB_NAME}'."
                )
        else:
            effective_db_name = override_db_name or settings.MONGODB_DB_NAME

        # Fast reuse if already connected on the same active event loop
        if (
            self.client is not None
            and self._is_connected
            and self.db is not None
            and (current_loop is None or self._loop == current_loop)
        ):
            if override_db_name is None or self.db.name == effective_db_name:
                return self.db

        if self.client is not None and current_loop is not None and self._loop != current_loop:
            try:
                self.client.close()
            except Exception:
                pass
            self.client = None
            self.db = None
            self._is_connected = False

        try:
            effective_uri = settings.get_effective_mongodb_uri()
        except ValueError as val_err:
            logger.error("Configuration error: %s", val_err)
            sys.exit(1)

        host_name = settings.mongodb_host

        try:
            # Create single client instance with strict connection parameters
            self.client = AsyncIOMotorClient(
                effective_uri,
                serverSelectionTimeoutMS=settings.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
                connectTimeoutMS=settings.MONGODB_CONNECT_TIMEOUT_MS,
                maxPoolSize=settings.MONGODB_MAX_POOL_SIZE,
                minPoolSize=settings.MONGODB_MIN_POOL_SIZE,
                retryWrites=True,
                tlsCAFile=certifi.where(),
            )

            # Verify connectivity via ping command
            await self.client.admin.command("ping")
            self._is_connected = True
            self._loop = current_loop

            # Explicitly select database name - do not rely on URI path
            self.db = self.client[effective_db_name]

            logger.info("MongoDB connected: host=%s db=%s", host_name, effective_db_name)

            if app is not None:
                app.state.mongo_client = self.client
                app.state.db = self.db

            # Initialize collection indexes idempotently
            await self._ensure_indexes()
            return self.db

        except Exception as exc:
            hint = get_error_hint(exc)
            logger.error(
                "MongoDB connection failed: host=%s db=%s. Hint: %s. Error: %s",
                host_name,
                effective_db_name,
                hint,
                type(exc).__name__,
            )
            self.client = None
            self.db = None
            self._is_connected = False
            self._loop = None
            raise RuntimeError(
                f"MongoDB connection failed: host={host_name} db={effective_db_name}. Hint: {hint}"
            ) from exc

    async def _ensure_indexes(self) -> None:
        """Create collection indexes idempotently with try/except safeguards."""
        if self.db is None:
            return

        index_specs: List[tuple] = [
            # auth collection (replaces legacy users)
            (AUTH_COLLECTION, [("email", ASCENDING)], {"unique": True}),
            (AUTH_COLLECTION, [("created_at", ASCENDING)], {}),
            # resumes collection
            ("resumes", [("user_id", ASCENDING), ("created_at", DESCENDING)], {}),
            # interview_sessions collection
            ("interview_sessions", [("user_id", ASCENDING), ("started_at", DESCENDING)], {}),
            ("interview_sessions", [("session_status", ASCENDING)], {}),
            # telemetry_samples collection
            ("telemetry_samples", [("session_id", ASCENDING), ("bucket_start", ASCENDING)], {}),
            # integrity_events collection
            ("integrity_events", [("session_id", ASCENDING), ("t", ASCENDING)], {}),
            # evaluations collection
            ("evaluations", [("session_id", ASCENDING)], {"unique": True}),
            # RAG vector collections (§2.3, Q2, Q3)
            ("resume_chunks", [("user_id", ASCENDING), ("resume_id", ASCENDING)], {}),
            ("knowledge_base", [("role", ASCENDING), ("seniority", ASCENDING)], {}),
            ("interview_memory", [("session_id", ASCENDING)], {}),
        ]

        for col_name, keys, kwargs in index_specs:
            try:
                col = self.db[col_name]
                await col.create_index(keys, **kwargs)
            except Exception as e:
                logger.warning(
                    "Index creation note for collection %s keys %s: %s",
                    col_name,
                    keys,
                    e,
                )
    async def clean_test_database(self) -> None:
        """Drop/clean test database collections between test runs (§M5)."""
        db = await self.connect()
        db_name = getattr(db, "name", "")
        if db_name == settings.MONGODB_DB_NAME:
            raise RuntimeError(
                f"CRITICAL SAFETY VIOLATION: Attempted to clean production database '{db_name}'."
            )
        collections = [
            AUTH_COLLECTION,
            "resumes",
            "interview_sessions",
            "telemetry_samples",
            "integrity_events",
            "evaluations",
            "resume_chunks",
            "interview_memory",
        ]
        for col in collections:
            try:
                await db[col].delete_many({})
            except Exception:
                pass

    async def close(self, app: Optional[FastAPI] = None) -> None:
        """Close client connection pool cleanly on shutdown."""
        if self.client:
            self.client.close()
            self._is_connected = False
            self.client = None
            self.db = None
            self._loop = None
            logger.info("MongoDB connection closed.")
        if app is not None and hasattr(app.state, "mongo_client"):
            app.state.mongo_client = None


mongo_manager = MongoManager()


async def get_db(request: Optional[Request] = None) -> AsyncIOMotorDatabase:
    """Dependency provider returning active MongoDB database instance."""
    import asyncio
    try:
        current_loop = asyncio.get_running_loop()
    except RuntimeError:
        current_loop = None

    if request and hasattr(request.app.state, "db") and request.app.state.db is not None:
        if current_loop is None or mongo_manager._loop == current_loop:
            return request.app.state.db

    if mongo_manager.db is None or (current_loop is not None and mongo_manager._loop != current_loop):
        await mongo_manager.connect()

    assert mongo_manager.db is not None
    return mongo_manager.db


async def get_database() -> AsyncIOMotorDatabase:
    """Legacy compatibility dependency alias for get_db."""
    return await get_db()


def get_collection(name: str) -> Any:
    """Return collection accessor from global database instance."""
    import asyncio
    try:
        current_loop = asyncio.get_running_loop()
    except RuntimeError:
        current_loop = None

    if (
        mongo_manager.db is not None
        and mongo_manager._is_connected
        and (current_loop is None or mongo_manager._loop == current_loop)
    ):
        return mongo_manager.db[name]

    class LazyCollection:
        def __getattr__(self, item: str) -> Any:
            async def _lazy_call(*args: Any, **kwargs: Any) -> Any:
                import inspect
                db = await get_db()
                target = getattr(db[name], item)
                res = target(*args, **kwargs)
                if inspect.isawaitable(res):
                    return await res
                return res
            return _lazy_call

    return LazyCollection()

