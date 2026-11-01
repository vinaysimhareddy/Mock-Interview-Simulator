"""
Unit and Integration Tests for RAG Question Engine and LangGraph Nodes (§Q5).
Verifies:
1. 8-action planner selection rules (deepen, clarify, probe, simplify, new topic, behavioral, wrap_up).
2. Consecutive follow-up cap (<= 2 before forced new topic).
3. Duplicate rejection via semantic/lexical similarity.
4. Grounding validator preventing hallucinations not in candidate resume.
5. Seniority difficulty ceiling and forbidden topic enforcement.
6. Fallback ladder (retry -> authored KB question) with explicit logging.
7. Multi-turn interview progression and rolling summary updates.
"""

import logging
import pytest
from typing import Any, Dict, List

from app.core.seniority_profiles import get_seniority_profile
from app.services.interview_engine import (
    InterviewState,
    _check_grounding,
    _get_fallback_kb_question,
    _is_duplicate_question,
    evaluate_answer_node,
    generate_question_node,
    interview_graph,
    plan_turn_node,
    retrieve_context_node,
    start_interview,
    submit_candidate_answer,
    update_difficulty_node,
    update_summary_node,
    validate_question_node,
)
from app.services.embedding_service import get_embedding_service


@pytest.fixture
def base_state() -> InterviewState:
    """Fixture providing a clean Mid Backend interview state."""
    profile = get_seniority_profile("Mid")
    return {
        "session_id": "test-session-q5",
        "user_id": "test-user-123",
        "role": "Backend",
        "seniority": "Mid",
        "difficulty": "Easy-Medium",
        "numeric_difficulty": 2.0,
        "resume_summary": "Experienced Python backend engineer using FastAPI, PostgreSQL, Redis, and Docker.",
        "target_skills": ["Python", "FastAPI", "PostgreSQL", "Redis", "Docker"],
        "candidate_resume_tags": ["Python", "FastAPI", "PostgreSQL", "Redis", "Docker"],
        "current_question_index": 2,
        "max_questions": 10,
        "current_question": "How do you structure database connection pooling in FastAPI?",
        "candidate_answer": "I use SQLAlchemy async engine with pool_size=20 and max_overflow=10.",
        "evaluation": {"score": 7.5, "feedback": "Good answer."},
        "evaluations_history": [{"score": 7.5, "feedback": "Good answer."}],
        "difficulty_history": ["Easy-Medium"],
        "difficulty_change": "UNCHANGED",
        "conversation_history": [
            {"role": "interviewer", "content": "How do you structure database connection pooling in FastAPI?"},
            {"role": "candidate", "content": "I use SQLAlchemy async engine with pool_size=20 and max_overflow=10."},
        ],
        "telemetry_summary": None,
        "integrity_summary": None,
        "final_report": None,
        "is_finished": False,
        "time_left_seconds": 1200,
        "time_budget_expired": False,
        "user_ended": False,
        "is_aborted": False,
        "rag_context": None,
        "current_action": "new_topic_from_resume",
        "current_topic": "Database & Indexing",
        "target_topic": "Database & Indexing",
        "action_reason": "Test setup",
        "covered_topics": ["Database & Indexing"],
        "rolling_summary": "",
        "asked_question_embeddings": [],
        "consecutive_followups": 0,
        "question_sources": [],
        "validation_feedback": None,
        "generation_attempts": 0,
    }


@pytest.mark.asyncio
async def test_planner_actions_strong_answer_deepens(base_state: InterviewState):
    """A strong answer (score >= 8.0) triggers the 'deepen' action."""
    base_state["evaluations_history"] = [{"score": 9.0, "feedback": "Excellent depth."}]
    base_state["candidate_answer"] = "We utilized read replicas with connection routing and asynchronous replication monitoring."
    base_state["consecutive_followups"] = 0

    plan = await plan_turn_node(base_state)
    assert plan["current_action"] == "deepen"
    assert plan["consecutive_followups"] == 1


@pytest.mark.asyncio
async def test_planner_actions_weak_or_uncertain_answer_simplifies(base_state: InterviewState):
    """An uncertain ('I don't know') or weak answer triggers 'simplify_and_bridge'."""
    base_state["evaluations_history"] = [{"score": 2.5, "feedback": "Incomplete answer."}]
    base_state["candidate_answer"] = "I don't know how connection pooling works under the hood, sorry."
    base_state["consecutive_followups"] = 0

    plan = await plan_turn_node(base_state)
    assert plan["current_action"] == "simplify_and_bridge"
    assert plan["consecutive_followups"] == 1


