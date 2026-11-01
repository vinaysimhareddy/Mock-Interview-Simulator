from enum import Enum
from typing import Annotated, Any, Dict, List, Literal, Optional, Union
from pydantic import BaseModel, Field


class DistractionFlag(str, Enum):
    LOOKED_AWAY = "looked_away"
    FACE_MISSING = "face_missing"
    SLOUCHING = "slouching"
    FIDGETING = "fidgeting"


class HeadPose(BaseModel):
    yaw: float = Field(..., description="Head yaw angle in degrees")
    pitch: float = Field(..., description="Head pitch angle in degrees")
    roll: float = Field(..., description="Head roll angle in degrees")


class FacialExpression(BaseModel):
    smile: float = Field(default=0.0, ge=0.0, le=1.0)
    brow_furrow: float = Field(default=0.0, ge=0.0, le=1.0)
    mouth_open: float = Field(default=0.0, ge=0.0, le=1.0)


# ==============================================================================
# Client -> Server Messages
# ==============================================================================


class IntegrityFlagItem(BaseModel):
    flag: str
    confidence: float = 1.0


class IntegrityPayload(BaseModel):
    camera_label_hash: Optional[str] = None
    device_id_hash: Optional[str] = None
    track_state: Optional[str] = "live"
    resolution: Optional[str] = None
    measured_fps: Optional[float] = None
    frame_diff_mean: Optional[float] = None
    landmark_jitter: Optional[float] = None
    luminance_mean: Optional[float] = None
    faces_detected: Optional[int] = 1
    flags: List[Union[IntegrityFlagItem, Dict[str, Any]]] = Field(default_factory=list)
    challenge: Optional[Dict[str, Any]] = None
    seq: Optional[int] = None
    hmac: Optional[str] = None


class TelemetryMessage(BaseModel):
    type: Literal["telemetry"] = "telemetry"
    t: float = Field(..., ge=0, description="Seconds elapsed since interview start")
    eye_contact_ratio: Optional[float] = Field(
        default=None, ge=0.0, le=1.0, description="Fraction of frames in last 1s looking at camera"
    )
    posture_score: Optional[float] = Field(
        default=None, ge=0.0, le=1.0, description="0..1 posture quality score"
    )
    head_pose: Optional[HeadPose] = Field(
        default=None, description="Head orientation angles (yaw, pitch, roll)"
    )
    expression: Optional[FacialExpression] = Field(
        default=None, description="Facial blendshapes"
    )
    distraction_flags: List[DistractionFlag] = Field(
        default_factory=list, description="Distraction flags detected in window"
    )
    face_present: bool = Field(default=True, description="Whether face was detected")
    fps: int = Field(default=30, ge=0, description="Video processing frame rate")
    integrity: Optional[IntegrityPayload] = Field(
        default=None, description="Signed device and anti-spoof integrity telemetry"
    )


class TranscriptChunkMessage(BaseModel):
    type: Literal["transcript_chunk"] = "transcript_chunk"
    text: str = Field(..., min_length=1, description="Transcribed speech text")
    is_final: bool = Field(default=False, description="Whether transcript chunk is finalized")
    t: float = Field(..., ge=0, description="Timestamp in seconds relative to start")


class AnswerCompleteMessage(BaseModel):
    type: Literal["answer_complete"] = "answer_complete"
    turn_id: str = Field(..., min_length=1, description="Turn ID being answered")


class EndInterviewMessage(BaseModel):
    type: Literal["end_interview"] = "end_interview"
    reason: Optional[str] = Field(default=None, description="Optional cancellation reason")


class PingMessage(BaseModel):
    type: Literal["ping"] = "ping"
    timestamp: Optional[float] = None


class PongMessage(BaseModel):
    type: Literal["pong"] = "pong"
    timestamp: Optional[float] = None


class ChallengeResultMessage(BaseModel):
    type: Literal["challenge_result"] = "challenge_result"
    challenge_id: str
    nonce: str
    passed: bool
    score: float = 1.0


class IntegrityEventMessage(BaseModel):
    type: Literal["integrity_event"] = "integrity_event"
    event_type: str
    details: Dict[str, Any] = Field(default_factory=dict)
    t: float = Field(default=0.0, ge=0)


ClientWSMessage = Annotated[
    Union[
        TelemetryMessage,
        TranscriptChunkMessage,
        AnswerCompleteMessage,
        EndInterviewMessage,
        PingMessage,
        PongMessage,
        ChallengeResultMessage,
        IntegrityEventMessage,
    ],
    Field(discriminator="type"),
]


# ==============================================================================
# Server -> Client Messages
# ==============================================================================


class SessionReadyMessage(BaseModel):
    type: Literal["session_ready"] = "session_ready"
    session_id: str
    message: str = "Interview session ready"
    hmac_key: Optional[str] = None
    session_salt: Optional[str] = None


class ChallengeMessage(BaseModel):
    type: Literal["challenge"] = "challenge"
    challenge_id: str
    action: str
    prompt: str
    nonce: str
    timeout_sec: float = 8.0


class PauseIntegrityMessage(BaseModel):
    type: Literal["pause_integrity"] = "pause_integrity"
    reason: str
    grace_seconds: float = 30.0
    voice_prompt: str = "Camera lost, please restore it"


class ResumeIntegrityMessage(BaseModel):
    type: Literal["resume_integrity"] = "resume_integrity"
    message: str = "Camera feed restored"


class QuestionMessage(BaseModel):
    type: Literal["question"] = "question"
    turn_id: str
    text: str
    topic: str
    difficulty: str


class AckMessage(BaseModel):
    type: Literal["ack"] = "ack"
    received_type: str
    t: Optional[float] = None


class InterviewCompleteMessage(BaseModel):
    type: Literal["interview_complete"] = "interview_complete"
    session_id: str
    evaluation_id: str


class ErrorMessage(BaseModel):
    type: Literal["error"] = "error"
    code: str
    message: str



ServerWSMessage = Annotated[
    Union[
        SessionReadyMessage,
        QuestionMessage,
        AckMessage,
        InterviewCompleteMessage,
        ErrorMessage,
        PongMessage,
        ChallengeMessage,
        PauseIntegrityMessage,
        ResumeIntegrityMessage,
    ],
    Field(discriminator="type"),
]
