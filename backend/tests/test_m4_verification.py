import pytest
from httpx import ASGITransport, AsyncClient
from unittest.mock import AsyncMock, patch

from app.main import app
from app.core.database import get_database
from app.models.resume import ParsedProfile, WorkHistoryItem
from app.repositories.resume_repo import resume_repo
from app.repositories.session_repo import session_repo
from app.repositories.telemetry_repo import telemetry_repo
from app.repositories.integrity_repo import integrity_repo
from app.repositories.evaluation_repo import evaluation_repo


SAMPLE_PDF_BYTES = b"""%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 110 >> stream
BT
/F1 12 Tf
20 160 Td
(Alice Engineer - Backend Specialist) Tj
0 -25 Td
(Skills: Python FastAPI MongoDB Docker AsyncIO) Tj
ET
endstream
endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
00000000115 00000 n 
0000000236 00000 n 
0000000397 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
468
%%EOF
"""

MOCK_PARSED_PROFILE = ParsedProfile(
    technical_skills=["Python", "FastAPI", "MongoDB", "AsyncIO"],
    experience_years=4.0,
    work_history=[
        WorkHistoryItem(
            company="Atlas Scale Inc",
            title="Senior Platform Engineer",
            start="2022",
            end="Present",
            highlights=["Deployed resilient distributed services"],
        )
    ],
    summary="Senior Platform Engineer specializing in high-throughput cloud backends.",
)


