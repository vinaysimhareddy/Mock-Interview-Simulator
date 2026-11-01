from unittest.mock import AsyncMock, patch
import pytest
from bson import ObjectId
from httpx import ASGITransport, AsyncClient

from app.core.database import get_database
from app.main import app
from app.models.resume import ParsedProfile, WorkHistoryItem

# Minimal valid PDF bytes with valid structure and extractable text stream
SAMPLE_PDF_BYTES = b"""%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 110 >> stream
BT
/F1 12 Tf
20 160 Td
(Jane Candidate - Senior Full Stack Engineer) Tj
0 -25 Td
(Skills: Python TypeScript React Docker FastAPI PostgreSQL Kubernetes) Tj
ET
endstream
endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000236 00000 n 
0000000397 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
468
%%EOF
"""

MOCK_PARSED_PROFILE = ParsedProfile(
    technical_skills=["Python", "FastAPI", "React", "Docker", "PostgreSQL"],
    experience_years=5.5,
    work_history=[
        WorkHistoryItem(
            company="Tech Innovations Corp",
            title="Senior Backend Engineer",
            start="2021",
            end="Present",
            highlights=[
                "Architected high-throughput asynchronous microservices with FastAPI",
                "Optimized MongoDB aggregations and caching layers",
            ],
        )
    ],
)


async def create_authenticated_candidate(
    client: AsyncClient, email: str
) -> dict[str, str]:
    """Helper creating a test user and returning Bearer auth headers."""
    reg_payload = {
        "email": email,
        "full_name": "Test Candidate",
        "password": "Password123!",
    }
    await client.post("/api/v1/auth/register", json=reg_payload)
    login_resp = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "Password123!"},
    )
    token = login_resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_upload_sample_pdf_parsed_profile_saved() -> None:
    """Verify that uploading a valid PDF parses the profile, persists to DB, and returns 201."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        headers = await create_authenticated_candidate(client, "alice.pdf@example.com")

        with patch(
            "app.api.v1.endpoints.resumes.parse_resume_profile",
            new=AsyncMock(return_value=MOCK_PARSED_PROFILE),
        ):
            files = {
                "file": ("resume.pdf", SAMPLE_PDF_BYTES, "application/pdf")
            }
            response = await client.post(
                "/api/v1/resumes/upload", files=files, headers=headers
            )
            assert response.status_code == 201
            data = response.json()
            assert "id" in data
            assert data["filename"] == "resume.pdf"
            assert "Jane Candidate" in data["raw_text"]
            assert data["parsed_profile"]["technical_skills"] == [
                "Python", "FastAPI", "React", "Docker", "PostgreSQL"
            ]
            assert data["parsed_profile"]["experience_years"] == 5.5
            resume_id = data["id"]

            # Verify persisted in database
            db = await get_database()
            saved_doc = await db["resumes"].find_one({"$or": [{"_id": ObjectId(resume_id)}, {"_id": resume_id}, {"id": resume_id}]})
            assert saved_doc is not None
            assert saved_doc["parsed_profile"]["experience_years"] == 5.5

            # Verify GET /api/v1/resumes lists this resume
            list_resp = await client.get("/api/v1/resumes", headers=headers)
            assert list_resp.status_code == 200
            resumes = list_resp.json()
            assert any(r["id"] == resume_id for r in resumes)

            # Verify GET /api/v1/resumes/{id} retrieves the single resume
            get_resp = await client.get(f"/api/v1/resumes/{resume_id}", headers=headers)
            assert get_resp.status_code == 200
            assert get_resp.json()["id"] == resume_id


@pytest.mark.asyncio
async def test_upload_non_pdf_returns_415() -> None:
    """Verify that non-PDF content type or invalid magic bytes returns 415 Unsupported Media Type."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        headers = await create_authenticated_candidate(client, "bob.nonpdf@example.com")

        # 1. Invalid content type header
        bad_mime_files = {
            "file": ("script.sh", b"#!/bin/bash\necho hello", "text/x-sh")
        }
        r1 = await client.post(
            "/api/v1/resumes/upload", files=bad_mime_files, headers=headers
        )
        assert r1.status_code == 415
        assert "unsupported media type" in r1.json()["detail"].lower()

        # 2. Content-type says PDF, but magic bytes are not %PDF
        bad_magic_files = {
            "file": ("fake.pdf", b"NOT_A_PDF_MAGIC_BYTES_HERE", "application/pdf")
        }
        r2 = await client.post(
            "/api/v1/resumes/upload", files=bad_magic_files, headers=headers
        )
        assert r2.status_code == 415
        assert "magic bytes" in r2.json()["detail"].lower()


@pytest.mark.asyncio
async def test_upload_oversize_returns_413() -> None:
    """Verify that uploaded files exceeding MAX_UPLOAD_MB (5 MB) return 413 Payload Too Large."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        headers = await create_authenticated_candidate(client, "carol.large@example.com")

        # Create oversized payload exceeding 5 MB (5 * 1024 * 1024 + 1024 bytes) with %PDF header
        oversized_bytes = b"%PDF-1.4 " + (b"0" * (5 * 1024 * 1024 + 512))
        files = {
            "file": ("large_resume.pdf", oversized_bytes, "application/pdf")
        }
        response = await client.post(
            "/api/v1/resumes/upload", files=files, headers=headers
        )
        assert response.status_code == 413
        assert "maximum permitted size" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_upload_llm_failure_returns_502_and_no_partial_save() -> None:
    """Verify that when the LLM service fails, 502 Bad Gateway is returned with no partial DB save."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        headers = await create_authenticated_candidate(client, "dave.fail@example.com")
        db = await get_database()
        count_before = len(await db["resumes"].find({"email": "dave.fail@example.com"}).to_list(100))

        # Mock parse_resume_profile to raise AIServiceError simulating LLM exhaustion
        from app.services.ai_engine import AIServiceError

        with patch(
            "app.api.v1.endpoints.resumes.parse_resume_profile",
            new=AsyncMock(side_effect=AIServiceError("Simulated LLM rate limit exhaustion")),
        ):
            files = {
                "file": ("resume.pdf", SAMPLE_PDF_BYTES, "application/pdf")
            }
            response = await client.post(
                "/api/v1/resumes/upload", files=files, headers=headers
            )
            assert response.status_code == 502
            assert "ai resume parsing service failed" in response.json()["detail"].lower()

            # Verify no partial save was inserted into MongoDB
            count_after = len(await db["resumes"].find({"email": "dave.fail@example.com"}).to_list(100))
            assert count_after == count_before


@pytest.mark.asyncio
async def test_resume_ownership_enforcement() -> None:
    """Verify that users cannot retrieve resumes uploaded by other users (returns 404)."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        # Candidate 1 uploads resume
        headers_user1 = await create_authenticated_candidate(client, "user1@example.com")
        with patch(
            "app.api.v1.endpoints.resumes.parse_resume_profile",
            new=AsyncMock(return_value=MOCK_PARSED_PROFILE),
        ):
            files = {"file": ("resume.pdf", SAMPLE_PDF_BYTES, "application/pdf")}
            up_resp = await client.post(
                "/api/v1/resumes/upload", files=files, headers=headers_user1
            )
            resume_id = up_resp.json()["id"]

        # Candidate 2 attempts to fetch Candidate 1's resume
        headers_user2 = await create_authenticated_candidate(client, "user2@example.com")
        get_resp = await client.get(f"/api/v1/resumes/{resume_id}", headers=headers_user2)
        assert get_resp.status_code == 404
        assert "not found" in get_resp.json()["detail"].lower()