@pytest.mark.asyncio
async def test_planner_actions_vague_brief_answer_clarifies(base_state: InterviewState):
    """A brief answer (< 20 words) with average score triggers 'follow_up_clarify'."""
    base_state["evaluations_history"] = [{"score": 5.0, "feedback": "Brief answer."}]
    base_state["candidate_answer"] = "We just used default pools and it worked okay."
    base_state["consecutive_followups"] = 0

    plan = await plan_turn_node(base_state)
    assert plan["current_action"] == "follow_up_clarify"
    assert plan["consecutive_followups"] == 1


@pytest.mark.asyncio
async def test_planner_actions_tech_mention_probes(base_state: InterviewState):
    """Explicitly mentioning a technology with solid score triggers 'follow_up_probe'."""
    base_state["evaluations_history"] = [{"score": 6.5, "feedback": "Mentioned Redis."}]
    base_state["candidate_answer"] = (
        "In our application we added Redis for caching frequent user profile queries "
        "to prevent overloading the primary PostgreSQL instance."
    )
    base_state["consecutive_followups"] = 0

    plan = await plan_turn_node(base_state)
    assert plan["current_action"] == "follow_up_probe"
    assert any(term in plan["target_topic"].lower() for term in ("redis", "caching", "postgresql"))
    assert plan["consecutive_followups"] == 1


@pytest.mark.asyncio
async def test_planner_followup_cap_forces_new_topic(base_state: InterviewState):
    """At consecutive_followups >= 2, planner forces transition to new topic from resume or role."""
    base_state["consecutive_followups"] = 2
    base_state["covered_topics"] = ["Database & Indexing", "Python"]
    base_state["candidate_resume_tags"] = ["Python", "FastAPI", "Docker"]

    plan = await plan_turn_node(base_state)
    assert plan["current_action"] in ("new_topic_from_resume", "new_topic_from_role")
    assert plan["consecutive_followups"] == 0
    assert plan["target_topic"] in ("FastAPI", "Docker")


@pytest.mark.asyncio
async def test_planner_behavioral_on_fifth_question(base_state: InterviewState):
    """Every 5th question triggers the behavioral STAR action."""
    base_state["current_question_index"] = 5
    plan = await plan_turn_node(base_state)
    assert plan["current_action"] == "behavioral"
    assert plan["consecutive_followups"] == 0


@pytest.mark.asyncio
async def test_planner_wrap_up_when_time_low(base_state: InterviewState):
    """When time_left_seconds < 180, planner triggers 'wrap_up'."""
    base_state["time_left_seconds"] = 120  # 2 minutes left
    plan = await plan_turn_node(base_state)
    assert plan["current_action"] == "wrap_up"


@pytest.mark.asyncio
async def test_duplicate_question_detection():
    """Duplicate validator detects semantically and lexically identical questions."""
    embedder = get_embedding_service()
    q1 = "How do you handle database indexing and slow query optimization in PostgreSQL?"
    q1_vec = await embedder.embed_query(q1)

    asked_embeddings = [q1_vec]
    asked_texts = [q1]

    # Test identical question
    is_dup, score = await _is_duplicate_question(
        "How do you handle database indexing and slow query optimization in PostgreSQL?",
        asked_embeddings,
        asked_texts,
        embedder,
    )
    assert is_dup is True

    # Test distinct question
    is_dup_distinct, _ = await _is_duplicate_question(
        "Can you describe how you configure CI/CD pipelines using GitHub Actions and Docker?",
        asked_embeddings,
        asked_texts,
        embedder,
    )
    assert is_dup_distinct is False


def test_grounding_validator_catches_hallucinations():
    """Grounding validator flags ungrounded technologies not in candidate resume."""
    resume_tags = ["Python", "Django", "PostgreSQL"]
    retrieved_chunks = [{"tech_tags": ["Python", "Django"], "chunk_text": "Built Django REST APIs."}]
    answer_tags = ["Django"]

    # Question referencing ungrounded Kubernetes / Go
    is_grounded, err = _check_grounding(
        question_text="On your resume you mentioned Kubernetes clusters and Go microservices. How did you scale them?",
        action="new_topic_from_resume",
        candidate_resume_tags=resume_tags,
        retrieved_resume_chunks=retrieved_chunks,
        previous_answer_tags=answer_tags,
    )
    assert is_grounded is False
    assert "Kubernetes" in err or "Go" in err or "kubernetes" in err.lower()

    # Question referencing grounded Python / PostgreSQL
    is_grounded_valid, err_valid = _check_grounding(
        question_text="Looking at your background in Python and PostgreSQL, how did you structure your ORM queries?",
        action="new_topic_from_resume",
        candidate_resume_tags=resume_tags,
        retrieved_resume_chunks=retrieved_chunks,
        previous_answer_tags=answer_tags,
    )
    assert is_grounded_valid is True
    assert err_valid is None


