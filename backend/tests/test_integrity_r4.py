"""R4 Verification Tests: Signed Integrity Telemetry, Server Plausibility, and Policy Engine (§5)."""

import time
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.core.security import create_access_token
from app.services.integrity_service import (
    HMACManager,
    PlausibilityChecker,
    IntegrityScorer,
    PolicyEngine,
    PolicyActionType,
)


def test_hmac_signature_generation_and_verification():
    hmac_mgr = HMACManager()
    key = hmac_mgr.get_active_key()
    t = 12.500
    seq = 42
    label_hash = "sha256_mock_label"
    device_id_hash = "sha256_mock_device"
    fps = 29.8

    sig = HMACManager.compute_signature(key, t, seq, label_hash, device_id_hash, fps)
    assert sig is not None and len(sig) == 64

    # Valid signature passes
    assert hmac_mgr.verify_signature(sig, t, seq, label_hash, device_id_hash, fps) is True

    # Tampered seq fails
    assert hmac_mgr.verify_signature(sig, t, seq + 1, label_hash, device_id_hash, fps) is False

    # Tampered timestamp fails
    assert hmac_mgr.verify_signature(sig, t + 1.0, seq, label_hash, device_id_hash, fps) is False

    # Bad key fails
    assert hmac_mgr.verify_signature("bad_sig_hex" + "0" * 53, t, seq, label_hash, device_id_hash, fps) is False


def test_plausibility_checker_detects_identical_streams():
    checker = PlausibilityChecker()

    # Feed 10 identical packets
    violations = []
    base_time = 100.0
    for i in range(12):
        now = base_time + i * 1.0
        sample = {
            "t": now,
            "eye_contact_ratio": 0.8500,
            "posture_score": 0.9000,
            "head_pose": {"yaw": 1.250, "pitch": -0.500, "roll": 0.0},
            "expression": {"mouth_open": 0.0},
            "integrity": {"measured_fps": 30.0, "landmark_jitter": 0.005},
        }
        res = checker.check_telemetry(sample)
        violations.extend(res)

    assert "plausibility_violation" in violations


def test_plausibility_checker_detects_zero_landmark_jitter():
    checker = PlausibilityChecker()
    sample = {
        "t": 1.0,
        "eye_contact_ratio": 0.8,
        "posture_score": 0.8,
        "head_pose": {"yaw": 0, "pitch": 0, "roll": 0},
        "integrity": {"landmark_jitter": 0.0},  # Suspiciously zero jitter
    }
    violations = checker.check_telemetry(sample)
    assert "plausibility_violation" in violations


def test_plausibility_checker_detects_lip_audio_mismatch():
    checker = PlausibilityChecker()

    # Candidate speaks at t=10.0
    checker.record_speech(10.0)

    # Telemetry continues with closed mouth for > 4 seconds
    violations = []
    for step in range(5):
        t = 10.5 + step * 1.0
        checker.record_speech(t)  # continuous speech
        sample = {
            "t": t,
            "expression": {"mouth_open": 0.01},  # mouth not moving
            "integrity": {},
        }
        violations.extend(checker.check_telemetry(sample))

    assert "lip_audio_mismatch" in violations


def test_integrity_score_calculation_deterministic():
    scorer = IntegrityScorer()
    assert scorer.compute_score() == 100.0

    # Soft flag reduces by 5
    scorer.record_event("no_blink", confidence=1.0)
    assert scorer.compute_score() == 95.0

    # Hardware loss reduces by 20
    scorer.record_event("camera_covered", confidence=1.0)
    assert scorer.compute_score() == 75.0

    # Fraud flag reduces by 30
    scorer.record_event("static_feed", confidence=1.0)
    assert scorer.compute_score() == 45.0

    # Score cannot drop below 0
    scorer.record_event("loop_suspected", confidence=1.0)
    scorer.record_event("screen_replay_suspected", confidence=1.0)
    assert scorer.compute_score() == 0.0


