from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field

ChunkSection = Literal["skills", "experience", "project", "education", "summary", "general"]


class ResumeChunkCreate(BaseModel):
    """Schema for a chunk before insertion into MongoDB."""
    user_id: str = Field(..., description="Owner candidate user ID")
    resume_id: str = Field(..., description="ID of source resume")
    section: ChunkSection = Field(default="general", description="Section category of the chunk")
    text: str = Field(..., description="Plaintext content of the chunk")
    tags: List[str] = Field(default_factory=list, description="Technologies, skills, and tools extracted")
    chunk_index: int = Field(default=0, description="0-indexed sequence of this chunk within the resume")
    token_count: int = Field(default=0, description="Approximate token count of the chunk text")
    embedding: List[float] = Field(default_factory=list, description="Dense vector embedding")
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="Chunk ingestion timestamp (UTC)",
    )


class ResumeChunkInDB(ResumeChunkCreate):
    """Schema for a chunk stored in MongoDB resume_chunks collection."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str = Field(..., alias="_id", description="Unique chunk document ID")


class ResumeChunkSearchHit(BaseModel):
    """Schema for a retrieved resume chunk with relevance score."""
    chunk: ResumeChunkInDB
    score: float = Field(..., description="Cosine similarity score (0.0 to 1.0)")
    matched_tags: List[str] = Field(default_factory=list, description="Tags overlapping with the query")

