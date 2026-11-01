import logging
import math
from typing import Any, Dict, List, Optional
from bson import ObjectId
from pymongo import ASCENDING

from app.core.config import get_settings
from app.core.database import get_collection
from app.models.resume_chunk import ResumeChunkInDB, ResumeChunkSearchHit

logger = logging.getLogger("uvicorn.error")
settings = get_settings()


def _cosine_similarity(vec1: List[float], vec2: List[float]) -> float:
    """Compute cosine similarity between two dense vectors."""
    if not vec1 or not vec2 or len(vec1) != len(vec2):
        return 0.0
    dot = sum(a * b for a, b in zip(vec1, vec2))
    norm1 = math.sqrt(sum(a * a for a in vec1))
    norm2 = math.sqrt(sum(b * b for b in vec2))
    if norm1 == 0.0 or norm2 == 0.0:
        return 0.0
    return max(0.0, min(1.0, dot / (norm1 * norm2)))


class ResumeChunkRepository:
    """Repository handling storage, retrieval, and vector search on the 'resume_chunks' collection."""

    @property
    def collection(self) -> Any:
        return get_collection("resume_chunks")

    async def insert_chunks_batch(self, chunks_data: List[Dict[str, Any]]) -> int:
        """Insert a batch of resume chunk documents with dense embeddings."""
        if not chunks_data:
            return 0

        docs = []
        for c in chunks_data:
            doc = dict(c)
            if "_id" not in doc and "id" not in doc:
                new_id = str(ObjectId())
                doc["_id"] = ObjectId(new_id)
                doc["id"] = new_id
            docs.append(doc)

        result = await self.collection.insert_many(docs)
        return len(result.inserted_ids)

    async def delete_by_resume_and_user(self, resume_id: str, user_id: str) -> int:
        """Delete all chunks for a specific resume belonging to a user (used upon re-upload/update)."""
        result = await self.collection.delete_many({
            "resume_id": str(resume_id),
            "user_id": str(user_id),
        })
        return result.deleted_count

    async def get_by_resume_and_user(self, resume_id: str, user_id: str) -> List[Dict[str, Any]]:
        """Retrieve all chunks for a candidate resume, ordered by chunk_index."""
        cursor = self.collection.find({
            "resume_id": str(resume_id),
            "user_id": str(user_id),
        }).sort("chunk_index", ASCENDING)
        docs = await cursor.to_list(length=200)
        return [self._format(d) for d in docs]

    async def search_relevant_chunks(
        self,
        user_id: str,
        query_vector: List[float],
        resume_id: Optional[str] = None,
        top_k: int = 4,
        query_tags: Optional[List[str]] = None,
        boost_tags: Optional[List[str]] = None,
    ) -> List[ResumeChunkSearchHit]:
        """
        Search resume chunks using MongoDB Atlas $vectorSearch (§2.3).
        Falls back to in-process cosine similarity if the vector index is not available or in local dev.
        """
        filter_doc: Dict[str, Any] = {
            "user_id": str(user_id),
        }
        if resume_id:
            filter_doc["resume_id"] = str(resume_id)

        effective_tags = query_tags or boost_tags

        # Attempt Atlas Vector Search
        try:
            pipeline = [
                {
                    "$vectorSearch": {
                        "index": settings.VECTOR_INDEX_RESUME,
                        "path": "embedding",
                        "queryVector": query_vector,
                        "numCandidates": max(100, top_k * 20),
                        "limit": top_k * 2,  # Fetch extra for tag-boosting / reranking
                        "filter": filter_doc,
                    }
                },
                {
                    "$project": {
                        "_id": 1,
                        "id": 1,
                        "user_id": 1,
                        "resume_id": 1,
                        "section": 1,
                        "text": 1,
                        "tags": 1,
                        "chunk_index": 1,
                        "token_count": 1,
                        "created_at": 1,
                        "score": {"$meta": "vectorSearchScore"},
                    }
                },
            ]
            cursor = self.collection.aggregate(pipeline)
            raw_hits = await cursor.to_list(length=top_k * 2)

            if raw_hits:
                return self._process_and_boost_hits(raw_hits, effective_tags, top_k)
        except Exception as exc:
            logger.warning(
                "Atlas Vector Search on '%s' failed or not configured (%s). Using in-process cosine fallback.",
                settings.VECTOR_INDEX_RESUME,
                exc,
            )

        # Fallback: In-process cosine similarity search (§2.3 fallback ladder)
        return await self._in_process_vector_search(user_id, resume_id, query_vector, top_k, effective_tags)

    async def _in_process_vector_search(
        self,
        user_id: str,
        resume_id: Optional[str],
        query_vector: List[float],
        top_k: int,
        query_tags: Optional[List[str]],
    ) -> List[ResumeChunkSearchHit]:
        """In-process cosine similarity fallback over candidate's resume chunks."""
        query_filter: Dict[str, Any] = {"user_id": str(user_id)}
        if resume_id:
            query_filter["resume_id"] = str(resume_id)

        cursor = self.collection.find(query_filter).limit(200)
        docs = await cursor.to_list(length=200)

        hits: List[Dict[str, Any]] = []
        for doc in docs:
            emb = doc.get("embedding") or []
            score = _cosine_similarity(query_vector, emb)
            hits.append({**doc, "score": score})

        return self._process_and_boost_hits(hits, query_tags, top_k)

    def _process_and_boost_hits(
        self,
        raw_hits: List[Dict[str, Any]],
        query_tags: Optional[List[str]],
        top_k: int,
    ) -> List[ResumeChunkSearchHit]:
        """Apply keyword/technology tag boost and return sorted hits up to top_k."""
        boosted_hits: List[ResumeChunkSearchHit] = []
        target_tags_lower = {t.lower() for t in (query_tags or [])}

        for item in raw_hits:
            formatted = self._format(item)
            base_score = float(item.get("score") or 0.0)

            chunk_tags = formatted.get("tags") or []
            matched: List[str] = [t for t in chunk_tags if t.lower() in target_tags_lower]

            # Tag boost: add 0.05 per matched technology tag, capped at +0.20
            boost = min(0.20, len(matched) * 0.05)
            final_score = min(1.0, base_score + boost)

            chunk_obj = ResumeChunkInDB(
                id=formatted["id"],
                user_id=formatted["user_id"],
                resume_id=formatted["resume_id"],
                section=formatted.get("section", "general"),
                text=formatted["text"],
                tags=chunk_tags,
                chunk_index=formatted.get("chunk_index", 0),
                token_count=formatted.get("token_count", 0),
                embedding=[],  # Strip vector to conserve memory
                created_at=formatted["created_at"],
            )

            boosted_hits.append(
                ResumeChunkSearchHit(
                    chunk=chunk_obj,
                    score=round(final_score, 4),
                    matched_tags=matched,
                )
            )

        # Sort by final score descending
        boosted_hits.sort(key=lambda h: h.score, reverse=True)
        return boosted_hits[:top_k]

    def _format(self, doc: Dict[str, Any]) -> Dict[str, Any]:
        data = dict(doc)
        doc_id = str(data.get("_id") or data.get("id"))
        data["id"] = doc_id
        if "_id" in data:
            data["_id"] = doc_id
        return data


resume_chunk_repo = ResumeChunkRepository()

