import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.models.interview import FinalReport
from app.repositories.session_repo import session_repo
from app.services.interview_engine import end_interview_node, _format_source_description


@pytest.mark.asyncio
async def test_session_repo_record_turn() -> None:
    """Verify session_repo.record_turn atomically pushes turns to session.turns in MongoDB."""
    test_session_id = "test-session-record-turn-123"
    test_user_id = "test-user-456"

    # Seed mock session
    await session_repo.collection.delete_one({"_id": test_session_id})
    await session_repo.collection.insert_one(
        {
            "_id": test_session_id,
            "user_id": test_user_id,
            "role": "Backend Engineer",
            "seniority": "Mid",
            "status": "IN_PROGRESS",
            "turns": [],
        }
    )

    turn_data = {
        "question_index": 1,
        "question": "How do you configure database connection pooling with SQLAlchemy?",
        "candidate_answer": "I configure async_sessionmaker with pool_size=20 and max_overflow=10.",
        "planner_action": "new_topic_from_resume",
        "target_topic": "SQLAlchemy & PostgreSQL",
        "sources_used": [{"source": "resume", "title": "SQLAlchemy & PostgreSQL"}],
        "source_description": "Grounded in Resume: SQLAlchemy & PostgreSQL",
        "difficulty_tier": 2.0,
        "difficulty_label": "Easy-Medium",
        "difficulty_change": "UNCHANGED",
        "score": 8.5,
        "feedback": "Strong understanding of pool sizing and overflow mechanics.",
        "technical_accuracy": 9.0,
        "clarity": 8.0,
        "completeness": 8.5,
    }

    await session_repo.record_turn(
        session_id=test_session_id,
        user_id=test_user_id,
        turn=turn_data,
    )

    # Verify session document has turn recorded
    doc = await session_repo.collection.find_one({"_id": test_session_id})
    assert doc is not None
    assert "turns" in doc
    assert len(doc["turns"]) == 1

    saved_turn = doc["turns"][0]
    assert saved_turn["question_index"] == 1
    assert saved_turn["planner_action"] == "new_topic_from_resume"
    assert saved_turn["target_topic"] == "SQLAlchemy & PostgreSQL"
    assert saved_turn["source_description"] == "Grounded in Resume: SQLAlchemy & PostgreSQL"
    assert saved_turn["difficulty_tier"] == 2.0
    assert saved_turn["difficulty_label"] == "Easy-Medium"
    assert saved_turn["score"] == 8.5
    assert "created_at" in saved_turn

    # Clean up
    await session_repo.collection.delete_one({"_id": test_session_id})


@pytest.mark.asyncio
async def test_end_interview_node_constructs_coverage_and_progression() -> None:
    """Verify end_interview_node maps turns_history to question_coverage and difficulty_progression on FinalReport."""
    sample_turns = [
        {
            "question_index": 1,
            "question": "What is the event loop in Node.js?",
            "candidate_answer": "It orchestrates asynchronous I/O via libuv and phase queues.",
            "planner_action": "new_topic_from_resume",
            "target_topic": "Node.js Architecture",
            "sources_used": [{"source": "resume", "title": "Node.js"}],
            "source_description": "Grounded in Resume: Node.js",
            "difficulty_tier": 2.0,
            "difficulty_label": "Easy-Medium",
            "difficulty_change": "UPGRADE",
            "score": 8.5,
            "feedback": "Accurate explanation of libuv threadpool.",
            "technical_accuracy": 9.0,
            "clarity": 8.0,
            "completeness": 8.5,
        },
        {
            "question_index": 2,
            "question": "How do you handle unhandled promise rejections?",
            "candidate_answer": "Listen on process.on('unhandledRejection') and log or gracefully restart.",
            "planner_action": "follow_up_probe",
            "target_topic": "Error Handling",
            "sources_used": [{"source": "knowledge_base", "title": "Error Handling"}],
            "source_description": "Adaptive follow-up: Error Handling",
            "difficulty_tier": 2.5,
            "difficulty_label": "Medium",
            "difficulty_change": "UNCHANGED",
            "score": 7.5,
            "feedback": "Good answer covering process level traps.",
            "technical_accuracy": 8.0,
            "clarity": 7.5,
            "completeness": 7.0,
        },
    ]

    mock_state: dict = {
        "role": "Backend Engineer",
        "seniority": "Mid",
        "turns_history": sample_turns,
        "evaluations_history": [
            {"score": 8.5, "technical_accuracy": 9.0, "clarity": 8.0, "completeness": 8.5},
            {"score": 7.5, "technical_accuracy": 8.0, "clarity": 7.5, "completeness": 7.0},
        ],
        "telemetry_summary": {
            "eye_contact_ratio": 0.85,
            "posture_score": 0.90,
        },
    }

    result = await end_interview_node(mock_state)  # type: ignore[arg-type]
    raw_report: dict = result["final_report"]
    report: FinalReport = FinalReport(**raw_report)

    assert isinstance(report, FinalReport)
    assert report.question_coverage is not None
    assert len(report.question_coverage) == 2

    q1 = report.question_coverage[0]
    assert q1.question_index == 1
    assert q1.planner_action == "new_topic_from_resume"
    assert q1.source_description == "Grounded in Resume: Node.js"
    assert q1.difficulty_tier == 2.0
    assert q1.difficulty_label == "Easy-Medium"
    assert q1.score == 8.5

    q2 = report.question_coverage[1]
    assert q2.question_index == 2
    assert q2.planner_action == "follow_up_probe"
    assert q2.source_description == "Adaptive follow-up: Error Handling"
    assert q2.difficulty_tier == 2.5
    assert q2.difficulty_label == "Medium"
    assert q2.score == 7.5

    assert report.difficulty_progression is not None
    assert len(report.difficulty_progression) == 2
    assert report.difficulty_progression[0].difficulty_tier == 2.0
    assert report.difficulty_progression[0].change == "UPGRADE"
    assert report.difficulty_progression[1].difficulty_tier == 2.5
    assert report.difficulty_progression[1].change == "UNCHANGED"


