"""
Repository handling storage and vector retrieval for the Knowledge Base collection (Q3).
"""

import json
import logging
import math
import os
from typing import Any, Dict, List, Optional
from bson import ObjectId
from pymongo import UpdateOne

from app.core.config import get_settings
from app.core.database import get_collection
from app.models.knowledge_base import KnowledgeBaseItemInDB, KBSearchHit
from app.repositories.resume_chunk_repo import _cosine_similarity
from app.services.embedding_service import _deterministic_mock_embedding

logger = logging.getLogger("uvicorn.error")
settings = get_settings()

SENIORITY_RANKS = {
    "junior": 1,
    "entry": 1,
    "associate": 1,
    "mid": 2,
    "intermediate": 2,
    "mid-level": 2,
    "senior": 3,
    "sr": 3,
    "staff": 4,
    "principal": 4,
    "lead": 4,
}


class KnowledgeBaseRepository:
    """Repository for managing and vector-searching the 'knowledge_base' collection."""

    @property
    def collection(self) -> Any:
        return get_collection("knowledge_base")

    async def upsert_items_batch(self, items_data: List[Dict[str, Any]]) -> int:
        """Upsert a batch of KB documents based on (role, seniority, topic, subtopic)."""
        if not items_data:
            return 0

        operations = []
        for item in items_data:
            filter_query = {
                "role": item["role"].strip(),
                "seniority": item["seniority"].strip(),
                "topic": item["topic"].strip(),
                "subtopic": item["subtopic"].strip(),
            }
            doc = dict(item)
            if "_id" not in doc and "id" not in doc:
                doc["id"] = str(ObjectId())

            operations.append(UpdateOne(filter_query, {"$set": doc}, upsert=True))

        result = await self.collection.bulk_write(operations)
        return result.upserted_count + result.modified_count

    async def count_items(self, query: Optional[Dict[str, Any]] = None) -> int:
        """Count total items in KB matching optional query."""
        return await self.collection.count_documents(query or {})

    async def search_relevant_kb(
        self,
        role: str,
        seniority: str,
        query_vector: List[float],
        boost_tags: Optional[List[str]] = None,
        exclude_topics: Optional[List[str]] = None,
        top_k: int = 5,
        strict_seniority: bool = False,
    ) -> List[KBSearchHit]:
        """
        Search knowledge base entries matching role and seniority <= candidate level.
        Applies tag-boosting and excludes already-covered topics.
        """
        boost_tags_lower = [t.lower() for t in (boost_tags or [])]
        exclude_topics_lower = [t.lower().strip() for t in (exclude_topics or [])]

        target_rank = SENIORITY_RANKS.get(seniority.lower().strip(), 2)

        # 1. Try Atlas Vector Search ($vectorSearch) if vector index is configured
        vector_index_name = getattr(settings, "VECTOR_INDEX_KB", "knowledge_base_vector")
        hits: List[KBSearchHit] = []

        try:
            allowed_seniorities = [
                s for s, r in SENIORITY_RANKS.items()
                if (r == target_rank if strict_seniority else r <= target_rank)
            ]
            pipeline = [
                {
                    "$vectorSearch": {
                        "index": vector_index_name,
                        "path": "embedding",
                        "queryVector": query_vector,
                        "numCandidates": max(top_k * 10, 50),
                        "limit": top_k * 4,
                        "filter": {
                            "role": {"$regex": f"^{role}$", "$options": "i"},
                        },
                    }
                }
            ]
            cursor = self.collection.aggregate(pipeline)
            docs = await cursor.to_list(length=top_k * 4)

            for doc in docs:
                doc_sen = doc.get("seniority", "").lower().strip()
                doc_rank = SENIORITY_RANKS.get(doc_sen, 2)
                if strict_seniority and doc_rank != target_rank:
                    continue
                if not strict_seniority and doc_rank > target_rank:
                    continue
                if doc.get("topic", "").lower().strip() in exclude_topics_lower:
                    continue

                raw_score = float(doc.get("score", 0.0))
                doc_tags = [t.lower() for t in doc.get("tags", [])]
                topic_words = set(doc.get("topic", "").lower().split() + doc.get("subtopic", "").lower().split())
                matched_tags = sum(1 for bt in boost_tags_lower if bt in doc_tags or bt in topic_words)
                final_score = raw_score + min(matched_tags * 0.15, 0.40)

                # Prioritize exact seniority match slightly over lower seniority
                if doc_rank == target_rank:
                    final_score += 0.08

                item_model = KnowledgeBaseItemInDB(
                    id=str(doc.get("_id", doc.get("id"))),
                    role=doc["role"],
                    seniority=doc["seniority"],
                    topic=doc["topic"],
                    subtopic=doc["subtopic"],
                    core_concepts=doc.get("core_concepts", []),
                    expected_depth=doc.get("expected_depth", ""),
                    sample_questions=doc.get("sample_questions", []),
                    rubric_hints=doc.get("rubric_hints", []),
                    tags=doc.get("tags", []),
                    search_text=doc.get("search_text", ""),
                )
                hits.append(KBSearchHit(item=item_model, score=final_score))

        except Exception as exc:
            logger.info("Atlas vector search on KB unavailable (%s), using in-memory candidate scan.", exc)
            hits = []

        # 2. Fallback to in-memory cosine ranking if Atlas vector search yielded no hits or was skipped
        if not hits:
            role_regex = {"$regex": f"^{role}$", "$options": "i"}
            try:
                cursor = self.collection.find({"role": role_regex})
                docs = await cursor.to_list(length=200)
            except Exception as e:
                logger.info("Error fetching KB docs from MongoDB: %s", e)
                docs = []

            # If DB is unseeded or running in isolated test DB, load curated seed data
            if not docs:
                seed_file = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data", "knowledge_base_seed.json"))
                if os.path.exists(seed_file):
                    try:
                        with open(seed_file, "r", encoding="utf-8") as f:
                            all_seed = json.load(f)
                            docs = [item for item in all_seed if item.get("role", "").lower() == role.lower()]
                    except Exception as err:
                        logger.warning("Could not load KB seed file: %s", err)

            for doc in docs:
                doc_sen = doc.get("seniority", "").lower().strip()
                doc_rank = SENIORITY_RANKS.get(doc_sen, 2)
                if strict_seniority and doc_rank != target_rank:
                    continue
                if not strict_seniority and doc_rank > target_rank:
                    continue
                if doc.get("topic", "").lower().strip() in exclude_topics_lower:
                    continue

                emb = doc.get("embedding")
                if not emb:
                    emb = _deterministic_mock_embedding(doc.get("search_text", ""), len(query_vector))

                sim = _cosine_similarity(query_vector, emb)
                doc_tags = [t.lower() for t in doc.get("tags", [])]
                topic_words = set(doc.get("topic", "").lower().split() + doc.get("subtopic", "").lower().split())
                matched_tags = sum(1 for bt in boost_tags_lower if bt in doc_tags or bt in topic_words)
                score = sim + min(matched_tags * 0.15, 0.40)

                # Boost exact requested seniority level
                if doc_rank == target_rank:
                    score += 0.08

                item_model = KnowledgeBaseItemInDB(
                    id=str(doc.get("_id", doc.get("id"))),
                    role=doc["role"],
                    seniority=doc["seniority"],
                    topic=doc["topic"],
                    subtopic=doc["subtopic"],
                    core_concepts=doc.get("core_concepts", []),
                    expected_depth=doc.get("expected_depth", ""),
                    sample_questions=doc.get("sample_questions", []),
                    rubric_hints=doc.get("rubric_hints", []),
                    tags=doc.get("tags", []),
                    search_text=doc.get("search_text", ""),
                )
                hits.append(KBSearchHit(item=item_model, score=score))

        hits.sort(key=lambda h: h.score, reverse=True)
        return hits[:top_k]


knowledge_base_repo = KnowledgeBaseRepository()
