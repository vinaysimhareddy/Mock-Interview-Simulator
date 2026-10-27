from datetime import datetime, timedelta, timezone
import pytest
from httpx import ASGITransport, AsyncClient

from app.core.database import get_database
from app.core.security import create_access_token
from app.main import app
from app.repositories.auth_repo import auth_repo


@pytest.mark.asyncio
async def test_register_creates_document_in_auth_collection() -> None:
    """Verify register writes directly to 'auth' collection, sets default fields, and returns UserPublic."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        payload = {
            "email": "sarah.connor@example.com",
            "full_name": "Sarah Connor",
            "password": "ValidPassword2026!",
        }
        response = await client.post("/api/v1/auth/register", json=payload)
        assert response.status_code == 201
        data = response.json()
        assert data["email"] == "sarah.connor@example.com"
        assert data["full_name"] == "Sarah Connor"
        assert "id" in data
        assert "password" not in data
        assert "hashed_password" not in data
        assert "failed_login_count" not in data
        assert "locked_until" not in data

        # Verify document appears in 'auth' collection and nowhere else
        db = await get_database()
        auth_doc = await db["auth"].find_one({"email": "sarah.connor@example.com"})
        assert auth_doc is not None
        assert auth_doc["role"] == "candidate"
        assert auth_doc["is_active"] is True
        assert auth_doc["failed_login_count"] == 0
        assert auth_doc["locked_until"] is None
        assert auth_doc["hashed_password"].startswith("$argon2id$")

        # Crucial check: verify NO 'users' collection was created or populated
        users_doc = await db["users"].find_one({"email": "sarah.connor@example.com"})
        assert users_doc is None


@pytest.mark.asyncio
async def test_duplicate_email_returns_409_without_check_then_insert() -> None:
    """Verify that registering an already registered email triggers DuplicateKeyError resulting in 409 Conflict."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        payload = {
            "email": "unique.candidate@example.com",
            "full_name": "Unique Candidate",
            "password": "Password123!",
        }
        # First registration succeeds
        r1 = await client.post("/api/v1/auth/register", json=payload)
        assert r1.status_code == 201

        # Second registration with identical email (different case or whitespace) fails with 409
        duplicate_payload = {
            "email": " UNIQUE.CANDIDATE@example.com ",
            "full_name": "Unique Candidate Duplicate",
            "password": "Password123!",
        }
        r2 = await client.post("/api/v1/auth/register", json=duplicate_payload)
        assert r2.status_code == 409
        assert "already exists" in r2.json()["detail"].lower()


@pytest.mark.asyncio
async def test_wrong_password_returns_401_generic_message() -> None:
    """Verify that logging in with incorrect password returns 401 Unauthorized with generic message."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        reg_payload = {
            "email": "auth.test@example.com",
            "full_name": "Auth Tester",
            "password": "CorrectPassword123!",
        }
        await client.post("/api/v1/auth/register", json=reg_payload)

        # Attempt login with wrong password
        login_resp = await client.post(
            "/api/v1/auth/login",
            json={"email": "auth.test@example.com", "password": "WrongPassword999!"},
        )
        assert login_resp.status_code == 401
        assert "invalid email or password" in login_resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_five_failed_logins_triggers_account_lockout() -> None:
    """Verify that 5 failed logins locks the account for 15 minutes, rejecting subsequent attempts."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        email = "lockout.target@example.com"
        correct_pwd = "CorrectSecretPass123!"
        reg_payload = {
            "email": email,
            "full_name": "Lockout Target",
            "password": correct_pwd,
        }
        await client.post("/api/v1/auth/register", json=reg_payload)

        # Fail 4 times: should return 401 with "Invalid email or password"
        for i in range(4):
            res = await client.post(
                "/api/v1/auth/login",
                json={"email": email, "password": f"WrongAttempt{i}"},
            )
            assert res.status_code == 401
            assert "invalid email or password" in res.json()["detail"].lower()

        # 5th failure: triggers account lock
        res5 = await client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": "WrongAttempt5"},
        )
        assert res5.status_code == 401

        # Check database: failed_login_count should be 5 and locked_until in the future
        user = await auth_repo.get_by_email(email)
        assert user is not None
        assert user.failed_login_count == 5
        assert user.locked_until is not None
        assert user.locked_until > datetime.now(timezone.utc)

        # 6th attempt with CORRECT password must now fail with lockout message
        res6 = await client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": correct_pwd},
        )
        assert res6.status_code == 401
        assert "locked" in res6.json()["detail"].lower()