@pytest.mark.asyncio
async def test_get_report_api_endpoint_with_coverage() -> None:
    """Verify GET /api/v1/interview/sessions/{session_id}/report returns question_coverage and difficulty_progression."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        # Register and login candidate
        reg_payload = {
            "email": "report.coverage.test@example.com",
            "full_name": "Report Coverage Candidate",
            "password": "Password123!",
        }
        await client.post("/api/v1/auth/register", json=reg_payload)
        login_resp = await client.post(
            "/api/v1/auth/login",
            json={"email": "report.coverage.test@example.com", "password": "Password123!"},
        )
        assert login_resp.status_code == 200
        token = login_resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Create session
        sess_create_payload = {
            "role": "Backend Engineer",
            "seniority": "Mid",
            "difficulty": "Adaptive",
            "max_questions": 2,
        }
        sess_resp = await client.post("/api/v1/sessions", headers=headers, json=sess_create_payload)
        assert sess_resp.status_code == 201
        session_id = sess_resp.json()["id"]

        # Insert a final_report in session document
        report_data = {
            "overall_score": 82.0,
            "category_scores": {"technical": 85.0, "communication": 80.0, "composure": 80.0},
            "hiring_recommendation": "Hire",
            "strengths": ["Solid API design"],
            "weaknesses": ["Improve query caching"],
            "executive_summary": "Demonstrated competent mid-level backend capabilities.",
            "question_coverage": [
                {
                    "question_index": 1,
                    "question": "How do you handle API versioning in FastAPI?",
                    "candidate_answer": "I use URL path prefix routing like /api/v1.",
                    "planner_action": "new_topic_from_resume",
                    "target_topic": "FastAPI",
                    "source_description": "Grounded in Resume: FastAPI",
                    "difficulty_tier": 2.0,
                    "difficulty_label": "Easy-Medium",
                    "score": 8.0,
                    "feedback": "Clean standard approach.",
                }
            ],
            "difficulty_progression": [
                {
                    "question_index": 1,
                    "difficulty_tier": 2.0,
                    "difficulty_label": "Easy-Medium",
                    "score": 8.0,
                    "change": "UNCHANGED",
                }
            ],
        }

        await session_repo.collection.update_one(
            {"_id": session_id},
            {
                "$set": {
                    "status": "COMPLETED",
                    "session_status": "completed",
                    "interview_state": {"final_report": report_data},
                }
            },
        )

        # Query report endpoint
        report_resp = await client.get(
            f"/api/v1/interview/sessions/{session_id}/report",
            headers=headers,
        )
        assert report_resp.status_code == 200
        report_json = report_resp.json()

        assert "question_coverage" in report_json
        assert len(report_json["question_coverage"]) == 1
        assert report_json["question_coverage"][0]["source_description"] == "Grounded in Resume: FastAPI"
        assert report_json["question_coverage"][0]["difficulty_label"] == "Easy-Medium"
        assert report_json["question_coverage"][0]["score"] == 8.0

        assert "difficulty_progression" in report_json
        assert len(report_json["difficulty_progression"]) == 1
        assert report_json["difficulty_progression"][0]["difficulty_tier"] == 2.0
        assert report_json["difficulty_progression"][0]["change"] == "UNCHANGED"
