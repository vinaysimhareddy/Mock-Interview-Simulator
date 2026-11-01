"""
RAG Retrieval Service (Q3).
Grounds question generation with context retrieved from candidate resume chunks
and the role/seniority Knowledge Base, applying seniority caps, tag reranking,
topic deduplication, and strict token budget enforcement.
"""

import logging
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.models.knowledge_base import KBSearchHit
from app.models.resume_chunk import ResumeChunkSearchHit
from app.repositories.knowledge_base_repo import knowledge_base_repo, SENIORITY_RANKS
from app.repositories.resume_chunk_repo import resume_chunk_repo
from app.services.embedding_service import get_embedding_service
from app.services.resume_chunker import estimate_token_count, extract_tags_from_text

logger = logging.getLogger("uvicorn.error")
settings = get_settings()


class RAGContextResult(BaseModel):
    """Structured context object passed to LangGraph planner and question generator."""
    role: str
    seniority: str
    query_text: str
    extracted_answer_tags: List[str] = Field(default_factory=list)
    resume_chunks: List[Dict[str, Any]] = Field(default_factory=list)
    kb_topics: List[Dict[str, Any]] = Field(default_factory=list)
    formatted_prompt_context: str = Field(..., description="Truncated context string within token budget")
    token_count: int = Field(..., description="Estimated token count of formatted_prompt_context")


