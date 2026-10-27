import asyncio
import json
import logging
import secrets
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import TypeAdapter, ValidationError

from app.core.config import get_settings
from app.core.security import decode_access_token
from app.models.ws_messages import ClientWSMessage
from app.repositories.auth_repo import auth_repo
from app.repositories.integrity_repo import integrity_repo
from app.repositories.session_repo import session_repo
from app.repositories.telemetry_repo import telemetry_repo
from app.services.integrity_service import (
    HMACManager,
    PlausibilityChecker,
    IntegrityScorer,
    PolicyEngine,
    PolicyActionType,
)

logger = logging.getLogger("uvicorn.error")

router = APIRouter(tags=["websocket"])

MAX_MESSAGE_BYTES = 16 * 1024  # 16 KB per message limit (§10)
HEARTBEAT_INTERVAL_SECONDS = 20.0
SILENCE_TIMEOUT_SECONDS = 60.0
TELEMETRY_FLUSH_INTERVAL = 10.0

client_message_adapter: TypeAdapter[ClientWSMessage] = TypeAdapter(ClientWSMessage)


def scrub_log_token(url_str: str) -> str:
    """Scrub JWT tokens from query strings in logs to prevent secret leakage."""
    import re
    return re.sub(r"token=[^&\s]+", "token=[REDACTED]", url_str)


class TelemetryBuffer:
    """Buffers telemetry frames and flushes to MongoDB every 10s and on disconnect."""

    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self.buffer: List[Dict[str, Any]] = []
        self.last_flush_time = time.time()
        self.bucket_index = 0

    def add(self, telemetry_dict: Dict[str, Any]) -> None:
        self.buffer.append(telemetry_dict)

    async def flush_if_needed(self, force: bool = False) -> None:
        now = time.time()
        if (now - self.last_flush_time >= TELEMETRY_FLUSH_INTERVAL or force) and self.buffer:
            await self._flush_to_db()
            self.last_flush_time = now

    async def _flush_to_db(self) -> None:
        if not self.buffer:
            return
        samples_to_write = list(self.buffer)
        self.buffer.clear()
        try:
            await telemetry_repo.insert_telemetry_bucket(
                session_id=self.session_id,
                bucket_index=self.bucket_index,
                samples=samples_to_write,
            )
            self.bucket_index += 1

            summary_points = [
                {
                    "t": s.get("t"),
                    "eye": s.get("eye_contact_ratio"),
                    "posture": s.get("posture_score"),
                    "flags": s.get("distraction_flags", []),
                }
                for s in samples_to_write[::5]
            ]
            await session_repo.push_telemetry_summary(
                session_id=self.session_id,
                summary_points=summary_points,
            )
        except Exception as exc:
            logger.error("Failed to flush telemetry bucket for session %s: %s", self.session_id, exc)