@pytest.mark.asyncio
async def test_validate_question_node_rejects_staff_question_for_mid(base_state: InterviewState):
    """Validation node rejects distributed consensus / CAP theorem questions for Mid candidates."""
    base_state["current_question"] = (
        "Suppose our distributed system experiences network partitions or eventual consistency lag "
        "when reading/writing state. How would you design fault-tolerant failovers using Raft or Paxos?"
    )
    base_state["generation_attempts"] = 0

    val_res = await validate_question_node(base_state)
    # First attempt should reject with validation feedback to generator
    assert val_res.get("validation_feedback") is not None
    assert "seniority ceiling" in val_res["validation_feedback"].lower() or "forbidden" in val_res["validation_feedback"].lower()
    assert val_res["generation_attempts"] == 1


@pytest.mark.asyncio
async def test_fallback_ladder_selects_authored_kb_question_after_retries(
    base_state: InterviewState,
    caplog,
):
    """After 2 failed generation attempts, validation falls back to authored KB question and logs warning."""
    base_state["current_question"] = (
        "Explain Paxos consensus and network partition handling across multi-region clusters."
    )
    base_state["generation_attempts"] = 1  # 2nd attempt will reach limit (attempts >= 2)

    with caplog.at_level(logging.WARNING):
        val_res = await validate_question_node(base_state)

    # Validation should clear feedback and replace question with an authored fallback
    assert val_res.get("validation_feedback") is None
    assert val_res["generation_attempts"] == 0
    assert "Paxos" not in val_res["current_question"]
    # Check that fallback was explicitly logged
    assert any("fallback" in rec.message.lower() for rec in caplog.records)


@pytest.mark.asyncio
async def test_adaptive_difficulty_step_and_clamping(base_state: InterviewState):
    """Difficulty upgrades on high scores (+0.5) and clamps at Mid max difficulty (4.0)."""
    # Mid starts at 2.0
    base_state["numeric_difficulty"] = 2.0
    base_state["evaluations_history"] = [{"score": 9.0}]  # 9.0 / 2 = 4.5 >= 4.0 -> bump +0.5

    diff_res = update_difficulty_node(base_state)
    assert diff_res["numeric_difficulty"] == 2.5
    assert diff_res["difficulty"] == "Medium"
    assert diff_res["difficulty_change"] == "UPGRADE"

    # Set to max 4.0 and score high again -> should stay clamped at 4.0 (Medium-Hard)
    base_state["numeric_difficulty"] = 4.0
    diff_res_capped = update_difficulty_node(base_state)
    assert diff_res_capped["numeric_difficulty"] == 4.0
    assert diff_res_capped["difficulty"] == "Medium-Hard"


@pytest.mark.asyncio
async def test_rolling_summary_updates(base_state: InterviewState):
    """update_summary_node appends turn Q&A, score, and feedback to rolling summary."""
    base_state["current_question"] = "How do you handle migrations in Alembic?"
    base_state["candidate_answer"] = "I create autogenerated revisions, inspect the upgrade script, and run alembic upgrade head."
    base_state["evaluation"] = {"score": 8.0, "feedback": "Safe migration workflow."}
    base_state["current_action"] = "new_topic_from_resume"
    base_state["current_topic"] = "Database & Indexing"

    summary_res = await update_summary_node(base_state)
    rolling = summary_res["rolling_summary"]
    assert "Turn 2 [new_topic_from_resume | Database & Indexing]" in rolling
    assert "How do you handle migrations in Alembic?" in rolling
    assert "Score: 8.0/10" in rolling
    assert "Database & Indexing" in summary_res["covered_topics"]


@pytest.mark.asyncio
async def test_multi_turn_interview_lifecycle():
    """End-to-end integration: start_interview -> submit_candidate_answer advances properly."""
    # 1. Start interview
    state = await start_interview(
        session_id="integration-session-1",
        user_id="user-integration-1",
        role="Backend",
        seniority="Mid",
        difficulty="Adaptive",
        resume_summary="Python, FastAPI, Redis, Docker developer.",
        target_skills=["Python", "FastAPI", "Redis", "Docker"],
        max_questions=3,
    )

    assert state["current_question_index"] == 1
    assert state["current_question"] is not None
    assert len(state["conversation_history"]) == 1
    assert state["current_action"] in ("new_topic_from_resume", "new_topic_from_role")

    # 2. Candidate answers question 1 with strong response
    answer_1 = (
        "For database connection pooling with FastAPI, I configure SQLAlchemy's AsyncEngine "
        "with pool_size=15 and max_overflow=5, ensuring connections are released after each request."
    )
    updated_state = await submit_candidate_answer(state, answer_1)

    assert updated_state["current_question_index"] == 2
    assert updated_state["evaluation"]["score"] >= 7.0
    assert len(updated_state["conversation_history"]) == 3  # Q1, A1, Q2
    assert updated_state["current_question"] is not None
    assert updated_state["rolling_summary"] != ""