def test_policy_engine_hardware_loss_pause():
    engine = PolicyEngine(mode="strict")
    now = 100.0

    decision = engine.evaluate(["camera_covered"], current_time=now)
    assert decision.action == PolicyActionType.PAUSE
    assert "Camera lost" in decision.reason
    assert decision.grace_seconds == 30.0

    # Feed restored
    resume_decision = engine.evaluate([], current_time=now + 5.0)
    assert resume_decision.action == PolicyActionType.OK

    # If lost for > 30s, aborts
    engine.evaluate(["face_missing"], current_time=now)
    abort_decision = engine.evaluate(["face_missing"], current_time=now + 31.0)
    assert abort_decision.action == PolicyActionType.ABORT


def test_policy_engine_fraud_flags_trigger_challenge():
    engine = PolicyEngine(mode="strict")
    decision = engine.evaluate(["static_feed"], current_time=100.0)
    assert decision.action == PolicyActionType.CHALLENGE
    assert decision.challenge_action is not None

    # Failed challenge allows one retry then aborts
    retry_dec = engine.handle_challenge_result(passed=False)
    assert retry_dec.action == PolicyActionType.CHALLENGE

    final_abort = engine.handle_challenge_result(passed=False)
    assert final_abort.action == PolicyActionType.ABORT


def test_policy_engine_advisory_mode_never_aborts():
    engine = PolicyEngine(mode="advisory")
    decision = engine.evaluate(["loop_suspected"], current_time=100.0)
    assert decision.action == PolicyActionType.WARNING

    fail_dec = engine.handle_challenge_result(passed=False)
    assert fail_dec.action != PolicyActionType.ABORT


from tests.test_websocket import setup_test_user_and_session


@pytest.mark.asyncio
async def test_ws_strict_mode_rejects_replayed_sequence():
    """Verify that incoming sequence numbers <= last_seq are rejected in strict mode."""
    user_id, session_id, token = await setup_test_user_and_session(
        "replay_test@example.com", integrity_mode="strict"
    )

    from fastapi.testclient import TestClient
    with TestClient(app).websocket_connect(f"/api/v1/ws/interview/{session_id}?token={token}") as ws:
        ready = ws.receive_json()
        assert ready["type"] == "session_ready"
        assert "hmac_key" in ready
        assert "session_salt" in ready

        # 1. Send seq=10
        ws.send_json({
            "type": "telemetry",
            "t": 1.0,
            "eye_contact_ratio": 0.8,
            "posture_score": 0.8,
            "head_pose": {"yaw": 0, "pitch": 0, "roll": 0},
            "integrity": {
                "seq": 10,
                "camera_label_hash": "label_hash",
                "device_id_hash": "device_hash",
                "measured_fps": 30.0,
            },
        })
        ack = ws.receive_json()
        assert ack["type"] == "ack"

        # 2. Replay seq=10 (should be rejected)
        ws.send_json({
            "type": "telemetry",
            "t": 2.0,
            "eye_contact_ratio": 0.8,
            "posture_score": 0.8,
            "head_pose": {"yaw": 0, "pitch": 0, "roll": 0},
            "integrity": {
                "seq": 10,
                "camera_label_hash": "label_hash",
                "device_id_hash": "device_hash",
                "measured_fps": 30.0,
            },
        })
        err = ws.receive_json()
        assert err["type"] == "error"
        assert err["code"] == "REPLAYED_SEQUENCE"


@pytest.mark.asyncio
async def test_ws_strict_mode_rejects_bad_hmac():
    """Verify that telemetry packets with invalid HMAC are rejected."""
    user_id, session_id, token = await setup_test_user_and_session(
        "hmac_test@example.com", integrity_mode="strict"
    )

    from fastapi.testclient import TestClient
    with TestClient(app).websocket_connect(f"/api/v1/ws/interview/{session_id}?token={token}") as ws:
        ready = ws.receive_json()
        assert ready["type"] == "session_ready"

        # Send packet with bad HMAC signature
        ws.send_json({
            "type": "telemetry",
            "t": 1.0,
            "eye_contact_ratio": 0.8,
            "posture_score": 0.8,
            "head_pose": {"yaw": 0, "pitch": 0, "roll": 0},
            "integrity": {
                "seq": 1,
                "camera_label_hash": "hash1",
                "device_id_hash": "hash2",
                "measured_fps": 30.0,
                "hmac": "invalid_forged_hmac_signature_00000000000000000000000000000000000000",
            },
        })
        err = ws.receive_json()
        assert err["type"] == "error"
        assert err["code"] == "BAD_HMAC"
