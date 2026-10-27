import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_health_check_returns_ok() -> None:
    """Verify that GET /health responds with 200 OK and status 'ok'."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_v1_ping_returns_pong() -> None:
    """Verify that GET /api/v1/ping responds with 200 OK and ping 'pong'."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.get("/api/v1/ping")
        assert response.status_code == 200
        assert response.json() == {"ping": "pong"}


@pytest.mark.asyncio
async def test_health_db_returns_ok_or_503() -> None:
    """Verify that GET /health/db returns 200 or 503 without ever leaking the URI."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.get("/health/db")
        assert response.status_code in (200, 503)
        data = response.json()
        assert "database" in data
        assert data["database"] == "ai-mock-interview"

        # Security check: Ensure raw URI or credentials never leak in response
        raw_text = response.text
        assert "mongodb+srv://" not in raw_text
        assert "@" not in raw_text
        assert "password" not in raw_text.lower() or "invalid" in raw_text.lower()

        if response.status_code == 200:
            assert data["status"] == "ok"
            assert "latency_ms" in data
            assert isinstance(data["latency_ms"], (int, float))
            assert "auth_collection_exists" in data
            assert "auth_document_count" in data
            assert isinstance(data["auth_document_count"], int)
        else:
            assert data["status"] == "error"
            assert "message" in data
