import asyncio
import os
from pathlib import Path
import sys
import uuid
import certifi
import httpx
from pymongo import MongoClient

# Ensure backend directory is in sys.path
SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent if SCRIPT_DIR.name == "scripts" else SCRIPT_DIR
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import get_settings


def verify_auth_storage() -> int:
    """
    End-to-end verification that user accounts are stored strictly in MongoDB Atlas auth collection.
    Never prints or logs credentials.
    """
    settings = get_settings()
    host_name = settings.mongodb_host
    db_name = settings.MONGODB_DB_NAME

    print("=================================================================")
    print("MONGODB ATLAS AUTH STORAGE VERIFICATION")
    print("=================================================================")
    print(f"Target Atlas Host: {host_name}")
    print(f"Target Database:   {db_name}")
    print(f"Auth Collection:   auth")

    # 1. Direct Ping to Atlas
    try:
        mongo_uri = settings.get_effective_mongodb_uri()
        client = MongoClient(
            mongo_uri,
            serverSelectionTimeoutMS=8000,
            tlsCAFile=certifi.where(),
        )
        ping_res = client.admin.command("ping")
        if ping_res.get("ok") != 1.0 and ping_res.get("ok") != 1:
            print("FAIL: Atlas ping did not return ok: 1.0", file=sys.stderr)
            return 1
        print("PASS: Successfully connected and pinged MongoDB Atlas.")
    except Exception as exc:
        from app.core.database import get_error_hint
        hint = get_error_hint(exc)
        print(f"FAIL: Could not ping MongoDB Atlas: {type(exc).__name__}", file=sys.stderr)
        print(f"Hint: {hint}", file=sys.stderr)
        try:
            import urllib.request
            ip = urllib.request.urlopen("https://api.ipify.org", timeout=3).read().decode("utf8")
            print(f"Current Public IP: {ip}. Ensure this IP (or 0.0.0.0/0) is in Atlas -> Network Access.", file=sys.stderr)
        except Exception:
            pass
        return 1

    db = client[db_name]
    auth_col = db["auth"]

    # 2. Determine API client (running server vs in-process ASGI app)
    api_base_url = "http://localhost:8000"
    is_live_server = False
    try:
        with httpx.Client(timeout=2.0) as test_c:
            r = test_c.get(f"{api_base_url}/health")
            if r.status_code == 200:
                is_live_server = True
    except Exception:
        is_live_server = False

    test_client = None
    if is_live_server:
        print(f"API Mode: Connected to running server at {api_base_url}")
        http_client = httpx.Client(base_url=api_base_url, timeout=10.0)
    else:
        print("API Mode: Starting in-process ASGI test client with lifespan")
        from starlette.testclient import TestClient
        from app.main import app
        test_client = TestClient(app)
        test_client.__enter__()
        http_client = test_client

    test_email = f"verify_{uuid.uuid4().hex[:8]}@example.com"
    test_password = "SecurePassword123!"
    test_name = "Atlas Storage Proof User"

    try:
        # 3. Register user via API
        print(f"\n1. Registering unique user via API: {test_email}")
        reg_resp = http_client.post(
            "/api/v1/auth/register",
            json={
                "email": test_email,
                "password": test_password,
                "full_name": test_name,
                "role": "candidate",
            },
        )
        if reg_resp.status_code != 201:
            print(f"FAIL: Registration failed with status {reg_resp.status_code}: {reg_resp.text}", file=sys.stderr)
            return 1
        reg_data = reg_resp.json()
        user_id = reg_data.get("id")
        print(f"PASS: User registered via API with ID: {user_id}")

        # 4. Query MongoDB Atlas directly to assert document exists
        print(f"\n2. Querying Atlas {db_name}.auth directly...")
        auth_doc = auth_col.find_one({"email": test_email})
        if not auth_doc:
            print(f"FAIL: Document for {test_email} NOT found in Atlas {db_name}.auth!", file=sys.stderr)
            return 1

        print("PASS: User document found in MongoDB Atlas auth collection.")

        # Assert document schema & invariants
        hashed_pwd = auth_doc.get("hashed_password", "")
        if not hashed_pwd.startswith("$argon2id$"):
            print("FAIL: Password hash does not start with $argon2id$!", file=sys.stderr)
            return 1
        print("PASS: Password is encrypted with Argon2id ($argon2id$ format verified).")

        if auth_doc.get("full_name") != test_name:
            print("FAIL: Full name mismatch in Mongo document!", file=sys.stderr)
            return 1

        # Check legacy users collection does NOT contain this user
        if "users" in db.list_collection_names():
            legacy_doc = db["users"].find_one({"email": test_email})
            if legacy_doc:
                print("FAIL: User document was leaked into legacy 'users' collection!", file=sys.stderr)
                return 1

        # 5. Login via API
        print(f"\n3. Authenticating via API login...")
        login_resp = http_client.post(
            "/api/v1/auth/login",
            json={"email": test_email, "password": test_password},
        )
        if login_resp.status_code != 200:
            print(f"FAIL: Login failed with status {login_resp.status_code}: {login_resp.text}", file=sys.stderr)
            return 1

        token = login_resp.json().get("access_token")
        if not token:
            print("FAIL: Access token missing in login response!", file=sys.stderr)
            return 1
        print("PASS: Successfully authenticated and received JWT access token.")

        # 6. Fetch Profile (/api/v1/auth/me)
        print("\n4. Fetching user profile via GET /api/v1/auth/me...")
        me_resp = http_client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        if me_resp.status_code != 200:
            print(f"FAIL: /me endpoint returned status {me_resp.status_code}: {me_resp.text}", file=sys.stderr)
            return 1

        me_data = me_resp.json()
        if me_data.get("email") != test_email or me_data.get("id") != user_id:
            print(f"FAIL: Profile mismatch on /me: {me_data}", file=sys.stderr)
            return 1
        print(f"PASS: User profile verified: {me_data.get('email')}")

        # 7. Diagnostics check
        print("\n5. Checking GET /health/db diagnostic endpoint...")
        health_resp = http_client.get("/health/db")
        if health_resp.status_code != 200:
            print(f"FAIL: /health/db returned status {health_resp.status_code}", file=sys.stderr)
            return 1
        hdata = health_resp.json()
        if not hdata.get("auth_collection_exists"):
            print("FAIL: auth_collection_exists is False in /health/db!", file=sys.stderr)
            return 1
        print(f"PASS: /health/db confirmed: auth_document_count = {hdata.get('auth_document_count')}")

        # 8. Clean up test document
        print("\n6. Cleaning up test user document from Atlas...")
        del_res = auth_col.delete_one({"email": test_email})
        if del_res.deleted_count != 1:
            print(f"WARNING: Test user deletion count was {del_res.deleted_count}", file=sys.stderr)
        else:
            print("PASS: Test user document deleted successfully from Atlas.")

        print("\n=================================================================")
        print("PASS: auth data is stored in ai-mock-interview.auth")
        print("=================================================================")
        return 0

    finally:
        client.close()
        if test_client is not None:
            test_client.__exit__(None, None, None)
        elif hasattr(http_client, "close"):
            http_client.close()


if __name__ == "__main__":
    sys.exit(verify_auth_storage())
