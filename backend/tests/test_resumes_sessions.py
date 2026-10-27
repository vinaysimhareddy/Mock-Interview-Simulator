import io
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app

# Minimal valid PDF structure with real text stream
VALID_PDF_BYTES = b"""%PDF-1.4
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


@pytest.mark.asyncio
async def test_resumes_and_sessions_flow() -> None:
    """Verify PDF upload, extraction, resume listing, editing, and session creation."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        # 1. Register & login candidate
        reg_payload = {
            "email": "resume.candidate@example.com",
            "full_name": "Jane Candidate",
            "password": "Password123!",
        }
        await client.post("/api/v1/auth/register", json=reg_payload)
        login_resp = await client.post(
            "/api/v1/auth/login",
            json={"email": "resume.candidate@example.com", "password": "Password123!"},
        )
        assert login_resp.status_code == 200
        token = login_resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 2. Reject non-PDF file upload
        bad_file = {"file": ("malicious.exe", b"not a pdf content", "application/octet-stream")}
        bad_resp = await client.post("/api/v1/resumes/upload", headers=headers, files=bad_file)
        assert bad_resp.status_code == 415

        # 2b. Reject image-only PDF with no extractable text
        empty_text_pdf = (
            b"%PDF-1.4\n"
            b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
            b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"
            b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] >> endobj\n"
            b"xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n"
            b"trailer << /Size 4 /Root 1 0 R >>\nstartxref\n190\n%%EOF\n"
        )
        scanned_file = {"file": ("scanned_image.pdf", empty_text_pdf, "application/pdf")}
        scanned_resp = await client.post("/api/v1/resumes/upload", headers=headers, files=scanned_file)
        assert scanned_resp.status_code == 422
        assert "no extractable text" in scanned_resp.json()["detail"].lower()

        # 3. Upload valid PDF resume
        pdf_file = {"file": ("jane_resume.pdf", VALID_PDF_BYTES, "application/pdf")}
        upload_resp = await client.post("/api/v1/resumes/upload", headers=headers, files=pdf_file)
        assert upload_resp.status_code == 201
        resume_data = upload_resp.json()
        assert "id" in resume_data
        assert resume_data["filename"] == "jane_resume.pdf"
        assert len(resume_data["raw_text"]) > 0
        assert "Python" in resume_data["parsed_data"]["skills"]
        assert "Docker" in resume_data["parsed_data"]["skills"]
        resume_id = resume_data["id"]

        # 4. List resumes
        list_resp = await client.get("/api/v1/resumes", headers=headers)
        assert list_resp.status_code == 200
        resumes = list_resp.json()
        assert len(resumes) >= 1
        assert any(r["id"] == resume_id for r in resumes)

        # 5. Get single resume by ID
        get_resp = await client.get(f"/api/v1/resumes/{resume_id}", headers=headers)
        assert get_resp.status_code == 200
        assert get_resp.json()["id"] == resume_id

        # 6. Update candidate skills
        patch_resp = await client.patch(
            f"/api/v1/resumes/{resume_id}",
            headers=headers,
            json={"skills": ["Python", "TypeScript", "React", "Docker", "FastAPI", "Go"]},
        )
        assert patch_resp.status_code == 200
        assert "Go" in patch_resp.json()["parsed_data"]["skills"]

        # 7. Create interview session
        session_payload = {
            "resume_id": resume_id,
            "role": "Senior Full Stack Engineer",
            "seniority": "Senior",
            "difficulty": "Adaptive",
        }
        session_resp = await client.post("/api/v1/sessions", headers=headers, json=session_payload)
        assert session_resp.status_code == 201
        session_data = session_resp.json()
        assert "id" in session_data
        assert session_data["status"] == "CREATED"
        assert session_data["role"] == "Senior Full Stack Engineer"
        assert session_data["seniority"] == "Senior"
        assert session_data["difficulty"] == "Adaptive"
        session_id = session_data["id"]

        # 8. Retrieve created session
        get_sess = await client.get(f"/api/v1/sessions/{session_id}", headers=headers)
        assert get_sess.status_code == 200
        assert get_sess.json()["id"] == session_id
        assert get_sess.json()["status"] == "CREATED"

        # 9. List sessions
        list_sess = await client.get("/api/v1/sessions", headers=headers)
        assert list_sess.status_code == 200
        assert any(s["id"] == session_id for s in list_sess.json())
