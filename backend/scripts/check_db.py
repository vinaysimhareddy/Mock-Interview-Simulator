import asyncio
import sys
import time
from typing import List
import certifi
from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import get_settings
from app.core.database import get_error_hint


async def check_database() -> int:
    """
    Connect to MongoDB Atlas, verify connectivity via ping,
    inspect database collections, and ensure the 'auth' collection exists.
    Never prints or logs credentials.
    """
    settings = get_settings()
    host_name = settings.mongodb_host
    db_name = settings.MONGODB_DB_NAME

    print(f"Connecting to MongoDB Atlas host: {host_name}")
    print(f"Target Database: {db_name}")

    try:
        uri = settings.get_effective_mongodb_uri()
    except ValueError as err:
        print(f"Configuration error: {err}", file=sys.stderr)
        return 1

    client: AsyncIOMotorClient = AsyncIOMotorClient(
        uri,
        serverSelectionTimeoutMS=settings.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
        connectTimeoutMS=settings.MONGODB_CONNECT_TIMEOUT_MS,
        tlsCAFile=certifi.where(),
        retryWrites=True,
    )

    try:
        # Measure ping latency
        start_time = time.perf_counter()
        ping_result = await client.admin.command("ping")
        latency_ms = round((time.perf_counter() - start_time) * 1000, 2)

        print(f"Ping result: {ping_result.get('ok', 1.0)} (OK, latency: {latency_ms} ms)")

        # Select explicitly by database name
        db = client[db_name]

        # List existing collections
        collections: List[str] = await db.list_collection_names()
        print(f"Existing collections: {collections if collections else '[]'}")

        # Confirm and create 'auth' collection if missing
        if "auth" in collections:
            print("Collection 'auth': Confirmed exists.")
        else:
            print("Collection 'auth' is missing. Creating 'auth' collection...")
            await db.create_collection("auth")
            print("Collection 'auth': Created successfully.")

        # Re-verify collections
        updated_collections: List[str] = await db.list_collection_names()
        print(f"Current collections in {db_name}: {updated_collections}")
        print("Database connectivity check completed successfully.")
        return 0

    except Exception as exc:
        hint = get_error_hint(exc)
        print(
            f"ERROR: Failed to connect to MongoDB at host={host_name} db={db_name}\n"
            f"Exception: {type(exc).__name__}\n"
            f"Hint: {hint}",
            file=sys.stderr,
        )
        return 1

    finally:
        client.close()


def main() -> None:
    """CLI script entrypoint."""
    exit_code = asyncio.run(check_database())
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
