from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class HeadPose(BaseModel):
    """3D head orientation angles in degrees."""
    pitch: float = Field(..., description="Head pitch (up/down rotation) in degrees")
    yaw: float = Field(..., description="Head yaw (left/right rotation) in degrees")
    roll: float = Field(..., description="Head roll (side tilt) in degrees")


class TelemetryMetrics(BaseModel):
    """Real-time computer vision and vocal biomarkers."""
    eye_contact_ratio: float = Field(
        ..., ge=0.0, le=1.0, description="Fraction of time maintaining camera gaze"
    )
    blink_rate: float = Field(
        ..., ge=0.0, description="Estimated blink rate per minute from eye aspect ratio"
    )
    head_pose: HeadPose = Field(..., description="Head rotation angles")
    facial_tension: float = Field(
        ..., ge=0.0, le=1.0, description="Facial tension proxy calculated from brow and jaw distances"
    )
    is_speaking: bool = Field(..., description="VAD vocal activity state")
    speech_rate_wpm: float = Field(
        ..., ge=0.0, description="Estimated speech rate (words/syllables per minute)"
    )
    speech_pause_ratio: float = Field(
        ..., ge=0.0, le=1.0, description="Fraction of silence/pause in sample window"
    )
    audio_energy_rms: float = Field(
        ..., ge=0.0, le=1.0, description="Audio root-mean-square energy level"
    )


class TelemetryPacket(BaseModel):
    """1-second aggregated telemetry packet transmitted from candidate client."""
    session_id: str = Field(..., description="Target interview session UUID")
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="Packet emission timestamp in UTC",
    )
    metrics: TelemetryMetrics = Field(..., description="Aggregated multimodal metrics")


class TelemetryBucketDoc(BaseModel):
    """MongoDB time-bucketed document (1 document per session per minute)."""
    model_config = ConfigDict(from_attributes=True)

    session_id: str = Field(..., description="Interview session UUID")
    minute_bucket: str = Field(..., description="Minute-level bucket timestamp (ISO UTC)")
    packet_count: int = Field(default=0, description="Count of 1-second packets in bucket")
    packets: List[Dict[str, Any]] = Field(
        default_factory=list, description="Array of 1-second telemetry packets"
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="Bucket initialization timestamp",
    )
