import os
import pytest
from app.models.resume_chunk import ResumeChunkCreate
from app.repositories.resume_chunk_repo import resume_chunk_repo
from app.services.embedding_service import EmbeddingService, _deterministic_mock_embedding, get_embedding_service
from app.services.resume_chunker import chunk_resume, extract_tags_from_text
from app.services.resume_ingestion_service import ingest_resume_chunks


SAMPLE_RAW_RESUME = """
John Doe
Senior Software Engineer
john.doe@example.com | San Francisco, CA

SUMMARY
Experienced backend engineer with 4+ years building distributed services using Java, Spring Boot, and PostgreSQL.
Passionate about database query optimization, asynchronous processing with Kafka, and caching with Redis.

TECHNICAL SKILLS
Languages & Frameworks: Java, Python, TypeScript, Spring Boot, FastAPI
Databases & Storage: PostgreSQL, Redis, MongoDB
Cloud & DevOps: Docker, Kubernetes, AWS, Terraform, GitHub Actions

WORK EXPERIENCE
Staff Software Engineer | Acme Corporation | 2022 - Present
• Designed and developed a high-throughput order execution service in Spring Boot processing 15,000 transactions per second.
• Re-architected PostgreSQL database schemas with read-replicas and connection pooling, reducing p99 latency from 240ms to 45ms.
• Integrated Redis distributed caching with cache-aside pattern and Kafka event-driven messaging for inventory updates.
• Built automated CI/CD pipelines using Docker and GitHub Actions, improving release cadence from bi-weekly to daily.

Software Engineer | BetaTech Systems | 2020 - 2022
• Implemented RESTful APIs in Java and Spring Boot for user authentication and authorization using JWT and Spring Security.
• Optimized batch processing pipelines in PostgreSQL and wrote comprehensive unit tests with JUnit and Mockito.

EDUCATION
Bachelor of Science in Computer Science | University of California, Berkeley | 2016 - 2020
"""

SAMPLE_PARSED_PROFILE = {
    "technical_skills": [
        "Java", "Python", "TypeScript", "Spring Boot", "FastAPI",
        "PostgreSQL", "Redis", "MongoDB", "Docker", "Kubernetes", "AWS", "Kafka",
    ],
    "experience_years": 4.5,
    "summary": "Experienced backend engineer with 4+ years building distributed services using Java, Spring Boot, and PostgreSQL.",
    "work_history": [
        {
            "company": "Acme Corporation",
            "title": "Staff Software Engineer",
            "start": "2022",
            "end": "Present",
            "highlights": [
                "Designed and developed a high-throughput order execution service in Spring Boot processing 15,000 transactions per second.",
                "Re-architected PostgreSQL database schemas with read-replicas and connection pooling, reducing p99 latency from 240ms to 45ms.",
                "Integrated Redis distributed caching with cache-aside pattern and Kafka event-driven messaging for inventory updates.",
                "Built automated CI/CD pipelines using Docker and GitHub Actions, improving release cadence from bi-weekly to daily.",
            ],
        },
        {
            "company": "BetaTech Systems",
            "title": "Software Engineer",
            "start": "2020",
            "end": "2022",
            "highlights": [
                "Implemented RESTful APIs in Java and Spring Boot for user authentication and authorization using JWT and Spring Security.",
                "Optimized batch processing pipelines in PostgreSQL and wrote comprehensive unit tests with JUnit and Mockito.",
            ],
        },
    ],
    "education": [
        {
            "institution": "University of California, Berkeley",
            "degree": "Bachelor of Science in Computer Science",
            "year": "2016 - 2020",
        }
    ],
}


def test_extract_tags_from_text():
    """Verify tag extraction matches both known skills and standard tech keywords."""
    text = "We built a Spring Boot service with PostgreSQL, Redis cache, and Kafka streaming deployed on AWS Docker."
    tags = extract_tags_from_text(text, known_skills=["Spring Boot", "PostgreSQL", "Kafka"])

    assert "Spring Boot" in tags
    assert "PostgreSQL" in tags
    assert "Kafka" in tags
    assert "Redis" in tags
    assert "Docker" in tags
    assert "Aws" in tags or "AWS" in tags


def test_resume_chunker_creates_sensible_chunks_with_tags():
    """Verify chunking splits by section and job entry with tags (§2.3)."""
    chunks = chunk_resume(
        resume_id="res-101",
        user_id="user-202",
        raw_text=SAMPLE_RAW_RESUME,
        parsed_profile=SAMPLE_PARSED_PROFILE,
    )

    assert len(chunks) >= 4  # summary, skills, 2 job entries, education
    sections = [c.section for c in chunks]
    assert "summary" in sections
    assert "skills" in sections
    assert "experience" in sections
    assert "education" in sections

    # Check that job entries contain specific technology tags
    exp_chunks = [c for c in chunks if c.section == "experience"]
    assert len(exp_chunks) >= 2

    acme_chunk = next(c for c in exp_chunks if "Acme Corporation" in c.text)
    assert "Spring Boot" in acme_chunk.tags
    assert "Postgresql" in [t.title() for t in acme_chunk.tags] or "PostgreSQL" in acme_chunk.tags
    assert "Redis" in acme_chunk.tags
    assert "Kafka" in acme_chunk.tags

    # All chunks must belong to user-202 and res-101
    for c in chunks:
        assert c.user_id == "user-202"
        assert c.resume_id == "res-101"
        assert c.token_count > 0


