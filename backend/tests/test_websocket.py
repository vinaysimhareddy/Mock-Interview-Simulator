import uuid
from datetime import datetime, timezone
import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.core.database import get_database
from app.core.security import create_access_token
from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


async def setup_test_user_and_session(
    user_email: str,
    integrity_mode: str = "advisory",
) -> tuple[str, str, str]:
    """Helper to provision a test user and interview session directly in DB."""
    db = await get_database()
    user_id = str(uuid.uuid4())
    session_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    user_doc = {
        "_id": user_id,
        "id": user_id,
        "email": user_email.strip().lower(),
        "full_name": "Test Candidate",
        "hashed_password": "dummy_hash_argon2",
        "is_active": True,
        "is_email_verified": False,
        "failed_login_count": 0,
        "locked_until": None,
        "last_login_at": None,
        "settings": {},
        "created_at": now,
        "updated_at": now,
        "role": "candidate",
    }
    await db["auth"].insert_one(user_doc)

    session_doc = {
        "_id": session_id,
        "id": session_id,
        "user_id": user_id,
        "job_role": "Backend Engineer",
        "target_seniority": "Senior",
        "integrity_mode": integrity_mode,
        "session_status": "created",
        "transcript": [],
        "video_telemetry_time_series": [],
        "created_at": now,
    }
    await db["interview_sessions"].insert_one(session_doc)

    token = create_access_token(subject=user_id)
    return user_id, session_id, token


def test_ws_bad_token_rejected_4008(client: TestClient) -> None:
    """Verify that connecting with an invalid/tampered token closes connection with code 4008."""
    fake_session_id = str(uuid.uuid4())
    url = f"/api/v1/ws/interview/{fake_session_id}?token=bad.jwt.token"

    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect(url):
            pass

    assert exc_info.value.code == 4008


@pytest.mark.asyncio
async def test_ws_user_not_in_auth_rejected_4008(client: TestClient) -> None:
    """Verify that a token whose subject is missing from 'auth' collection is rejected with 4008."""
    nonexistent_user_id = str(uuid.uuid4())
    token = create_access_token(subject=nonexistent_user_id)
    fake_session_id = str(uuid.uuid4())
    url = f"/api/v1/ws/interview/{fake_session_id}?token={token}"

    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect(url):
            pass

    assert exc_info.value.code == 4008


@pytest.mark.asyncio
async def test_ws_wrong_user_rejected_4008(client: TestClient) -> None:
    """Verify that connecting with a valid token for the wrong user closes with code 4008."""
    # User A owns Session A
    _, session_a_id, _ = await setup_test_user_and_session("owner.user@example.com")

    # User B is in auth and generates their own valid token
    _, _, token_b = await setup_test_user_and_session("user.b@example.com")

    # User B attempts to connect to Session A
    url = f"/api/v1/ws/interview/{session_a_id}?token={token_b}"
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect(url):
            pass

    assert exc_info.value.code == 4008


@pytest.mark.asyncio
async def test_ws_valid_flow_echoes_session_ready_and_acks(client: TestClient) -> None:
    """Verify that a valid token and session owner handshake emits session_ready and acks telemetry."""
    user_id, session_id, token = await setup_test_user_and_session("valid.user@example.com")
    url = f"/api/v1/ws/interview/{session_id}?token={token}"

    with client.websocket_connect(url) as websocket:
        # 1. Server emits session_ready immediately on accept
        ready_msg = websocket.receive_json()
        assert ready_msg["type"] == "session_ready"
        assert ready_msg["session_id"] == session_id

        # 2. Client sends ping -> server responds with pong
        websocket.send_json({"type": "ping", "timestamp": 12345.67})
        pong_msg = websocket.receive_json()
        assert pong_msg["type"] == "pong"
        assert pong_msg["timestamp"] == 12345.67

        # 3. Client sends 1 Hz telemetry sample
        telemetry_sample = {
            "type": "telemetry",
            "t": 12,
            "eye_contact_ratio": 0.82,
            "posture_score": 0.74,
            "head_pose": {"yaw": -4.2, "pitch": 3.1, "roll": 0.8},
            "expression": {"smile": 0.31, "brow_furrow": 0.12, "mouth_open": 0.05},
            "distraction_flags": ["looked_away"],
            "face_present": True,
            "fps": 29,
        }
        websocket.send_json(telemetry_sample)
        ack_msg = websocket.receive_json()
        assert ack_msg["type"] == "ack"
        assert ack_msg["received_type"] == "telemetry"
        assert ack_msg["t"] == 12


@pytest.mark.asyncio
async def test_ws_invalid_payload_returns_error_not_crash(client: TestClient) -> None:
    """Verify that unknown message types return error without crashing the connection."""
    _, session_id, token = await setup_test_user_and_session("error.user@example.com")
    url = f"/api/v1/ws/interview/{session_id}?token={token}"

    with client.websocket_connect(url) as websocket:
        # Consume initial session_ready
        init_msg = websocket.receive_json()
        assert init_msg["type"] == "session_ready"

        # Send invalid/unknown message type
        bad_payload = {"type": "unknown_action", "payload": "random data"}
        websocket.send_json(bad_payload)

        # Server returns structured error message rather than crashing
        err_msg = websocket.receive_json()
        assert err_msg["type"] == "error"
        assert err_msg["code"] == "INVALID_PAYLOAD"

        # Subsequent valid message succeeds on the still-open connection
        websocket.send_json({"type": "ping", "timestamp": 999.0})
        pong_msg = websocket.receive_json()
        assert pong_msg["type"] == "pong"


@pytest.mark.asyncio
async def test_ws_strict_mode_rejects_unsigned_telemetry(client: TestClient) -> None:
    """Verify that in strict mode, telemetry lacking signed integrity metadata is rejected with INTEGRITY_VIOLATION."""
    _, session_id, token = await setup_test_user_and_session(
        "strict.user@example.com", integrity_mode="strict"
    )
    url = f"/api/v1/ws/interview/{session_id}?token={token}"

    with client.websocket_connect(url) as websocket:
        init_msg = websocket.receive_json()
        assert init_msg["type"] == "session_ready"

        # Send telemetry without integrity field
        unsigned_telemetry = {
            "type": "telemetry",
            "t": 1.0,
            "eye_contact_ratio": 0.85,
            "posture_score": 0.80,
            "head_pose": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0},
            "expression": {"smile": 0.0, "brow_furrow": 0.0, "mouth_open": 0.0},
            "distraction_flags": [],
            "face_present": True,
            "fps": 30,
        }
        websocket.send_json(unsigned_telemetry)
        err_msg = websocket.receive_json()
        assert err_msg["type"] == "error"
        assert err_msg["code"] == "INTEGRITY_VIOLATION"
        assert "integrity fields are required" in err_msg["message"].lower()

        # Send telemetry WITH integrity field -> receives ack
        signed_telemetry = {
            **unsigned_telemetry,
            "t": 2.0,
            "integrity": {
                "camera_label_hash": "sha256_mock_label",
                "device_id_hash": "sha256_mock_device",
                "track_state": "live",
                "resolution": "1280x720",
                "measured_fps": 30.0,
                "frame_diff_mean": 0.02,
                "landmark_jitter": 0.005,
                "luminance_mean": 120.0,
                "faces_detected": 1,
                "flags": [],
                "seq": 1,
            },
        }
        websocket.send_json(signed_telemetry)
        ack_msg = websocket.receive_json()
        assert ack_msg["type"] == "ack"
        assert ack_msg["received_type"] == "telemetry"
        assert ack_msg["t"] == 2.0

