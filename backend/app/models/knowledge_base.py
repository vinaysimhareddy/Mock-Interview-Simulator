"""
Pydantic models for the curated role/seniority Knowledge Base (Q3).
"""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class KnowledgeBaseItemCreate(BaseModel):
    role: str = Field(..., description="Target role: Frontend, Backend, Full Stack, Data, DevOps/Cloud, Mobile")
    seniority: str = Field(..., description="Junior, Mid, Senior, Staff")
    topic: str = Field(..., description="High-level topic area, e.g. 'Caching Strategies'")
    subtopic: str = Field(..., description="Specific subtopic, e.g. 'Cache-Aside & Invalidation'")
    core_concepts: List[str] = Field(default_factory=list, description="List of expected technical concepts")
    expected_depth: str = Field(..., description="Description of depth expected for this seniority tier")
    sample_questions: List[str] = Field(default_factory=list, description="At least 3 canonical questions")
    rubric_hints: List[str] = Field(default_factory=list, description="Key grading/evaluation signals")
    tags: List[str] = Field(default_factory=list, description="Keywords and technology tags")


class KnowledgeBaseItemInDB(KnowledgeBaseItemCreate):
    id: str = Field(..., description="Unique string identifier or ObjectId")
    embedding: Optional[List[float]] = Field(default=None, description="Dense embedding vector")
    search_text: str = Field(..., description="Flattened text representation used for embedding and indexing")


class KBSearchHit(BaseModel):
    item: KnowledgeBaseItemInDB
    score: float = Field(..., description="Similarity or boosted relevance score")

