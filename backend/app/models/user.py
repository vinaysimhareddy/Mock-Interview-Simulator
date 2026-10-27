from datetime import datetime, timezone
from typing import Any, Dict, Optional
from bson import ObjectId
from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserBase(BaseModel):
    """Base user properties shared across representations."""
    email: EmailStr = Field(..., description="Unique email address for user authentication")
    full_name: str = Field(..., min_length=1, max_length=120, description="Candidate's full name")


class UserCreate(UserBase):
    """Schema for candidate registration."""
    password: str = Field(
        ...,
        min_length=8,
        max_length=128,
        description="Plaintext password, min 8 characters",
    )
    role: str = Field(default="candidate", description="User role: candidate | admin")


class UserLogin(BaseModel):
    """Schema for authentication credentials."""
    email: EmailStr = Field(..., description="Registered email address")
    password: str = Field(..., min_length=1, description="Account password")


class UserPublic(BaseModel):
    """Public user schema returned in API responses. Never returns hashed_password or internal fields."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str = Field(..., description="Unique user identifier")
    email: EmailStr = Field(..., description="Unique email address")
    full_name: str = Field(..., description="User's full name")
    role: str = Field(default="candidate", description="User role: candidate | admin")
    is_active: bool = Field(default=True, description="Account active status")
    is_email_verified: bool = Field(default=False, description="Email verification status")
    settings: Dict[str, Any] = Field(default_factory=dict, description="User customizable settings")
    created_at: datetime = Field(..., description="Account creation timestamp (UTC)")
    updated_at: datetime = Field(..., description="Account last update timestamp (UTC)")


# Backward compatibility alias
UserResponse = UserPublic


class UserInDB(BaseModel):
    """Internal user model corresponding to ai-mock-interview.auth document."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, arbitrary_types_allowed=True)

    id: str = Field(..., description="Stringified user ObjectId")
    email: str = Field(..., description="Lowercased, trimmed unique email")
    hashed_password: str = Field(..., description="Argon2id password hash")
    full_name: str = Field(..., description="User's full name")
    role: str = Field(default="candidate", description="Role: candidate | admin")
    is_active: bool = Field(default=True, description="Account active status")
    is_email_verified: bool = Field(default=False, description="Email verification status")
    failed_login_count: int = Field(default=0, description="Consecutive failed login counter")
    locked_until: Optional[datetime] = Field(default=None, description="Lockout expiry timestamp")
    last_login_at: Optional[datetime] = Field(default=None, description="Last successful login timestamp")
    settings: Dict[str, Any] = Field(default_factory=dict, description="User customizable settings")
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="Account creation timestamp (UTC)",
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="Account update timestamp (UTC)",
    )

    def to_public(self) -> UserPublic:
        """Convert internal auth document representation into sanitized UserPublic schema."""
        return UserPublic(
            id=self.id,
            email=self.email,  # type: ignore[arg-type]
            full_name=self.full_name,
            role=self.role,
            is_active=self.is_active,
            is_email_verified=self.is_email_verified,
            settings=self.settings,
            created_at=self.created_at,
            updated_at=self.updated_at,
        )


class Token(BaseModel):
    """JWT bearer token response schema."""
    access_token: str = Field(..., description="Signed JWT access token")
    token_type: str = Field(default="bearer", description="Token type identifier")
    expires_in: int = Field(..., description="Token lifespan in seconds")


class TokenPayload(BaseModel):
    """Decoded JWT payload verification schema."""
    sub: str = Field(..., description="Subject claim containing user ID")
    exp: int = Field(..., description="Expiration epoch timestamp")
    iat: Optional[int] = Field(default=None, description="Issued at epoch timestamp")
