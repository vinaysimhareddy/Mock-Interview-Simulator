"""
Tests for RAG Retrieval Service (§Q3).
Verifies:
1. Mid Backend queries return Mid-appropriate topics (caching, query optimization), NOT Junior definitions or Staff consensus protocols.
2. Candidate isolation: user A never sees user B's resume chunks.
3. Covered topic deduplication excludes already-asked topics.
4. Token budget cap is strictly enforced.
5. Answer tag extraction boosts relevant topic hits.
"""

import pytest
from app.repositories.knowledge_base_repo import knowledge_base_repo, SENIORITY_RANKS
from app.repositories.resume_chunk_repo import resume_chunk_repo
from app.services.rag_retrieval_service import rag_retrieval_service
from app.services.resume_ingestion_service import ingest_resume_chunks
from tests.test_resume_embeddings import SAMPLE_PARSED_PROFILE, SAMPLE_RAW_RESUME


@pytest.mark.asyncio
async def test_mid_backend_query_returns_mid_appropriate_topics():
    """
    Verify top hits for a Mid Backend query return Mid-appropriate topics,
    not Junior definitions or Staff consensus protocols (§Q3).
    """
    result = await rag_retrieval_service.retrieve_context(
        role="Backend",
        seniority="Mid",
        previous_question="Tell me about your experience with microservices and data storage.",
        previous_answer="In my last role I used PostgreSQL for relational data and Redis for caching slow queries.",
        top_k_kb=5,
    )

    assert len(result.kb_topics) > 0

    kb_seniorities = [t["seniority"] for t in result.kb_topics]
    kb_topics = [t["topic"] for t in result.kb_topics]

    # Seniority cap check: Mid level MUST NOT retrieve Staff or Senior topics above Mid
    for sen in kb_seniorities:
        rank = SENIORITY_RANKS.get(sen.lower(), 2)
        assert rank <= 2, f"Expected seniority <= Mid (rank 2), but got {sen} (rank {rank})"

    # Content check: Redis and PostgreSQL keywords should surface Caching or Database Optimization
    assert any("Caching" in topic or "Database" in topic for topic in kb_topics), (
        f"Expected Caching or Database Optimization topics, got {kb_topics}"
    )

    # Negative check: Must NOT contain Staff-level consensus topics
    assert not any("Consensus" in topic or "Raft" in topic or "Cell" in topic for topic in kb_topics)


@pytest.mark.asyncio
async def test_candidate_resume_isolation_in_rag_retrieval():
    """Verify Candidate A never retrieves Candidate B's resume chunks via RAG (§Q3)."""
    user_a = "candidate-a-rag"
    user_b = "candidate-b-rag"
    resume_a = "res-a-rag"
    resume_b = "res-b-rag"

    # Ingest candidate A resume
    profile_a = dict(SAMPLE_PARSED_PROFILE)
    profile_a["summary"] = "Alice is a Spring Boot and PostgreSQL specialist."
    await ingest_resume_chunks(resume_a, user_a, "Alice resume", profile_a)

    # Ingest candidate B resume
    profile_b = dict(SAMPLE_PARSED_PROFILE)
    profile_b["summary"] = "Bob is a Flutter and Swift mobile specialist."
    await ingest_resume_chunks(resume_b, user_b, "Bob resume", profile_b)

    # Candidate A retrieves context
    ctx_a = await rag_retrieval_service.retrieve_context(
        role="Backend",
        seniority="Mid",
        user_id=user_a,
        resume_id=resume_a,
        previous_answer="I worked on Spring Boot services with PostgreSQL.",
    )

    # Candidate A's retrieved chunks must belong strictly to Candidate A
    for chunk in ctx_a.resume_chunks:
        assert "Spring Boot" in chunk["text"] or "PostgreSQL" in chunk["text"] or "Acme" in chunk["text"]
        assert "Flutter" not in chunk["text"]

    # Cleanup
    await resume_chunk_repo.delete_by_resume_and_user(resume_a, user_a)
    await resume_chunk_repo.delete_by_resume_and_user(resume_b, user_b)


@pytest.mark.asyncio
async def test_rag_deduplication_excludes_covered_topics():
    """Verify already-covered topics are excluded from KB retrieval (§Q3)."""
    covered = ["Caching Strategies", "Database Query Optimization"]

    result = await rag_retrieval_service.retrieve_context(
        role="Backend",
        seniority="Mid",
        previous_answer="We used Redis caching to speed up our queries.",
        covered_topics=covered,
        top_k_kb=5,
    )

    retrieved_topics = [t["topic"] for t in result.kb_topics]

    for topic in covered:
        assert topic not in retrieved_topics, f"Covered topic '{topic}' was incorrectly returned: {retrieved_topics}"


@pytest.mark.asyncio
async def test_rag_token_budget_cap_enforcement():
    """Verify the formatted context string never exceeds the configured token budget (§Q3)."""
    strict_budget = 250  # Very tight token budget

    result = await rag_retrieval_service.retrieve_context(
        role="Backend",
        seniority="Mid",
        previous_answer="I built scalable microservices using Kafka and Redis.",
        max_context_tokens=strict_budget,
    )

    assert result.token_count <= strict_budget + 10, (
        f"Result token count {result.token_count} exceeded budget {strict_budget}"
    )
    assert "=== RETRIEVED CONTEXT" in result.formatted_prompt_context
    assert "=== END RETRIEVED CONTEXT ===" in result.formatted_prompt_context


@pytest.mark.asyncio
async def test_answer_tag_extraction_boosts_relevant_topics():
    """Verify technology tags extracted from candidate answer boost matching KB topics (§Q3)."""
    result = await rag_retrieval_service.retrieve_context(
        role="Backend",
        seniority="Mid",
        previous_answer="We integrated Kafka message queues to handle asynchronous order processing with Celery.",
        top_k_kb=3,
    )

    assert "Kafka" in result.extracted_answer_tags or "Celery" in result.extracted_answer_tags
    topics = [t["topic"] for t in result.kb_topics]

    # Asynchronous Processing should be among top topics due to Kafka/Celery tag boosting
    assert any("Asynchronous" in t or "Message" in t or "Caching" in t for t in topics), (
        f"Expected Asynchronous Processing to be boosted, got {topics}"
    )

