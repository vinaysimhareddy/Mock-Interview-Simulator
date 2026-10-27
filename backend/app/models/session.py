from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field


class SessionStatus(str, Enum):
    CREATED = "created"
    ACTIVE = "active"
    COMPLETED = "completed"
    ABORTED = "aborted"


SessionStatusType = Literal["created", "active", "completed", "aborted", "CREATED", "IN_PROGRESS", "COMPLETED", "TERMINATED"]


class TranscriptTurn(BaseModel):
    turn_id: str = Field(..., description="Unique turn identifier")
    role: Literal["interviewer", "candidate"] = Field(..., description="Speaker role")
    text: str = Field(..., description="Turn content text")
    t_start: float = Field(..., ge=0, description="Start offset in seconds")
    t_end: Optional[float] = Field(default=None, description="End offset in seconds")


class TelemetrySampleBucket(BaseModel):
    """Bucketed telemetry packet storing up to 60 samples to prevent Mongo 16MB document size limits."""
    session_id: str
    bucket_index: int
    samples: List[Dict[str, Any]] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class SessionCreate(BaseModel):
    """Payload for initializing an interview session."""
    model_config = ConfigDict(populate_by_name=True)

    resume_id: Optional[str] = Field(None, description="Resume ID to ground interview questions")
    job_role: str = Field(
        ...,
        validation_alias=AliasChoices("job_role", "role"),
        min_length=2,
        max_length=120,
        description="Target job title or role",
    )
    target_seniority: str = Field(
        default="Mid",
        validation_alias=AliasChoices("target_seniority", "seniority"),
        description="Seniority level (Junior, Mid, Senior, Lead)",
    )
    difficulty: Optional[str] = Field(default="Adaptive", description="Interview difficulty setting")
    integrity_mode: Literal["off", "advisory", "strict"] = Field(
        default="strict", description="Camera integrity enforcement mode: off | advisory | strict"
    )

    @property
    def role(self) -> str:
        return self.job_role

    @property
    def seniority(self) -> str:
        return self.target_seniority


class SessionInDB(BaseModel):
    """MongoDB representation of interview_sessions collection."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str = Field(..., alias="_id", description="Unique session ID")
    user_id: str = Field(..., description="Candidate user ID")
    resume_id: Optional[str] = Field(None, description="Resume ID")
    job_role: str = Field(..., description="Job role")
    target_seniority: str = Field(..., description="Seniority level")
    integrity_mode: Literal["off", "advisory", "strict"] = Field(default="strict")
    session_status: SessionStatus = Field(default=SessionStatus.CREATED, description="Lifecycle status")
    transcript: List[TranscriptTurn] = Field(default_factory=list, description="Interview transcript turns")
    video_telemetry_time_series: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Inline recent telemetry or telemetry summary pointers",
    )
    started_at: Optional[datetime] = Field(None, description="Session start timestamp")
    ended_at: Optional[datetime] = Field(None, description="Session end timestamp")
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc), description="Creation timestamp"
    )


class SessionResponse(BaseModel):
    """Public API response schema for interview session."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str = Field(..., description="Unique session ID")
    user_id: str = Field(..., description="Candidate user ID")
    resume_id: Optional[str] = Field(None, description="Resume ID")
    job_role: str = Field(..., validation_alias=AliasChoices("job_role", "role"), description="Job role")
    target_seniority: str = Field(..., validation_alias=AliasChoices("target_seniority", "seniority"), description="Seniority level")
    role: Optional[str] = Field(None, description="Role alias")
    seniority: Optional[str] = Field(None, description="Seniority alias")
    difficulty: Optional[str] = Field(default="Adaptive")
    integrity_mode: Literal["off", "advisory", "strict"] = Field(default="strict")
    session_status: Optional[str] = Field(default="created", validation_alias=AliasChoices("session_status", "status"))
    status: Optional[str] = Field(default="created", validation_alias=AliasChoices("status", "session_status"))
    transcript: List[TranscriptTurn] = Field(default_factory=list)
    started_at: Optional[datetime] = Field(None)
    ended_at: Optional[datetime] = Field(None)
    created_at: datetime = Field(...)

    def model_post_init(self, __context: Any) -> None:
        if not self.role:
            self.role = self.job_role
        if not self.seniority:
            self.seniority = self.target_seniority
        if not self.status:
            self.status = str(self.session_status)
        if not self.session_status:
            self.session_status = str(self.status)