class RAGRetrievalService:
    """Orchestrates multi-source retrieval (resume + KB) with seniority caps and token budgeting."""

    def __init__(self) -> None:
        self.settings = get_settings()
        self.embedder = get_embedding_service()

    async def retrieve_context(
        self,
        role: str,
        seniority: str,
        previous_question: Optional[str] = None,
        previous_answer: Optional[str] = None,
        user_id: Optional[str] = None,
        resume_id: Optional[str] = None,
        target_topic: Optional[str] = None,
        conversation_history: Optional[List[Dict[str, str]]] = None,
        covered_topics: Optional[List[str]] = None,
        top_k_resume: int = 3,
        top_k_kb: int = 4,
        max_context_tokens: Optional[int] = None,
    ) -> RAGContextResult:
        budget = max_context_tokens or getattr(self.settings, "RAG_MAX_CONTEXT_TOKENS", 1200)

        # 1. Extract technology tags and keywords from previous answer
        answer_tags: List[str] = []
        if previous_answer:
            answer_tags = extract_tags_from_text(previous_answer)

        # 2. Build semantic query context
        query_parts = [role, seniority]
        if target_topic:
            query_parts.append(target_topic)
        if answer_tags:
            query_parts.extend(answer_tags[:6])
        elif previous_answer:
            # Take first 15 words of answer as semantic anchor
            query_parts.append(" ".join(previous_answer.split()[:15]))

        query_text = " ".join(query_parts).strip()
        query_vector = await self.embedder.embed_query(query_text)

        # 3. Retrieve Candidate Resume Chunks (Isolated by user_id and resume_id)
        resume_hits: List[ResumeChunkSearchHit] = []
        if user_id:
            try:
                resume_hits = await resume_chunk_repo.search_relevant_chunks(
                    user_id=user_id,
                    resume_id=resume_id,
                    query_vector=query_vector,
                    top_k=top_k_resume,
                    boost_tags=answer_tags,
                )
            except Exception as exc:
                logger.warning("Error searching resume chunks: %s", exc)

        # 4. Retrieve Role/Seniority Knowledge Base entries
        # Seniority ceiling rule: Junior <= 1, Mid <= 2, Senior <= 3, Staff <= 4
        kb_hits: List[KBSearchHit] = []
        try:
            kb_hits = await knowledge_base_repo.search_relevant_kb(
                role=role,
                seniority=seniority,
                query_vector=query_vector,
                boost_tags=answer_tags,
                exclude_topics=covered_topics,
                top_k=top_k_kb,
                strict_seniority=False,
            )
        except Exception as exc:
            logger.warning("Error searching knowledge base: %s", exc)

        # 5. Build structured prompt context honoring token budget
        formatted_prompt, final_tokens, resume_summaries, kb_summaries = self._build_budgeted_context(
            role=role,
            seniority=seniority,
            resume_hits=resume_hits,
            kb_hits=kb_hits,
            answer_tags=answer_tags,
            budget=budget,
        )

        return RAGContextResult(
            role=role,
            seniority=seniority,
            query_text=query_text,
            extracted_answer_tags=answer_tags,
            resume_chunks=resume_summaries,
            kb_topics=kb_summaries,
            formatted_prompt_context=formatted_prompt,
            token_count=final_tokens,
        )

    def _build_budgeted_context(
        self,
        role: str,
        seniority: str,
        resume_hits: List[ResumeChunkSearchHit],
        kb_hits: List[KBSearchHit],
        answer_tags: List[str],
        budget: int,
    ) -> tuple[str, int, List[Dict[str, Any]], List[Dict[str, Any]]]:
        """
        Assemble RAG context text with strict token budgeting.
        Allocates ~40% to resume evidence, ~50% to KB guidance, ~10% to tags/metadata.
        """
        resume_summaries: List[Dict[str, Any]] = []
        kb_summaries: List[Dict[str, Any]] = []

        lines: List[str] = [
            f"=== RETRIEVED CONTEXT (Target Role: {role}, Seniority: {seniority}) ===",
        ]

        if answer_tags:
            lines.append(f"Keywords identified in candidate's last answer: {', '.join(answer_tags)}")

        # A. Candidate Resume Chunks
        lines.append("\n--- CANDIDATE RESUME EVIDENCE ---")
        if not resume_hits:
            lines.append("(No specific resume chunks retrieved or matched for this topic.)")
        else:
            for hit in resume_hits:
                chunk = hit.chunk
                c_summary = {
                    "section": chunk.section,
                    "tags": chunk.tags,
                    "score": round(hit.score, 3),
                    "text": chunk.text,
                }
                resume_summaries.append(c_summary)
                lines.append(
                    f"[{chunk.section.upper()}]: {chunk.text}"
                )

        # B. Curated Knowledge Base Guidance
        lines.append(f"\n--- CURATED KNOWLEDGE BASE GUIDANCE (Capped at {seniority} level) ---")
        if not kb_hits:
            lines.append("(No matching knowledge base topics retrieved.)")
        else:
            for hit in kb_hits:
                item = hit.item
                kb_info = {
                    "topic": item.topic,
                    "subtopic": item.subtopic,
                    "seniority": item.seniority,
                    "expected_depth": item.expected_depth,
                    "core_concepts": item.core_concepts,
                    "sample_questions": item.sample_questions[:2],
                    "rubric_hints": item.rubric_hints,
                    "score": round(hit.score, 3),
                }
                kb_summaries.append(kb_info)
                lines.append(
                    f"• TOPIC: {item.topic} ({item.subtopic}) [{item.seniority} Tier]\n"
                    f"  Expected Depth: {item.expected_depth}\n"
                    f"  Core Concepts: {', '.join(item.core_concepts)}\n"
                    f"  Rubric Hints: {'; '.join(item.rubric_hints)}\n"
                    f"  Example Focus: {item.sample_questions[0] if item.sample_questions else 'N/A'}"
                )

        lines.append("=== END RETRIEVED CONTEXT ===")
        full_text = "\n".join(lines)

        # Token budgeting & truncation
        tokens = estimate_token_count(full_text)
        if tokens > budget:
            # Truncate lines until strictly within budget
            while len(lines) > 4 and estimate_token_count("\n".join(lines)) > budget:
                lines.pop(-2)  # pop content line before end marker
            full_text = "\n".join(lines)
            tokens = estimate_token_count(full_text)

        return full_text, tokens, resume_summaries, kb_summaries


rag_retrieval_service = RAGRetrievalService()

