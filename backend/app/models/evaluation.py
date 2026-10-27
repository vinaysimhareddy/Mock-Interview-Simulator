from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class EvaluationDimension(BaseModel):
    name: str = Field(..., description="Name of competency dimension")
    score: int = Field(..., ge=0, le=100, description="Score 0-100")
    feedback: str = Field(..., description="Actionable critique and qualitative notes")


class EvaluationBase(BaseModel):
    session_id: str = Field(..., description="ID of evaluated interview session")
    technical_competency_score: int = Field(..., ge=0, le=100, description="Technical depth (0-100)")
    communication_score: int = Field(..., ge=0, le=100, description="Communication clarity & structure (0-100)")
    non_verbal_score: int = Field(..., ge=0, le=100, description="Non-verbal composure & gaze (0-100)")
    overall_score: int = Field(..., ge=0, le=100, description="Weighted composite score (0-100)")
    dimension_breakdown: Dict[str, Any] = Field(
        default_factory=dict, description="Detailed score breakdowns by competency area"
    )
    strengths: List[str] = Field(default_factory=list, description="Key candidate strengths observed")
    improvements: List[str] = Field(default_factory=list, description="Targeted recommendations for growth")
    detailed_summary: str = Field(..., description="Comprehensive multi-paragraph performance evaluation")


class EvaluationCreate(EvaluationBase):
    pass


class EvaluationInDB(EvaluationBase):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str = Field(..., alias="_id", description="Unique evaluation document ID")
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="Timestamp evaluation was generated (UTC)",
    )


class EvaluationResponse(EvaluationBase):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str = Field(..., description="Unique evaluation ID")
    created_at: datetime = Field(..., description="Timestamp evaluation was generated (UTC)")
