"""
Seeds the curated Knowledge Base into MongoDB Atlas (knowledge_base collection).
Embeds search_text using the active EmbeddingService and bulk-upserts (§Q3).
"""

import asyncio
import json
import os
import sys
import time
from typing import Any, Dict, List

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.core.database import mongo_manager
from app.repositories.knowledge_base_repo import knowledge_base_repo
from app.services.embedding_service import get_embedding_service


async def seed_knowledge_base() -> int:
    seed_file = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "knowledge_base_seed.json"))
    if not os.path.exists(seed_file):
        print(f"Seed file not found at {seed_file}. Run generate_kb_seed.py first.")
        return 0

    with open(seed_file, "r", encoding="utf-8") as f:
        raw_items: List[Dict[str, Any]] = json.load(f)

    print(f"Loaded {len(raw_items)} items from {seed_file}.")

    await mongo_manager.connect()
    embedder = get_embedding_service()

    texts_to_embed = [item["search_text"] for item in raw_items]
    print(f"Generating dense embeddings using provider '{embedder.provider}' ({embedder.dimensions} dims)...")

    t0 = time.perf_counter()
    vectors = await embedder.embed_documents(texts_to_embed)
    t1 = time.perf_counter()
    print(f"Generated {len(vectors)} embeddings in {t1 - t0:.2f}s.")

    items_to_upsert: List[Dict[str, Any]] = []
    for item, vec in zip(raw_items, vectors):
        doc = dict(item)
        doc["embedding"] = vec
        items_to_upsert.append(doc)

    print(f"Upserting {len(items_to_upsert)} items into 'knowledge_base' collection...")
    upserted_count = await knowledge_base_repo.upsert_items_batch(items_to_upsert)

    total_in_db = await knowledge_base_repo.count_items()
    print(f"Knowledge Base seeding complete. Total documents in DB: {total_in_db} (upserted/updated: {upserted_count})")

    await mongo_manager.close()
    return total_in_db


if __name__ == "__main__":
    count = asyncio.run(seed_knowledge_base())
    if count < 180:
        print(f"Error: expected >= 180 items, got {count}")
        sys.exit(1)
    print("Seed verified successfully!")