@router.websocket("/interview/{session_id}")
async def interview_websocket_endpoint(
    websocket: WebSocket,
    session_id: str,
) -> None:
    """
    Real-time interview telemetry and question streaming WebSocket endpoint.
    Path: /api/v1/ws/interview/{session_id}?token=<JWT>
    Validates token and session ownership before accepting stream.
    Rejects unauthorized or forbidden connections with close code 4008.
    """
    raw_query = str(websocket.scope.get("query_string", b"").decode("utf-8"))
    logger.info("WebSocket handshake request for session %s (query: %s)", session_id, scrub_log_token(raw_query))

    token: Optional[str] = websocket.query_params.get("token")

    # 1. JWT Handshake Validation
    if not token:
        logger.warning("WebSocket handshake rejected: Missing ?token query parameter.")
        await websocket.close(code=4008, reason="Policy violation: Authentication token required in query string")
        return

    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        logger.warning("WebSocket handshake rejected: Invalid or expired token.")
        await websocket.close(code=4008, reason="Policy violation: Invalid or expired access token")
        return
    user_id = str(payload["sub"])
    user = await auth_repo.get_by_id(user_id)
    if user is None or not user.is_active:
        logger.warning("WebSocket handshake rejected: User %s not found or inactive in auth collection.", user_id)
        await websocket.close(code=4008, reason="Policy violation: Authenticated user not found or inactive")
        return

    # 2. Session Existence & Ownership Verification
    session_doc = await session_repo.get_by_id(session_id)
    if session_doc is None:
        logger.warning("WebSocket handshake rejected: Session %s not found.", session_id)
        await websocket.close(code=4008, reason="Policy violation: Interview session not found")
        return

    if str(session_doc.get("user_id")) != user_id:
        logger.warning(
            "WebSocket handshake rejected: Session %s owner (%s) does not match token subject (%s).",
            session_id,
            session_doc.get("user_id"),
            user_id,
        )
        await websocket.close(code=4008, reason="Policy violation: Session does not belong to authenticated user")
        return

    # 3. Initialize Integrity Management (§5)
    settings = get_settings()
    integrity_mode = str(session_doc.get("integrity_mode") or settings.INTEGRITY_MODE).lower()

    hmac_manager = HMACManager()
    plausibility_checker = PlausibilityChecker()
    integrity_scorer = IntegrityScorer()
    policy_engine = PolicyEngine(mode=integrity_mode)
    last_seq: Optional[int] = None

    # 4. Accept WebSocket and emit session_ready with HMAC key & session salt (§5.1)
    await websocket.accept()
    await websocket.send_json({
        "type": "session_ready",
        "session_id": session_id,
        "message": "Interview session ready",
        "hmac_key": hmac_manager.get_active_key(),
        "session_salt": hmac_manager.session_salt,
    })

    telemetry_buffer = TelemetryBuffer(session_id)
    last_activity_time = time.time()
    last_ping_sent = time.time()

    async def heartbeat_pinger() -> None:
        nonlocal last_ping_sent
        while True:
            await asyncio.sleep(5)
            now = time.time()
            if now - last_ping_sent >= HEARTBEAT_INTERVAL_SECONDS:
                try:
                    await websocket.send_json({"type": "ping", "timestamp": now})
                    last_ping_sent = now
                except Exception:
                    break
            if now - last_activity_time > SILENCE_TIMEOUT_SECONDS:
                logger.warning("Dropping WebSocket connection for session %s due to 60s silence.", session_id)
                try:
                    await websocket.close(code=1000, reason="Heartbeat timeout: 60s silence")
                except Exception:
                    pass
                break

    heartbeat_task = asyncio.create_task(heartbeat_pinger())

    try:
        while True:
            raw_text = await websocket.receive_text()
            last_activity_time = time.time()

            if len(raw_text.encode("utf-8")) > MAX_MESSAGE_BYTES:
                await websocket.send_json({
                    "type": "error",
                    "code": "PAYLOAD_TOO_LARGE",
                    "message": f"Message exceeds maximum size of {MAX_MESSAGE_BYTES} bytes",
                })
                continue

            try:
                raw_json = json.loads(raw_text)
            except json.JSONDecodeError:
                await websocket.send_json({
                    "type": "error",
                    "code": "INVALID_JSON",
                    "message": "Malformed JSON payload",
                })
                continue

            try:
                client_msg = client_message_adapter.validate_python(raw_json)
            except ValidationError as val_err:
                await websocket.send_json({
                    "type": "error",
                    "code": "INVALID_PAYLOAD",
                    "message": str(val_err),
                })
                continue

            # Route message types
            if client_msg.type == "ping":
                await websocket.send_json({
                    "type": "pong",
                    "timestamp": client_msg.timestamp or time.time(),
                })

            elif client_msg.type == "telemetry":
                # Strict mode check: must have integrity object
                if integrity_mode == "strict" and not client_msg.integrity:
                    await websocket.send_json({
                        "type": "error",
                        "code": "INTEGRITY_VIOLATION",
                        "message": "Telemetry packet rejected: signed integrity fields are required when session.integrity_mode is strict.",
                    })
                    continue

                integrity_data = client_msg.integrity
                reported_flags: List[str] = []

                if integrity_data:
                    # 1. Monotonic Sequence Validation (§5.1)
                    if integrity_data.seq is not None:
                        seq = integrity_data.seq
                        if last_seq is not None and seq <= last_seq:
                            integrity_scorer.record_event(
                                "replayed_sequence", 1.0, client_msg.t, {"seq": seq, "last_seq": last_seq}
                            )
                            if integrity_mode == "strict":
                                await websocket.send_json({
                                    "type": "error",
                                    "code": "REPLAYED_SEQUENCE",
                                    "message": f"Telemetry packet rejected: replayed or duplicate sequence {seq}",
                                })
                                continue
                        elif last_seq is not None and seq > last_seq + 1:
                            integrity_scorer.record_event(
                                "telemetry_gap", 0.7, client_msg.t, {"gap": seq - last_seq}
                            )
                        last_seq = seq

                    # 2. HMAC Signature Verification (§5.1)
                    if integrity_data.hmac:
                        is_valid = hmac_manager.verify_signature(
                            integrity_data.hmac,
                            client_msg.t,
                            integrity_data.seq or 0,
                            integrity_data.camera_label_hash,
                            integrity_data.device_id_hash,
                            integrity_data.measured_fps,
                        )
                        if not is_valid:
                            integrity_scorer.record_event("bad_hmac", 1.0, client_msg.t)
                            if integrity_mode == "strict":
                                await websocket.send_json({
                                    "type": "error",
                                    "code": "BAD_HMAC",
                                    "message": "Telemetry packet rejected: invalid HMAC signature",
                                })
                                continue

                    # Record client-reported flags
                    for item in integrity_data.flags:
                        f_name = item.flag if hasattr(item, "flag") else item.get("flag", "")
                        conf = item.confidence if hasattr(item, "confidence") else item.get("confidence", 1.0)
                        if f_name:
                            reported_flags.append(f_name)
                            integrity_scorer.record_event(f_name, conf, client_msg.t)

                # 3. Server-side Plausibility Checks (§5.2)
                plausibility_flags = plausibility_checker.check_telemetry(client_msg.model_dump())
                for pf in plausibility_flags:
                    integrity_scorer.record_event(pf, 0.9, client_msg.t)

                # 4. Policy Engine Evaluation (§5.3)
                combined_flags = list(set(reported_flags + plausibility_flags))
                was_paused = policy_engine.is_paused
                decision = policy_engine.evaluate(combined_flags, time.time())

                if was_paused and not policy_engine.is_paused:
                    await websocket.send_json({
                        "type": "resume_integrity",
                        "message": "Camera feed restored",
                    })

                if decision.action == PolicyActionType.PAUSE:
                    await websocket.send_json({
                        "type": "pause_integrity",
                        "reason": decision.reason,
                        "grace_seconds": decision.grace_seconds,
                        "voice_prompt": decision.voice_prompt or "Camera lost, please restore it",
                    })
                elif decision.action == PolicyActionType.CHALLENGE:
                    challenge_nonce = secrets.token_hex(16)
                    policy_engine.active_challenge_nonce = challenge_nonce
                    await websocket.send_json({
                        "type": "challenge",
                        "challenge_id": str(uuid.uuid4()),
                        "action": decision.challenge_action or "turn_head_left",
                        "prompt": decision.challenge_prompt or "For verification, please turn your head to the left",
                        "nonce": challenge_nonce,
                        "timeout_sec": 8.0,
                    })
                elif decision.action == PolicyActionType.ABORT:
                    await websocket.send_json({
                        "type": "error",
                        "code": "INTEGRITY_FAILED",
                        "message": decision.reason,
                    })
                    break

                # Buffer and acknowledge telemetry
                telemetry_buffer.add(client_msg.model_dump())
                await telemetry_buffer.flush_if_needed(force=False)
                await websocket.send_json({
                    "type": "ack",
                    "received_type": "telemetry",
                    "t": client_msg.t,
                })

            elif client_msg.type == "transcript_chunk":
                plausibility_checker.record_speech(client_msg.t)
                await websocket.send_json({
                    "type": "ack",
                    "received_type": "transcript_chunk",
                    "t": client_msg.t,
                })

            elif client_msg.type == "challenge_result":
                challenge_res = policy_engine.handle_challenge_result(client_msg.passed)
                await session_repo.record_challenges(session_id, bool(client_msg.passed))
                if not client_msg.passed:
                    integrity_scorer.record_event(
                        "challenge_failed", 1.0, 0.0, {"challenge_id": client_msg.challenge_id}
                    )
                    await integrity_repo.record_event(
                        session_id=session_id,
                        event_type="challenge_failed",
                        t=0.0,
                        confidence=1.0,
                        details={"challenge_id": client_msg.challenge_id},
                    )

                if challenge_res.action == PolicyActionType.ABORT:
                    await websocket.send_json({
                        "type": "error",
                        "code": "INTEGRITY_FAILED",
                        "message": challenge_res.reason,
                    })
                    break
                elif challenge_res.action == PolicyActionType.CHALLENGE:
                    await websocket.send_json({
                        "type": "challenge",
                        "challenge_id": str(uuid.uuid4()),
                        "action": challenge_res.challenge_action or "smile",
                        "prompt": challenge_res.challenge_prompt or "For verification, please smile at the camera",
                        "nonce": secrets.token_hex(16),
                        "timeout_sec": 8.0,
                    })
                else:
                    await websocket.send_json({
                        "type": "ack",
                        "received_type": "challenge_result",
                    })

            elif client_msg.type == "integrity_event":
                integrity_scorer.record_event(
                    client_msg.event_type, 1.0, client_msg.t, client_msg.details
                )
                await integrity_repo.record_event(
                    session_id=session_id,
                    event_type=client_msg.event_type,
                    t=client_msg.t,
                    confidence=1.0,
                    details=client_msg.details,
                )
                if client_msg.details and "camera_device_name" in client_msg.details:
                    dev_name = str(client_msg.details["camera_device_name"])
                    await session_repo.record_camera_name(session_id, dev_name)
                await websocket.send_json({
                    "type": "ack",
                    "received_type": "integrity_event",
                })

            elif client_msg.type == "answer_complete":
                await websocket.send_json({
                    "type": "ack",
                    "received_type": "answer_complete",
                })

            elif client_msg.type == "end_interview":
                await telemetry_buffer.flush_if_needed(force=True)
                final_score = integrity_scorer.compute_score()
                events = integrity_scorer.get_events()

                try:
                    await session_repo.record_integrity_result(session_id, final_score, events)
                    await integrity_repo.record_events_batch(session_id, events)
                except Exception as db_err:
                    logger.error("Failed to persist final integrity score for %s: %s", session_id, db_err)

                eval_id = str(uuid.uuid4())
                await websocket.send_json({
                    "type": "interview_complete",
                    "session_id": session_id,
                    "evaluation_id": eval_id,
                })
                break

    except WebSocketDisconnect:
        logger.info("Client disconnected from WebSocket session %s", session_id)
    except Exception as exc:
        logger.error("Unhandled exception in WebSocket session %s: %s", session_id, exc)
    finally:
        heartbeat_task.cancel()
        await telemetry_buffer.flush_if_needed(force=True)
        final_score = integrity_scorer.compute_score()
        events = integrity_scorer.get_events()
        try:
            await session_repo.record_integrity_result(session_id, final_score, events)
            await integrity_repo.record_events_batch(session_id, events)
        except Exception:
            pass
