from fastapi import APIRouter
from app.api.v1 import websocket
from app.api.v1.endpoints import auth, interview, resumes, sessions

api_router = APIRouter()

# Mount authentication endpoints under /api/v1/auth
api_router.include_router(auth.router)

# Mount resume ingestion endpoints under /api/v1/resumes
api_router.include_router(resumes.router)

# Mount interview session endpoints under /api/v1/sessions
api_router.include_router(sessions.router)

# Mount adaptive interview workflow endpoints under /api/v1/interview
api_router.include_router(interview.router)

# Mount WebSocket endpoint under /api/v1/ws (/api/v1/ws/interview/{session_id})
api_router.include_router(websocket.router, prefix="/ws")


@api_router.get("/ping", tags=["system"])
async def ping() -> dict[str, str]:
    """Lightweight ping endpoint for v1 API namespace."""
    return {"ping": "pong"}