async def register_and_login(client: AsyncClient, email: str) -> tuple[str, dict[str, str]]:
    """Helper creating a test user and returning (user_id, auth_headers)."""
    reg_res = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "full_name": "Test Candidate", "password": "TestPassword123!"},
    )
    assert reg_res.status_code in (201, 409)
    login_res = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "TestPassword123!"},
    )
    assert login_res.status_code == 200
    token = login_res.json()["access_token"]
    me_res = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me_res.status_code == 200
    user_id = me_res.json()["id"]
    return user_id, {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_m4_domain_repositories_and_collections() -> None:
    """Verify that domain repositories write to and read from their dedicated collections."""
    db = await get_database()

    # 1. Resume repository -> 'resumes' collection
    created_resume = await resume_repo.create_resume(
        user_id="user_m4_test_1",
        filename="alice_resume.pdf",
        file_size=1024,
        raw_text="Alice Engineer Backend Specialist",
        parsed_profile=MOCK_PARSED_PROFILE.model_dump(),
    )
    assert created_resume["id"] is not None
    resume_in_db = await db["resumes"].find_one({"_id": created_resume["id"]})
    if resume_in_db is None:
        from bson import ObjectId
        resume_in_db = await db["resumes"].find_one({"_id": ObjectId(created_resume["id"])})
    assert resume_in_db is not None
    assert resume_in_db["user_id"] == "user_m4_test_1"
    assert resume_in_db["filename"] == "alice_resume.pdf"

    # 2. Session repository -> 'interview_sessions' collection
    created_session = await session_repo.create_session(
        user_id="user_m4_test_1",
        job_role="Senior Backend Engineer",
        target_seniority="Senior",
        difficulty="Hard",
        resume_id=created_resume["id"],
    )
    session_id = created_session["id"]
    assert session_id is not None
    sess_in_db = await db["interview_sessions"].find_one({"_id": session_id})
    if sess_in_db is None:
        from bson import ObjectId
        sess_in_db = await db["interview_sessions"].find_one({"_id": ObjectId(session_id)})
    assert sess_in_db is not None
    assert sess_in_db["user_id"] == "user_m4_test_1"
    assert sess_in_db["session_status"] == "created"

    # Add transcript turns to session
    await session_repo.add_transcript_turn(
        session_id=session_id,
        user_id="user_m4_test_1",
        turn={"turn_id": "turn_1", "role": "interviewer", "text": "Tell me about your Python experience."},
    )
    sess_updated = await session_repo.get_by_id_and_user(session_id, "user_m4_test_1")
    assert sess_updated is not None
    assert len(sess_updated.get("transcript", [])) >= 1

    # 3. Telemetry repository -> 'telemetry_samples' collection
    samples = [
        {
            "t": i,
            "eye_contact_ratio": 0.85,
            "posture_score": 0.90,
            "face_present": True,
            "fps": 30,
        }
        for i in range(10)
    ]
    inserted_bucket = await telemetry_repo.insert_telemetry_bucket(
        session_id=session_id,
        bucket_index=0,
        samples=samples,
    )
    assert inserted_bucket != ""
    telem_in_db = await db["telemetry_samples"].find_one({"session_id": session_id})
    assert telem_in_db is not None
    assert len(telem_in_db["samples"]) == 10

    # 4. Integrity repository -> 'integrity_events' collection
    await integrity_repo.record_event(
        session_id=session_id,
        event_type="multiple_faces_detected",
        t=15.0,
        confidence=0.95,
        details={"faces_count": 2},
    )
    integ_events = await integrity_repo.list_by_session(session_id=session_id)
    assert len(integ_events) >= 1
    assert integ_events[0]["event_type"] == "multiple_faces_detected"
    integ_in_db = await db["integrity_events"].find_one({"session_id": session_id})
    assert integ_in_db is not None

    # 5. Evaluation repository -> 'evaluations' collection
    eval_report = {
        "overall_score": 88.0,
        "technical_competency_score": 90.0,
        "communication_score": 85.0,
        "non_verbal_score": 89.0,
        "dimension_breakdown": {"algorithms": 90, "system_design": 88},
        "strengths": ["Deep async understanding", "Solid DB architecture knowledge"],
        "improvements": ["Elaborate on edge-case testing"],
        "detailed_summary": "Strong candidate exhibiting comprehensive senior-level expertise.",
    }
    saved_eval = await evaluation_repo.save_evaluation(
        session_id=session_id,
        user_id="user_m4_test_1",
        report=eval_report,
        final_score=88.0,
    )
    assert saved_eval is not None
    eval_in_db = await db["evaluations"].find_one({"session_id": session_id})
    assert eval_in_db is not None
    assert eval_in_db["overall_score"] == 88.0


@pytest.mark.asyncio
async def test_m4_cross_user_isolation_returns_404() -> None:
    """Verify strict user isolation returning 404 (not 403) across all endpoints."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        # Candidate A registers, uploads resume, creates session
        user_a_id, headers_a = await register_and_login(client, "alice.owner@example.com")

        with patch(
            "app.api.v1.endpoints.resumes.parse_resume_profile",
            new=AsyncMock(return_value=MOCK_PARSED_PROFILE),
        ):
            up_resp = await client.post(
                "/api/v1/resumes/upload",
                files={"file": ("alice_resume.pdf", SAMPLE_PDF_BYTES, "application/pdf")},
                headers=headers_a,
            )
            assert up_resp.status_code == 201
            resume_a_id = up_resp.json()["id"]

        sess_resp = await client.post(
            "/api/v1/sessions",
            json={
                "job_role": "Backend Engineer",
                "target_seniority": "Senior",
                "difficulty": "Hard",
                "resume_id": resume_a_id,
            },
            headers=headers_a,
        )
        assert sess_resp.status_code == 201
        session_a_id = sess_resp.json()["id"]

        # Candidate B registers
        user_b_id, headers_b = await register_and_login(client, "bob.intruder@example.com")
        assert user_a_id != user_b_id

        # 1. User B accesses User A's resume -> 404
        r_get = await client.get(f"/api/v1/resumes/{resume_a_id}", headers=headers_b)
        assert r_get.status_code == 404

        # 2. User B tries to create session with User A's resume -> 404
        s_create_cross = await client.post(
            "/api/v1/sessions",
            json={
                "job_role": "Backend Engineer",
                "target_seniority": "Senior",
                "difficulty": "Hard",
                "resume_id": resume_a_id,
            },
            headers=headers_b,
        )
        assert s_create_cross.status_code == 404

        # 3. User B accesses User A's session -> 404
        s_get = await client.get(f"/api/v1/sessions/{session_a_id}", headers=headers_b)
        assert s_get.status_code == 404

        # 4. User B accesses User A's interview report -> 404
        rep_get = await client.get(f"/api/v1/interview/sessions/{session_a_id}/report", headers=headers_b)
        assert rep_get.status_code == 404

        # 5. User B accesses User A's interview state -> 404
        state_get = await client.get(f"/api/v1/interview/sessions/{session_a_id}/state", headers=headers_b)
        assert state_get.status_code == 404
