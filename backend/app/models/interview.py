from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class AnswerSubmission(BaseModel):
    """Schema for candidate submitting an answer to current question."""
    answer: Optional[str] = Field(default="", description="Candidate response text or transcribed speech")
    status: Optional[str] = Field(default="answered", description="answered | skipped")
    turn_id: Optional[str] = None
    response_latency_ms: Optional[float] = None
    answer_duration_sec: Optional[float] = None
    reason: Optional[str] = None  # silence | cap | user


class QuestionEvaluation(BaseModel):
    """Rubric evaluation of candidate response."""
    score: float = Field(..., ge=0.0, le=10.0, description="Overall answer score (0-10)")
    technical_accuracy: float = Field(..., ge=0.0, le=10.0, description="Technical correctness score")
    clarity: float = Field(..., ge=0.0, le=10.0, description="Communication clarity score")
    completeness: float = Field(..., ge=0.0, le=10.0, description="Completeness of reasoning")
    feedback: str = Field(..., description="Actionable critique for the candidate")
    encouragement: Optional[str] = Field(None, description="Supportive coaching remark based on telemetry")


class CategoryScores(BaseModel):
    """Categorical performance breakdown."""
    technical: float = Field(..., ge=0.0, le=100.0)
    communication: float = Field(..., ge=0.0, le=100.0)
    composure: float = Field(..., ge=0.0, le=100.0)



class IntegrityTimelineEvent(BaseModel):
    """Timestamped audit flag in candidate session (§7)."""
    flag: str = Field(..., description="Integrity flag identifier (e.g. static_feed, face_missing)")
    timestamp: float = Field(..., description="Offset or epoch timestamp in seconds")
    duration_sec: float = Field(default=1.0, description="Duration flag persisted in seconds")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0, description="Detection confidence 0-1")
    details: Optional[Dict[str, Any]] = Field(default=None, description="Optional diagnostic attributes")


class IntegritySummary(BaseModel):
    """Post-interview integrity evaluation summary (§7)."""
    verdict: str = Field(..., description="Overall verdict: Verified | Verified with warnings | Not verified")
    integrity_score: float = Field(..., ge=0.0, le=100.0, description="Final deterministic integrity score (0-100)")
    camera_device_name: str = Field(
        default="Physical Built-in Webcam / USB Camera",
        description="Active physical camera device descriptor",
    )
    challenges_passed: int = Field(default=0, ge=0, description="Active liveness challenges successfully passed")
    challenges_failed: int = Field(default=0, ge=0, description="Active liveness challenges failed")
    face_present_percentage: float = Field(
        default=100.0,
        ge=0.0,
        le=100.0,
        description="Percentage of interview session with human face detected",
    )
    pauses_count: int = Field(default=0, ge=0, description="Number of times session was paused due to camera loss")
    camera_loss_incidents: int = Field(default=0, ge=0, description="Number of distinct camera disconnects or occlusions")
    timeline_events: List[IntegrityTimelineEvent] = Field(
        default_factory=list,
        description="Chronological audit timeline of flagged events",
    )
    excluded_segments_count: int = Field(
        default=0,
        ge=0,
        description="Telemetry frames excluded from non-verbal metrics due to active integrity flags",
    )
    non_verbal_excluded_note: str = Field(
        default=(
            "Non-verbal scores (eye contact, posture) are computed only from verified-live segments; "
            "segments with active integrity flags were excluded."
        ),
        description="Explicit notice regarding non-verbal metric filtering",
    )
    disclaimer: str = Field(
        default=(
            "Integrity checks are automated heuristics and may produce false positives. "
            "Review flagged events before drawing conclusions."
        ),
        description="Automated heuristic disclaimer",
    )


class QuestionCoverageItem(BaseModel):
    """Detailed metadata for an individual question turn in the final report (§Q7)."""
    question_index: int
    question: str
    candidate_answer: str = ""
    planner_action: str
    target_topic: str
    source_description: str
    sources_used: List[Dict[str, Any]] = Field(default_factory=list)
    difficulty_tier: float
    difficulty_label: str
    score: Optional[float] = None
    feedback: Optional[str] = None


class DifficultyProgressionPoint(BaseModel):
    """Point on the candidate difficulty progression timeline (§Q7)."""
    question_index: int
    difficulty_tier: float
    difficulty_label: str
    score: Optional[float] = None
    change: Optional[str] = None  # "UPGRADE" | "DOWNGRADE" | "UNCHANGED"


class FinalReport(BaseModel):
    """Comprehensive post-interview scorecard."""
    overall_score: float = Field(..., ge=0.0, le=100.0)
    category_scores: CategoryScores
    hiring_recommendation: str = Field(..., description="Strong Hire | Hire | Leaning Hire | No Hire")
    strengths: List[str] = Field(default_factory=list)
    weaknesses: List[str] = Field(default_factory=list)
    executive_summary: str = Field(...)
    integrity_summary: Optional[IntegritySummary] = Field(
        default=None,
        description="Formal camera integrity and biometric verification report section (§7)",
    )
    question_coverage: List[QuestionCoverageItem] = Field(
        default_factory=list,
        description="Detailed record of all asked questions, their sources, evaluated difficulty, and candidate performance (§Q7)",
    )
    difficulty_progression: List[DifficultyProgressionPoint] = Field(
        default_factory=list,
        description="Timeline of difficulty tier progression throughout the interview (§Q7)",
    )


class InterviewStepResponse(BaseModel):
    """Payload returned after candidate submits an answer."""
    session_id: str
    status: str
    current_question_index: int
    max_questions: int
    evaluation: Optional[QuestionEvaluation] = None
    next_question: Optional[str] = None
    difficulty: str
    difficulty_change: Optional[str] = None  # "UPGRADE" | "DOWNGRADE" | "UNCHANGED"
    final_report: Optional[FinalReport] = None
    current_action: Optional[str] = None
    question_sources: Optional[List[Dict[str, Any]]] = None