@pytest.mark.asyncio
async def test_embedding_service_caching_and_batching():
    """Verify EmbeddingService caches by content hash and handles batching."""
    embedder = get_embedding_service()
    embedder.clear_cache()

    texts = [
        "Spring Boot microservice development with Redis caching",
        "PostgreSQL query optimization and indexing",
        "Spring Boot microservice development with Redis caching",  # duplicate for cache check
    ]

    vectors = await embedder.embed_documents(texts)
    assert len(vectors) == 3
    assert len(vectors[0]) == embedder.dimensions
    assert len(vectors[1]) == embedder.dimensions

    # Duplicate text must return exact identical vector
    assert vectors[0] == vectors[2]

    # Query embedding
    q_vec = await embedder.embed_query("Spring Boot Redis")
    assert len(q_vec) == embedder.dimensions


@pytest.mark.asyncio
async def test_resume_ingestion_and_reupload_replacement():
    """Verify re-uploading a resume replaces old chunks cleanly without orphans (§Q2)."""
    user_id = "test-user-rag-1"
    resume_id = "test-resume-rag-1"

    # Clean up prior test runs
    await resume_chunk_repo.delete_by_resume_and_user(resume_id, user_id)

    # Ingestion 1: Initial upload
    count1 = await ingest_resume_chunks(
        resume_id=resume_id,
        user_id=user_id,
        raw_text=SAMPLE_RAW_RESUME,
        parsed_profile=SAMPLE_PARSED_PROFILE,
    )
    assert count1 >= 4

    chunks1 = await resume_chunk_repo.get_by_resume_and_user(resume_id, user_id)
    assert len(chunks1) == count1

    # Ingestion 2: Re-upload with modified profile
    modified_profile = dict(SAMPLE_PARSED_PROFILE)
    modified_profile["work_history"] = [
        {
            "company": "New Corp",
            "title": "Lead Architect",
            "start": "2024",
            "end": "Present",
            "highlights": ["Designed enterprise event bus using Kafka."],
        }
    ]

    count2 = await ingest_resume_chunks(
        resume_id=resume_id,
        user_id=user_id,
        raw_text="New Corp experience only",
        parsed_profile=modified_profile,
    )

    chunks2 = await resume_chunk_repo.get_by_resume_and_user(resume_id, user_id)
    # Must reflect updated chunk count, with no leftover Acme Corp chunks
    assert len(chunks2) == count2
    texts = [c["text"] for c in chunks2]
    assert any("New Corp" in t for t in texts)
    assert not any("Acme Corporation" in t for t in texts)

    # Cleanup
    await resume_chunk_repo.delete_by_resume_and_user(resume_id, user_id)


@pytest.mark.asyncio
async def test_user_isolation_for_resume_chunks():
    """Verify candidate A can never access or search candidate B's resume chunks (§Q2)."""
    user_a = "candidate-alice"
    user_b = "candidate-bob"
    resume_a = "resume-alice-1"
    resume_b = "resume-bob-1"

    await resume_chunk_repo.delete_by_resume_and_user(resume_a, user_a)
    await resume_chunk_repo.delete_by_resume_and_user(resume_b, user_b)

    # Ingest Alice's resume
    profile_a = dict(SAMPLE_PARSED_PROFILE)
    profile_a["summary"] = "Alice is a dedicated Java backend specialist."
    await ingest_resume_chunks(resume_a, user_a, "Alice resume", profile_a)

    # Ingest Bob's resume
    profile_b = dict(SAMPLE_PARSED_PROFILE)
    profile_b["summary"] = "Bob is a Python and Django expert."
    await ingest_resume_chunks(resume_b, user_b, "Bob resume", profile_b)

    # Alice searches her own resume
    embedder = get_embedding_service()
    q_vec = await embedder.embed_query("Java backend")
    alice_hits = await resume_chunk_repo.search_relevant_chunks(
        user_id=user_a,
        resume_id=resume_a,
        query_vector=q_vec,
        top_k=5,
    )
    for hit in alice_hits:
        assert hit.chunk.user_id == user_a
        assert hit.chunk.resume_id == resume_a

    # Bob searches his own resume
    bob_hits = await resume_chunk_repo.search_relevant_chunks(
        user_id=user_b,
        resume_id=resume_b,
        query_vector=q_vec,
        top_k=5,
    )
    for hit in bob_hits:
        assert hit.chunk.user_id == user_b
        assert hit.chunk.resume_id == resume_b

    # Alice querying Bob's resume ID returns zero hits
    cross_hits = await resume_chunk_repo.search_relevant_chunks(
        user_id=user_a,
        resume_id=resume_b,
        query_vector=q_vec,
        top_k=5,
    )
    assert len(cross_hits) == 0

    # Cleanup
    await resume_chunk_repo.delete_by_resume_and_user(resume_a, user_a)
    await resume_chunk_repo.delete_by_resume_and_user(resume_b, user_b)


@pytest.mark.asyncio
async def test_live_embedding_call_behind_env_flag():
    """Optional live embedding call test executed only when RUN_LIVE_EMBEDDING_TEST=1 (§Q2)."""
    if os.environ.get("RUN_LIVE_EMBEDDING_TEST") != "1":
        pytest.skip("RUN_LIVE_EMBEDDING_TEST not enabled. Skipping external live API call.")

    embedder = EmbeddingService()
    vec = await embedder.embed_query("Software Engineering test query")
    assert len(vec) == embedder.dimensions
    assert any(x != 0.0 for x in vec)

