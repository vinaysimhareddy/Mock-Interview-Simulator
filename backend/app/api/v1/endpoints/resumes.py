import time
from collections import defaultdict
from typing import Annotated, Dict, List
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.core.config import get_settings
from app.core.security import get_current_user
from app.models.resume import ResumeResponse, ResumeUpdate
from app.models.user import UserInDB
from app.repositories.resume_chunk_repo import resume_chunk_repo
from app.repositories.resume_repo import resume_repo
from app.services.ai_engine import AIServiceError, parse_resume_profile
from app.services.pdf_parser import PDFExtractionError, extract_text
from app.services.resume_ingestion_service import ingest_resume_chunks

router = APIRouter(prefix="/resumes", tags=["resumes"])
settings = get_settings()

# In-memory rate limiter for resume uploads: max 5 uploads per 60 seconds per user
_upload_attempts: Dict[str, List[float]] = defaultdict(list)
UPLOAD_RATE_LIMIT = 5
UPLOAD_WINDOW_SECONDS = 60.0


def check_upload_rate_limit(user_id: str) -> None:
    now = time.time()
    attempts = _upload_attempts[user_id]
    _upload_attempts[user_id] = [t for t in attempts if now - t < UPLOAD_WINDOW_SECONDS]
    if len(_upload_attempts[user_id]) >= UPLOAD_RATE_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Resume upload rate limit exceeded. Please wait a moment before trying again.",
        )
    _upload_attempts[user_id].append(now)


@router.post(
    "/upload",
    response_model=ResumeResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload and parse a candidate resume PDF",
)
async def upload_resume(
    file: UploadFile = File(...),
    current_user: UserInDB = Depends(get_current_user),
) -> ResumeResponse:
    """
    Validate, extract text in-memory, and parse resume profile using LangChain structured outputs.
    Persists parsed resume to ai-mock-interview.resumes collection via resume_repo.
    Guarantees that files are never written to disk, magic-bytes are verified (%PDF),
    file size is checked against MAX_UPLOAD_MB, and LLM failure returns 502 with no partial save.
    """
    assert current_user is not None
    check_upload_rate_limit(current_user.id)

    # 1. Content-Type Header Validation
    content_type = (file.content_type or "").lower().split(";")[0].strip()
    if content_type != "application/pdf":
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported media type '{file.content_type}'. Only 'application/pdf' files are accepted.",
        )

    # 2. In-memory read with size limit check
    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    pdf_bytes = await file.read()

    if len(pdf_bytes) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Uploaded file exceeds maximum permitted size of {settings.MAX_UPLOAD_MB} MB.",
        )

    # 3. Magic-byte verification (%PDF header)
    if not pdf_bytes.startswith(b"%PDF"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Invalid file signature. File header does not match standard PDF (%PDF) magic bytes.",
        )

    # 4. In-memory text extraction via pdfplumber
    try:
        raw_text = extract_text(pdf_bytes)
    except PDFExtractionError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    # 5. AI structured parsing via LangChain (with automatic retry)
    try:
        parsed_profile = await parse_resume_profile(raw_text)
    except AIServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI resume parsing service failed: {str(exc)}",
        ) from exc

    # 6. Save atomically via resume_repo to 'resumes' collection only after complete parsing
    profile_dict = parsed_profile.model_dump()
    resume_doc = await resume_repo.create_resume(
        user_id=current_user.id,
        filename=file.filename or "resume.pdf",
        file_size=len(pdf_bytes),
        raw_text=raw_text,
        parsed_profile=profile_dict,
    )

    # 7. Ingest vector chunks into resume_chunks collection with embeddings (§2.3, Q2)
    try:
        await ingest_resume_chunks(
            resume_id=resume_doc["id"],
            user_id=current_user.id,
            raw_text=raw_text,
            parsed_profile=profile_dict,
        )
    except Exception as chunk_exc:
        logger.warning(
            "Resume vector chunking failed for %s: %s. Raw resume is preserved.",
            resume_doc["id"],
            chunk_exc,
        )

    return ResumeResponse(
        id=resume_doc["id"],
        user_id=current_user.id,
        filename=resume_doc["filename"],
        file_size=resume_doc["file_size"],
        raw_text=raw_text,
        parsed_profile=parsed_profile,
        parsed_data=parsed_profile,
        created_at=resume_doc["created_at"],
    )


@router.get(
    "",
    response_model=List[ResumeResponse],
    summary="List all resumes uploaded by the authenticated candidate",
)
async def list_resumes(
    current_user: Annotated[UserInDB, Depends(get_current_user)],
) -> List[ResumeResponse]:
    """Retrieve all resumes owned by the authenticated candidate, sorted by creation date."""
    docs = await resume_repo.list_by_user(current_user.id)
    return [ResumeResponse(**doc) for doc in docs]


@router.get(
    "/{resume_id}",
    response_model=ResumeResponse,
    summary="Get a specific resume by ID with ownership enforcement",
)
async def get_resume(
    resume_id: str,
    current_user: Annotated[UserInDB, Depends(get_current_user)],
) -> ResumeResponse:
    """Retrieve a single resume by ID. Returns 404 if not found or owned by another user."""
    doc = await resume_repo.get_by_id_and_user(resume_id, current_user.id)
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resume not found or you do not have permission to access it.",
        )
    return ResumeResponse(**doc)


@router.patch(
    "/{resume_id}",
    response_model=ResumeResponse,
    summary="Update candidate skills or summary on resume",
)
async def update_resume(
    resume_id: str,
    update_data: ResumeUpdate,
    current_user: Annotated[UserInDB, Depends(get_current_user)],
) -> ResumeResponse:
    """Update technical skills or profile summary on a candidate resume."""
    doc = await resume_repo.get_by_id_and_user(resume_id, current_user.id)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume not found.")

    profile = dict(doc.get("parsed_profile") or doc.get("parsed_data") or {})
    if update_data.skills is not None:
        profile["technical_skills"] = update_data.skills
        profile["skills"] = update_data.skills
    if update_data.summary is not None:
        profile["summary"] = update_data.summary

    updated = await resume_repo.update_profile(resume_id, current_user.id, profile)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume not found.")

    # Re-ingest chunks upon resume update
    try:
        await ingest_resume_chunks(
            resume_id=resume_id,
            user_id=current_user.id,
            raw_text=doc.get("raw_text", ""),
            parsed_profile=profile,
        )
    except Exception as chunk_exc:
        logger.warning("Resume re-chunking failed for %s: %s", resume_id, chunk_exc)

    return ResumeResponse(**updated)


@router.delete(
    "/{resume_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a resume and all its vector chunks",
)
async def delete_resume(
    resume_id: str,
    current_user: Annotated[UserInDB, Depends(get_current_user)],
) -> None:
    """Delete candidate resume and all associated chunks with user ownership enforcement."""
    deleted = await resume_repo.delete_by_id_and_user(resume_id, current_user.id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume not found.")

    # Clean up associated vector chunks
    await resume_chunk_repo.delete_by_resume_and_user(resume_id=resume_id, user_id=current_user.id)
