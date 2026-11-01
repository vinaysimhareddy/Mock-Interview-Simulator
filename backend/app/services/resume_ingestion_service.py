import logging
from typing import Any, Dict, List

from app.models.resume_chunk import ResumeChunkCreate
from app.repositories.resume_chunk_repo import resume_chunk_repo
from app.services.embedding_service import get_embedding_service
from app.services.resume_chunker import chunk_resume

logger = logging.getLogger("uvicorn.error")


async def ingest_resume_chunks(
    resume_id: str,
    user_id: str,
    raw_text: str,
    parsed_profile: Dict[str, Any],
) -> int:
    """
    Ingest resume into vector storage:
    1. Chunks resume by section and job/project entry (200-400 tokens, 15% overlap)
    2. Extracts technology tags
    3. Computes dense vector embeddings in batch (with hashing & caching)
    4. Deletes prior chunks for this resume to prevent stale/duplicate vectors upon re-upload
    5. Stores chunks in MongoDB 'resume_chunks' collection
    Returns the number of ingested chunks.
    """
    # 1. Chunking & tag extraction
    chunks: List[ResumeChunkCreate] = chunk_resume(
        resume_id=resume_id,
        user_id=user_id,
        raw_text=raw_text,
        parsed_profile=parsed_profile,
    )

    if not chunks:
        logger.warning("No chunks generated for resume %s (user %s).", resume_id, user_id)
        return 0

    # 2. Batch embedding computation
    embedder = get_embedding_service()
    texts = [c.text for c in chunks]
    embeddings = await embedder.embed_documents(texts)

    # 3. Associate embeddings with chunks
    chunk_docs: List[Dict[str, Any]] = []
    for c, emb in zip(chunks, embeddings):
        c.embedding = emb
        chunk_docs.append(c.model_dump())

    # 4. Atomic delete-then-insert for re-ingestion
    await resume_chunk_repo.delete_by_resume_and_user(resume_id=resume_id, user_id=user_id)
    count = await resume_chunk_repo.insert_chunks_batch(chunk_docs)

    logger.info(
        "Ingested %d vector chunks for resume %s (user %s).",
        count,
        resume_id,
        user_id,
    )
    return count

