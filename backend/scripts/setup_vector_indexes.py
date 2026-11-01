import asyncio
import json
import logging
import os
import sys

# Ensure backend directory is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.core.config import get_settings
from app.core.database import get_collection, mongo_manager

logger = logging.getLogger("setup_vector_indexes")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


def get_vector_index_definitions(dimensions: int) -> dict:
    """Return exact Atlas Vector Search index configurations."""
    return {
        "resume_chunks_vector": {
            "collection": "resume_chunks",
            "definition": {
                "fields": [
                    {
                        "type": "vector",
                        "path": "embedding",
                        "numDimensions": dimensions,
                        "similarity": "cosine",
                    },
                    {"type": "filter", "path": "user_id"},
                    {"type": "filter", "path": "resume_id"},
                    {"type": "filter", "path": "section"},
                ]
            },
        },
        "knowledge_base_vector": {
            "collection": "knowledge_base",
            "definition": {
                "fields": [
                    {
                        "type": "vector",
                        "path": "embedding",
                        "numDimensions": dimensions,
                        "similarity": "cosine",
                    },
                    {"type": "filter", "path": "role"},
                    {"type": "filter", "path": "seniority"},
                    {"type": "filter", "path": "difficulty"},
                ]
            },
        },
        "interview_memory_vector": {
            "collection": "interview_memory",
            "definition": {
                "fields": [
                    {
                        "type": "vector",
                        "path": "embedding",
                        "numDimensions": dimensions,
                        "similarity": "cosine",
                    },
                    {"type": "filter", "path": "session_id"},
                    {"type": "filter", "path": "kind"},
                ]
            },
        },
    }


async def setup_indexes() -> None:
    settings = get_settings()
    dimensions = settings.EMBEDDING_DIMENSIONS
    indexes = get_vector_index_definitions(dimensions)

    print("=" * 80)
    print("MONGODB ATLAS VECTOR SEARCH INDEX SETUP (§2.3)")
    print(f"Database: {settings.MONGODB_DB_NAME}")
    print(f"Embedding Dimensions: {dimensions}")
    print("=" * 80)

    try:
        await mongo_manager.connect()
    except Exception as exc:
        logger.warning("Could not connect to MongoDB client: %s", exc)

    for index_name, info in indexes.items():
        coll_name = info["collection"]
        definition = info["definition"]

        print(f"\n--- Index: '{index_name}' on collection '{coll_name}' ---")
        print("Atlas Vector Search JSON Definition (Copy-paste into Atlas UI -> Search -> Create Vector Search Index):")
        print(json.dumps(definition, indent=2))

        try:
            # Ensure collection exists before creating search index
            if mongo_manager.db is not None:
                existing_colls = await mongo_manager.db.list_collection_names()
                if coll_name not in existing_colls:
                    await mongo_manager.db.create_collection(coll_name)
                    logger.info("Created collection '%s'.", coll_name)

            coll = get_collection(coll_name)
            # MongoDB 6.0.11+ / 7.0+ driver method
            if hasattr(coll, "create_search_index"):
                logger.info("Attempting programmatic search index creation for '%s'...", index_name)
                # pymongo create_search_index model
                from pymongo.operations import SearchIndexModel

                model = SearchIndexModel(definition=definition, name=index_name, type="vectorSearch")
                await coll.create_search_index(model)
                logger.info("Search index '%s' creation requested successfully.", index_name)
        except Exception as exc:
            logger.info(
                "Driver programmatic index creation for '%s' returned: %s. "
                "(Standard for non-M10+ tiers or when created via UI/Terraform; please use JSON above).",
                index_name,
                exc,
            )

    await mongo_manager.close()
    print("\n" + "=" * 80)
    print("Vector Index Definitions Output Complete. Verify or create in Atlas UI.")
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(setup_indexes())
