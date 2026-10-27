import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from pydantic import ValidationError

from app.api.deps import get_current_user
from app.core.security import decode_access_token
from app.models.telemetry import TelemetryPacket
from app.models.user import UserInDB
from app.repositories.auth_repo import auth_repo
from app.repositories.session_repo import session_repo
from app.repositories.telemetry_repo import telemetry_repo

router = APIRouter(prefix="/telemetry", tags=["telemetry"])
logger = logging.getLogger("uvicorn.error")


@router.websocket("/ws")
async def telemetry_websocket(
    websocket: WebSocket,
    session_id: str = Query(..., description="Target interview session UUID"),
    token: Optional[str] = Query(None, description="JWT Bearer access token"),
) -> None:
    """Stream real-time computer vision and vocal telemetry packets into MongoDB time-buckets."""
    await websocket.accept()

    # 1. Authenticate via token query param or initial auth message
    auth_token = token
    if not auth_token:
        try:
            import asyncio
            init_msg = await asyncio.wait_for(websocket.receive_json(), timeout=0.5)
            if isinstance(init_msg, dict) and init_msg.get("type") == "auth":
                auth_token = init_msg.get("token")
        except Exception:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Auth timeout")
            return

    if not auth_token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Authentication required")
        return

    payload = decode_access_token(auth_token)
    if not payload or "sub" not in payload:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid credentials")
        return

    user_id = str(payload["sub"])
    user = await auth_repo.get_by_id(user_id)
    if not user or not user.is_active:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="User inactive or not found")
        return

    # 2. Validate session exists via session_repo
    session_doc = await session_repo.get_by_id(session_id)
    if not session_doc:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Session not found")
        return

    logger.info("WebSocket telemetry stream established for session %s (user: %s)", session_id, user_id)
    await websocket.send_json({"status": "connected", "session_id": session_id})

    # 3. Ingestion loop with MongoDB time-bucketing via telemetry_repo
    bucket_index = 0
    buffer: List[Dict[str, Any]] = []

    try:
        while True:
            raw_data = await websocket.receive_json()

            # Handle ping/keepalive
            if isinstance(raw_data, dict) and raw_data.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            try:
                if isinstance(raw_data, dict):
                    raw_data["session_id"] = session_id
                packet = TelemetryPacket(**raw_data)
            except ValidationError as err:
                await websocket.send_json({"status": "error", "detail": err.errors()})
                continue

            packet_dict = packet.model_dump(mode="json")
            buffer.append(packet_dict)

            # Flush when buffer reaches 10 samples
            if len(buffer) >= 10:
                await telemetry_repo.insert_telemetry_bucket(
                    session_id=session_id,
                    bucket_index=bucket_index,
                    samples=list(buffer),
                )
                bucket_index += 1
                buffer.clear()

            await websocket.send_json({
                "status": "ack",
                "session_id": session_id,
                "timestamp": packet.timestamp.isoformat(),
            })

    except WebSocketDisconnect:
        logger.info("WebSocket telemetry disconnected gracefully for session %s", session_id)
    except Exception as exc:
        logger.error("Error during telemetry websocket stream: %s", exc)
    finally:
        if buffer:
            try:
                await telemetry_repo.insert_telemetry_bucket(
                    session_id=session_id,
                    bucket_index=bucket_index,
                    samples=list(buffer),
                )
            except Exception:
                pass


@router.get(
    "/sessions/{session_id}/recent",
    summary="Get recent telemetry packets for session",
)
async def get_recent_telemetry(
    session_id: str,
    current_user: UserInDB = Depends(get_current_user),
) -> Dict[str, Any]:
    """Retrieve recent time-bucketed telemetry packets for session visualization with user ownership isolation."""
    session_doc = await session_repo.get_by_id_and_user(session_id, current_user.id)
    if not session_doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")

    all_samples = await telemetry_repo.get_full_session_samples(session_id, limit_buckets=5)

    return {
        "session_id": session_id,
        "total_packets": len(all_samples),
        "recent_packets": all_samples[-30:],
    }
