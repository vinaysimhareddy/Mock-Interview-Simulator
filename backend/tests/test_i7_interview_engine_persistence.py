import pytest
from httpx import ASGITransport, AsyncClient

from app.core.database import get_database
from app.main import app
from app.services.interview_engine import (
    _heuristic_evaluate,
    _generate_heuristic_question,
    update_difficulty_state,
    end_interview_node,
    InterviewState,
)
from app.services.integrity_service import compute_verified_non_verbal_scores
from app.repositories.evaluation_repo import evaluation_repo


@pytest.mark.asyncio
async def test_i7_heuristic_rubric_evaluation_accuracy():
    """Verify that heuristic rubric calculates realistic, multi-axis scores based on technical depth."""
    # 1. Very brief answer
    brief_eval = _heuristic_evaluate("I used python.", "Senior", {})
    assert brief_eval["score"] == 2.5
    assert brief_eval["technical_accuracy"] == 2.0
    assert brief_eval["clarity"] == 3.0
    assert "too brief" in brief_eval["feedback"].lower()

    # 2. Strong architectural response with multiple keywords (>= 50 words, >= 4 keywords)
    strong_ans = (
        "We implemented a high-throughput microservices architecture using Apache Kafka and PostgreSQL "
        "with Redis caching for read-heavy query paths. To ensure strict consistency and avoid dual-write hazards, "
        "we implemented the transactional outbox pattern with Debezium CDC. The service maintained 45,000 queries per second "
        "with p99 latency under 20ms and automated database partition pruning."
    )
    strong_eval = _heuristic_evaluate(strong_ans, "Senior", {})
    assert strong_eval["score"] >= 9.0
    assert strong_eval["technical_accuracy"] >= 9.0
    assert strong_eval["clarity"] >= 8.5
    assert strong_eval["completeness"] >= 8.5
    assert "depth" in strong_eval["feedback"].lower() or "excellent" in strong_eval["feedback"].lower()


@pytest.mark.asyncio
async def test_i7_difficulty_adaptation_rules():
    """Verify dynamic difficulty upgrade and downgrade state transitions."""
    # Score 9.0 on Medium -> UPGRADE to Hard
    state_medium: InterviewState = {
        "session_id": "sess_1",
        "user_id": "user_1",
        "role": "Backend Engineer",
        "seniority": "Senior",
        "difficulty": "Medium",
        "resume_summary": None,
        "target_skills": ["Python", "FastAPI"],
        "current_question_index": 1,
        "max_questions": 5,
        "current_question": "Question 1",
        "candidate_answer": "Great answer",
        "evaluation": {"score": 9.0},
        "evaluations_history": [{"score": 9.0}],
        "difficulty_history": ["Medium"],
        "difficulty_change": None,
        "conversation_history": [],
        "telemetry_summary": None,
        "integrity_summary": None,
        "final_report": None,
        "is_finished": False,
    }
    upgraded = update_difficulty_state(state_medium)
    assert upgraded["difficulty"] == "Hard"
    assert upgraded["difficulty_change"] == "UPGRADE"
    assert upgraded["current_question_index"] == 2

    # Score 3.0 on Hard -> DOWNGRADE to Medium
    state_hard: InterviewState = {
        **state_medium,
        "difficulty": "Hard",
        "evaluations_history": [{"score": 3.0}],
    }
    downgraded = update_difficulty_state(state_hard)
    assert downgraded["difficulty"] == "Medium"
    assert downgraded["difficulty_change"] == "DOWNGRADE"


@pytest.mark.asyncio
async def test_i7_honest_composure_and_scorecard_calculation():
    """Verify that scorecard calculation avoids hardcoded 0.85/85% fallback when telemetry is absent."""
    eval_hist = [
        {"score": 8.0, "technical_accuracy": 8.5, "clarity": 8.0, "completeness": 8.0},
        {"score": 9.0, "technical_accuracy": 9.0, "clarity": 8.5, "completeness": 9.0},
    ]

    base_state: InterviewState = {
        "session_id": "sess_honest",
        "user_id": "user_honest",
        "role": "Staff Engineer",
        "seniority": "Staff",
        "difficulty": "Hard",
        "resume_summary": None,
        "target_skills": ["Kafka"],
        "current_question_index": 5,
        "max_questions": 5,
        "current_question": "Q5",
        "candidate_answer": "A5",
        "evaluation": eval_hist[-1],
        "evaluations_history": eval_hist,
        "difficulty_history": ["Hard", "Hard"],
        "difficulty_change": "UNCHANGED",
        "conversation_history": [],
        "telemetry_summary": None,  # Non-verbal feed absent
        "integrity_summary": None,
        "final_report": None,
        "is_finished": False,
    }

    # Case A: Telemetry is absent -> must honestly reweight without 85% fake composure
    res_no_telemetry = await end_interview_node(base_state)
    report_a = res_no_telemetry["final_report"]
    assert report_a["overall_score"] > 0
    # Verified no hardcoded 85% fallback
    assert report_a["category_scores"]["composure"] == report_a["category_scores"]["communication"]

    # Case B: Telemetry is present with real values
    state_with_telemetry: InterviewState = {
        **base_state,
        "telemetry_summary": {
            "eye_contact_ratio": 0.92,
            "posture_score": 0.88,
        },
    }
    res_telemetry = await end_interview_node(state_with_telemetry)
    report_b = res_telemetry["final_report"]
    expected_composure = round(((0.92 * 0.6) + (0.88 * 0.4)) * 100.0, 1)
    assert report_b["category_scores"]["composure"] == expected_composure
    assert report_b["category_scores"]["composure"] != 85.0


@pytest.mark.asyncio
async def test_i7_evaluation_persistence_in_mongodb():
    """Verify that completed evaluation reports are correctly upserted and retrieved from evaluations collection."""
    session_id = "sess_persist_test_7"
    user_id = "user_persist_test_7"
    dummy_report = {
        "overall_score": 88.5,
        "category_scores": {"technical": 90.0, "communication": 86.0, "composure": 88.0},
        "hiring_recommendation": "Strong Hire",
        "strengths": ["Deep architectural depth", "Clear communication"],
        "weaknesses": ["Could discuss telemetry metrics further"],
        "executive_summary": "Candidate demonstrated strong staff engineering competency.",
    }

    # Save to MongoDB via evaluation_repo
    saved = await evaluation_repo.save_evaluation(
        session_id=session_id,
        user_id=user_id,
        report=dummy_report,
        final_score=88.5,
    )
    assert saved is not None
    assert saved["session_id"] == session_id

    # Retrieve from MongoDB and verify isolation
    retrieved = await evaluation_repo.get_by_session_and_user(session_id, user_id)
    assert retrieved is not None
    assert retrieved["session_id"] == session_id
    assert retrieved["report"]["overall_score"] == 88.5
    assert retrieved["report"]["hiring_recommendation"] == "Strong Hire"

    # Isolation check: different user must receive None
    diff_user = await evaluation_repo.get_by_session_and_user(session_id, "other_user_id")
    assert diff_user is None
