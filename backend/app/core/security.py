from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Dict, Optional
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from motor.motor_asyncio import AsyncIOMotorDatabase
from passlib.context import CryptContext

from app.core.config import get_settings
from app.core.database import get_database
from app.models.user import UserInDB

settings = get_settings()

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")
ALGORITHM = "HS256"
security_bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    """Hash plaintext password using Argon2id algorithm."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify plaintext password against stored Argon2id hash."""
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(
    subject: str, expires_delta: Optional[timedelta] = None
) -> str:
    """Create signed HS256 JWT access token with expiration and issued-at timestamps."""
    now = datetime.now(timezone.utc)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)

    to_encode: Dict[str, Any] = {
        "sub": str(subject),
        "exp": int(expire.timestamp()),
        "iat": int(now.timestamp()),
    }
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=ALGORITHM)


def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    """Decode and validate signature and expiration of JWT access token."""
    try:
        payload = jwt.decode(
            token, settings.JWT_SECRET, algorithms=[ALGORITHM]
        )
        return payload
    except (jwt.PyJWTError, ValueError):
        return None


from pymongo.errors import ConnectionFailure, PyMongoError, ServerSelectionTimeoutError
from app.repositories.auth_repo import auth_repo


async def get_current_user(
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(security_bearer)],
) -> UserInDB:
    """Dependency validating JWT Bearer token and resolving current authenticated user from auth repository."""
    unauthorized_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if not credentials or not credentials.credentials:
        raise unauthorized_exc

    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise unauthorized_exc

    user_id: Optional[str] = payload.get("sub")
    if not user_id:
        raise unauthorized_exc

    try:
        user = await auth_repo.get_by_id(user_id)
    except (PyMongoError, ConnectionFailure, ServerSelectionTimeoutError, RuntimeError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database unavailable",
        )

    if user is None or not user.is_active:
        raise unauthorized_exc

    return user
