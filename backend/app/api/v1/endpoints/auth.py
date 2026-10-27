from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, status
from pymongo.errors import ConnectionFailure, DuplicateKeyError, PyMongoError, ServerSelectionTimeoutError

from app.core.config import get_settings
from app.core.security import create_access_token, get_current_user, hash_password, verify_password
from app.models.user import Token, UserCreate, UserInDB, UserLogin, UserPublic
from app.repositories.auth_repo import DuplicateEmailError, auth_repo

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()

# Static dummy Argon2id hash for constant-time verification when user does not exist
_DUMMY_ARGON2_HASH = "$argon2id$v=19$m=65536,t=3,p=4$bW9ja3NhbHQxMjM0NTY3OA$9i1z0s1E2u7K9L2x5O8b1g"


@router.post(
    "/register",
    response_model=UserPublic,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user account in ai-mock-interview.auth",
)
async def register(user_in: UserCreate) -> UserPublic:
    """
    Register a new user account directly into ai-mock-interview.auth collection.
    Email is normalized, password is typed and hashed with Argon2id.
    Duplicate email raises 409 Conflict via caught DuplicateKeyError (no check-then-insert).
    Database connection errors raise 503 Database unavailable.
    Never exposes hashed_password or internal fields.
    """
    hashed_pwd = hash_password(user_in.password)

    try:
        user = await auth_repo.create_user(
            email=user_in.email,
            hashed_password=hashed_pwd,
            full_name=user_in.full_name,
            role=user_in.role,
        )
    except (DuplicateEmailError, DuplicateKeyError):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email address already exists.",
        )
    except (PyMongoError, ConnectionFailure, ServerSelectionTimeoutError, RuntimeError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database unavailable",
        )

    return user.to_public()


@router.post(
    "/login",
    response_model=Token,
    summary="Authenticate user and issue JWT bearer token",
)
async def login(credentials: UserLogin) -> Token:
    """
    Authenticate user credentials against ai-mock-interview.auth.
    Performs constant-time verification, returns generic error message on failure,
    tracks failed logins, locks out for 15 minutes after 5 failures, and resets on success.
    Database connection errors raise 503 Database unavailable.
    """
    try:
        user = await auth_repo.get_by_email(credentials.email)
    except (PyMongoError, ConnectionFailure, ServerSelectionTimeoutError, RuntimeError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database unavailable",
        )

    if not user:
        # Perform constant-time verification against dummy hash to prevent timing attacks
        verify_password(credentials.password, _DUMMY_ARGON2_HASH)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check lockout
    if auth_repo.is_locked(user):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account is temporarily locked due to multiple failed login attempts. Please try again in 15 minutes.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Verify password
    if not verify_password(credentials.password, user.hashed_password):
        try:
            await auth_repo.record_failed_login(user)
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Reset failure counters and update last_login_at
    try:
        await auth_repo.record_successful_login(user)
    except (PyMongoError, ConnectionFailure, ServerSelectionTimeoutError, RuntimeError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database unavailable",
        )

    # Generate PyJWT with sub = str(auth._id), exp, iat
    access_token = create_access_token(subject=user.id)
    return Token(
        access_token=access_token,
        token_type="bearer",
        expires_in=settings.JWT_EXPIRE_MINUTES * 60,
    )


@router.get(
    "/me",
    response_model=UserPublic,
    summary="Get authenticated user profile",
)
async def get_me(
    current_user: Annotated[UserInDB, Depends(get_current_user)],
) -> UserPublic:
    """
    Return sanitized public user profile loaded from ai-mock-interview.auth.
    Guarantees hashed_password and internal lockout fields are never returned.
    """
    return current_user.to_public()