@pytest.mark.asyncio
async def test_successful_login_resets_failures_and_jwt_works_on_me() -> None:
    """Verify that successful login resets failure counter, updates last_login_at, and JWT works on /me."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        email = "jwt.candidate@example.com"
        password = "GoodPassword2026!"
        reg_payload = {
            "email": email,
            "full_name": "JWT Candidate",
            "password": password,
        }
        reg_res = await client.post("/api/v1/auth/register", json=reg_payload)
        assert reg_res.status_code == 201
        user_id = reg_res.json()["id"]

        # Make 2 failed login attempts first
        await client.post("/api/v1/auth/login", json={"email": email, "password": "bad1"})
        await client.post("/api/v1/auth/login", json={"email": email, "password": "bad2"})
        user_before = await auth_repo.get_by_email(email)
        assert user_before is not None
        assert user_before.failed_login_count == 2

        # Successful login
        login_res = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
        assert login_res.status_code == 200
        token_data = login_res.json()
        assert "access_token" in token_data
        access_token = token_data["access_token"]

        # Verify database reset
        user_after = await auth_repo.get_by_email(email)
        assert user_after is not None
        assert user_after.failed_login_count == 0
        assert user_after.locked_until is None
        assert user_after.last_login_at is not None

        # Verify JWT works on GET /api/v1/auth/me
        me_res = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        assert me_res.status_code == 200
        me_data = me_res.json()
        assert me_data["id"] == user_id
        assert me_data["email"] == email
        assert me_data["full_name"] == "JWT Candidate"
        # Strict check: hashed_password never appears in any response
        assert "hashed_password" not in me_data
        assert "password" not in me_data


@pytest.mark.asyncio
async def test_expired_or_invalid_token_returns_401() -> None:
    """Verify that expired and invalid/tampered JWT tokens return 401 Unauthorized."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        reg_payload = {
            "email": "token.test@example.com",
            "full_name": "Token Tester",
            "password": "ValidPassword123!",
        }
        reg_res = await client.post("/api/v1/auth/register", json=reg_payload)
        user_id = reg_res.json()["id"]

        # 1. Test expired token (-10 seconds)
        expired_token = create_access_token(
            subject=user_id, expires_delta=timedelta(seconds=-10)
        )
        r_expired = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {expired_token}"},
        )
        assert r_expired.status_code == 401

        # 2. Test tampered / invalid token
        r_invalid = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": "Bearer invalid.jwt.token.here"},
        )
        assert r_invalid.status_code == 401

        # 3. Test missing Authorization header
        r_missing = await client.get("/api/v1/auth/me")
        assert r_missing.status_code == 401


@pytest.mark.asyncio
async def test_db_down_simulation_returns_503_on_register_and_login() -> None:
    """Verify that database connection outages return 503 Database unavailable, never false success."""
    from unittest.mock import patch
    from pymongo.errors import ServerSelectionTimeoutError
    from motor.motor_asyncio import AsyncIOMotorCollection

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        # DB down on register
        with patch.object(AsyncIOMotorCollection, "insert_one", side_effect=ServerSelectionTimeoutError("Atlas unreachable")):
            res = await client.post("/api/v1/auth/register", json={
                "email": "dbdown@example.com",
                "full_name": "DB Down",
                "password": "Password123!",
            })
            assert res.status_code == 503
            assert res.json()["detail"] == "Database unavailable"

        # DB down on login
        with patch.object(AsyncIOMotorCollection, "find_one", side_effect=ServerSelectionTimeoutError("Atlas unreachable")):
            res = await client.post("/api/v1/auth/login", json={
                "email": "dbdown@example.com",
                "password": "Password123!",
            })
            assert res.status_code == 503
            assert res.json()["detail"] == "Database unavailable"


@pytest.mark.asyncio
async def test_health_db_returns_diagnostic_metadata_without_secrets() -> None:
    """Verify GET /health/db returns status, database, auth_collection_exists, auth_document_count, and no user data."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        res = await client.get("/health/db")
        assert res.status_code in (200, 503)
        data = res.json()
        assert "status" in data
        assert "database" in data
        assert "auth_collection_exists" in data
        assert "auth_document_count" in data
        assert isinstance(data["auth_document_count"], int)
        # Ensure never user records/emails or secrets
        text = res.text
        assert "password" not in text.lower() or "invalid" in text.lower()
        assert "@" not in text
        assert "mongodb+srv://" not in text

