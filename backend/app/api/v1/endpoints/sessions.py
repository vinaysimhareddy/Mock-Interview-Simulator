from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.api.deps import get_current_user
from app.models.session import SessionCreate, SessionResponse, SessionStatusType
from app.models.user import UserInDB
from app.repositories.resume_repo import resume_repo
from app.repositories.session_repo import session_repo

router = APIRouter(prefix="/sessions", tags=["sessions"])


class StatusUpdate(BaseModel):
    """Schema to transition session status."""
    status: SessionStatusType


@router.post(
    "",
    response_model=SessionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new adaptive interview session",
)
async def create_session(
    session_in: SessionCreate,
    current_user: UserInDB = Depends(get_current_user),
) -> SessionResponse:
    """
    Create a new interview session configured with candidate resume, target role, seniority, and difficulty.
    Persists to ai-mock-interview.interview_sessions collection via session_repo.
    Enforces user isolation on referenced resume.
    """
    if session_in.resume_id:
        resume_doc = await resume_repo.get_by_id_and_user(
            session_in.resume_id, current_user.id
        )
        if not resume_doc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Referenced resume not found or access denied.",
            )

    session_doc = await session_repo.create_session(
        user_id=current_user.id,
        job_role=session_in.job_role,
        target_seniority=session_in.target_seniority,
        difficulty=session_in.difficulty or "Adaptive",
        integrity_mode=session_in.integrity_mode or "strict",
        resume_id=session_in.resume_id,
    )

    return SessionResponse(**session_doc)


@router.get(
    "",
    response_model=List[SessionResponse],
    summary="List all interview sessions for current user",
)
async def list_sessions(
    current_user: UserInDB = Depends(get_current_user),
) -> List[SessionResponse]:
    """Retrieve all interview sessions for current user ordered by creation time."""
    sessions_list = await session_repo.list_by_user(current_user.id)
    return [SessionResponse(**s) for s in sessions_list]


@router.get(
    "/{session_id}",
    response_model=SessionResponse,
    summary="Get single interview session by ID",
)
async def get_session(
    session_id: str,
    current_user: UserInDB = Depends(get_current_user),
) -> SessionResponse:
    """Retrieve session details by ID. Returns 404 if session not found or owned by another user."""
    doc = await session_repo.get_by_id_and_user(session_id, current_user.id)
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Interview session not found.",
        )
    return SessionResponse(**doc)


@router.patch(
    "/{session_id}/status",
    response_model=SessionResponse,
    summary="Transition session lifecycle state",
)
async def update_session_status(
    session_id: str,
    status_update: StatusUpdate,
    current_user: UserInDB = Depends(get_current_user),
) -> SessionResponse:
    """Update session state to IN_PROGRESS, COMPLETED, or TERMINATED with timestamp recording."""
    updated = await session_repo.update_status(
        session_id=session_id,
        user_id=current_user.id,
        status=status_update.status,
    )
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Interview session not found.",
        )
    return SessionResponse(**updated)
