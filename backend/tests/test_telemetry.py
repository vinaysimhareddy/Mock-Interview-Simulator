from datetime import datetime, timezone
import pytest
from fastapi import WebSocketDisconnect, status
from httpx import ASGITransport, AsyncClient
from starlette.testclient import TestClient

from app.core.database import get_database
from app.main import app


@pytest.mark.asyncio
async def test_telemetry_websocket_streaming_and_bucketing() -> None:
    """Verify WebSocket authentication, real-time packet transmission, and MongoDB time-bucketing."""
    # 1. Register candidate and create session via AsyncClient
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        reg_payload = {
            "email": "telemetry.user@example.com",
            "full_name": "Telemetry Tester",
            "password": "Password123!",
        }
        await client.post("/api/v1/auth/register", json=reg_payload)
        login_resp = await client.post(
            "/api/v1/auth/login",
            json={"email": "telemetry.user@example.com", "password": "Password123!"},
        )
        assert login_resp.status_code == 200
        token = login_resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Create interview session
        session_payload = {
            "role": "Computer Vision Engineer",
            "seniority": "Senior",
            "difficulty": "Adaptive",
        }
        sess_resp = await client.post("/api/v1/sessions", headers=headers, json=session_payload)
        assert sess_resp.status_code == 201
        session_id = sess_resp.json()["id"]

    # 2. Test WebSocket streaming via synchronous TestClient
    sync_client = TestClient(app)

    # A. Invalid token rejected with code 4008
    with pytest.raises(WebSocketDisconnect) as excinfo:
        with sync_client.websocket_connect(
            f"/api/v1/ws/interview/{session_id}?token=invalid_token"
        ):
            pass
    assert excinfo.value.code == 4008

    # B. Authenticated connection established
    ws_url = f"/api/v1/ws/interview/{session_id}?token={token}"
    with sync_client.websocket_connect(ws_url) as websocket:
        init_data = websocket.receive_json()
        assert init_data["type"] == "session_ready"
        assert init_data["session_id"] == session_id

        # 3. Stream telemetry packets
        for i in range(5):
            packet_data = {
                "type": "telemetry",
                "t": i,
                "eye_contact_ratio": 0.85 + (i * 0.01),
                "posture_score": 0.90,
                "head_pose": {
                    "pitch": 1.2,
                    "yaw": -0.8,
                    "roll": 0.3,
                },
                "expression": {
                    "smile": 0.2,
                    "brow_furrow": 0.1,
                    "mouth_open": 0.05,
                },
                "distraction_flags": [],
                "face_present": True,
                "fps": 30,
                "integrity": {
                    "camera_label_hash": "sha256_camera_label",
                    "device_id_hash": "sha256_device_id",
                    "track_state": "live",
                    "resolution": "1280x720",
                    "measured_fps": 30.0,
                    "frame_diff_mean": 0.03,
                    "landmark_jitter": 0.004,
                    "luminance_mean": 115.0,
                    "faces_detected": 1,
                    "flags": [],
                    "seq": i,
                },
            }
            websocket.send_json(packet_data)
            ack = websocket.receive_json()
            assert ack["type"] == "ack"
            assert ack["received_type"] == "telemetry"
            assert ack["t"] == i

        # 4. Graceful disconnect with interview completion to force flush telemetry buffer
        websocket.send_json({"type": "end_interview"})
        comp_msg = websocket.receive_json()
        assert comp_msg["type"] == "interview_complete"

    # 5. Verify MongoDB telemetry_samples bucket
    db = await get_database()
    bucket_doc = await db["telemetry_samples"].find_one({"session_id": session_id})
    assert bucket_doc is not None
    assert bucket_doc["sample_count"] == 5
    assert len(bucket_doc["samples"]) == 5

