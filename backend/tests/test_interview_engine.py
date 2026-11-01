import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_adaptive_interview_workflow_all_5_questions() -> None:
    """Run candidate through all 5 questions, verify dynamic difficulty changes, and check final report."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        # 1. Register & login candidate
        reg_payload = {
            "email": "langgraph.candidate@example.com",
            "full_name": "LangGraph Candidate",
            "password": "Password123!",
        }
        await client.post("/api/v1/auth/register", json=reg_payload)
        login_resp = await client.post(
            "/api/v1/auth/login",
            json={"email": "langgraph.candidate@example.com", "password": "Password123!"},
        )
        assert login_resp.status_code == 200
        token = login_resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 2. Create Interview Session (5-question test workflow)
        sess_create_payload = {
            "role": "Distributed Systems Engineer",
            "seniority": "Senior",
            "difficulty": "Adaptive",
            "max_questions": 5,
        }
        sess_resp = await client.post("/api/v1/sessions", headers=headers, json=sess_create_payload)
        assert sess_resp.status_code == 201
        session_id = sess_resp.json()["id"]

        # 3. Start Interview: Generate Question #1
        start_resp = await client.post(
            f"/api/v1/interview/sessions/{session_id}/start", headers=headers
        )
        assert start_resp.status_code == 200
        start_data = start_resp.json()
        assert start_data["status"] == "IN_PROGRESS"
        assert start_data["current_question_index"] == 1
        assert start_data["max_questions"] == 5
        assert start_data["next_question"] is not None
        assert len(start_data["next_question"]) > 10
        initial_diff = start_data["difficulty"]

        # 4. Question 1: Submit high-scoring answer (> 8.0) -> Triggers UPGRADE
        strong_answer = (
            "We implemented a high-throughput microservices architecture using Apache Kafka and PostgreSQL "
            "with Redis caching for read-heavy query paths. To ensure strict consistency and avoid dual-write hazards, "
            "we implemented the transactional outbox pattern with Debezium CDC. The service maintained 45,000 queries per second "
            "with p99 latency under 20ms and automated database partition pruning."
        )
        ans1_resp = await client.post(
            f"/api/v1/interview/sessions/{session_id}/answer",
            headers=headers,
            json={"answer": strong_answer},
        )
        assert ans1_resp.status_code == 200
        ans1_data = ans1_resp.json()
        assert ans1_data["status"] == "IN_PROGRESS"
        assert ans1_data["current_question_index"] == 2
        assert ans1_data.get("evaluation") is None  # Withheld mid-interview to prevent bias
        assert ans1_data["difficulty_change"] == "UPGRADE"
        upgraded_diff = ans1_data["difficulty"]
        assert upgraded_diff in ("Medium-Hard", "Hard", "Hard/Expert", "Staff")

        # 5. Question 2: Submit low-scoring answer (< 5.0) -> Triggers DOWNGRADE
        weak_answer = "I don't know much about that."
        ans2_resp = await client.post(
            f"/api/v1/interview/sessions/{session_id}/answer",
            headers=headers,
            json={"answer": weak_answer},
        )
        assert ans2_resp.status_code == 200
        ans2_data = ans2_resp.json()
        assert ans2_data["status"] == "IN_PROGRESS"
        assert ans2_data["current_question_index"] == 3
        assert ans2_data.get("evaluation") is None  # Withheld mid-interview to prevent bias
        assert ans2_data["difficulty_change"] == "DOWNGRADE"
        downgraded_diff = ans2_data["difficulty"]
        assert downgraded_diff in ("Medium", "Easy-Medium", "Easy")

        # 6. Question 3: Submit solid answer
        solid_ans3 = (
            "We rely on distributed locks using Redis Redlock and database schema partitioning "
            "to isolate tenant traffic and maintain strict idempotency across asynchronous queues."
        )
        ans3_resp = await client.post(
            f"/api/v1/interview/sessions/{session_id}/answer",
            headers=headers,
            json={"answer": solid_ans3},
        )
        assert ans3_resp.status_code == 200
        assert ans3_resp.json()["current_question_index"] == 4

        # 7. Question 4: Submit solid answer
        solid_ans4 = (
            "For backwards compatibility we use Protobuf schemas with forward-compatible versioning "
            "and automated contract tests in CI/CD to prevent breaking downstream consumers."
        )
        ans4_resp = await client.post(
            f"/api/v1/interview/sessions/{session_id}/answer",
            headers=headers,
            json={"answer": solid_ans4},
        )
        assert ans4_resp.status_code == 200
        assert ans4_resp.json()["current_question_index"] == 5

        # 8. Question 5: Submit final answer -> Concludes Interview (max_questions reached)
        final_ans5 = (
            "During a network partition, we experienced cascading timeouts due to unconfigured socket timeouts. "
            "We resolved it by deploying Envoy sidecars with circuit breaking, exponential jitter backoff, "
            "and dead-letter queue fallbacks."
        )
        ans5_resp = await client.post(
            f"/api/v1/interview/sessions/{session_id}/answer",
            headers=headers,
            json={"answer": final_ans5},
        )
        assert ans5_resp.status_code == 200
        ans5_data = ans5_resp.json()
        assert ans5_data["status"] == "COMPLETED"
        assert ans5_data["next_question"] is None
        assert ans5_data["final_report"] is not None

        final_rep = ans5_data["final_report"]
        assert final_rep["overall_score"] > 0.0
        assert final_rep["category_scores"]["technical"] > 0.0
        assert final_rep["category_scores"]["communication"] > 0.0
        assert final_rep["category_scores"]["composure"] > 0.0
        assert len(final_rep["strengths"]) >= 2
        assert len(final_rep["weaknesses"]) >= 1
        assert final_rep["hiring_recommendation"] in ("Strong Hire", "Hire", "Leaning Hire", "No Hire")

        # 9. Verify GET /api/v1/interview/sessions/{session_id}/report
        report_resp = await client.get(
            f"/api/v1/interview/sessions/{session_id}/report", headers=headers
        )
        assert report_resp.status_code == 200
        assert report_resp.json()["overall_score"] == final_rep["overall_score"]

        # 10. Verify GET /api/v1/interview/sessions/{session_id}/state
        state_resp = await client.get(
            f"/api/v1/interview/sessions/{session_id}/state", headers=headers
        )
        assert state_resp.status_code == 200
        state_data = state_resp.json()
        assert state_data["status"] == "COMPLETED"
        assert len(state_data["evaluations_history"]) == 5
        assert state_data["evaluations_history"][0]["score"] >= 8.0
        assert state_data["evaluations_history"][1]["score"] < 5.0
        assert len(state_data["conversation_history"]) >= 10
