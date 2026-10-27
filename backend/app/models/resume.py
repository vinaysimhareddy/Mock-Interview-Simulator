from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class WorkHistoryItem(BaseModel):
    company: str = Field(..., description="Company name")
    title: str = Field(..., description="Job title")
    start: Optional[str] = Field(None, description="Start date")
    end: Optional[str] = Field(None, description="End date or 'Present'")
    highlights: List[str] = Field(default_factory=list, description="Key project highlights")


class ParsedProfile(BaseModel):
    technical_skills: List[str] = Field(default_factory=list, description="Technical skills extracted")
    experience_years: float = Field(default=0.0, description="Total estimated professional experience in years")
    work_history: List[WorkHistoryItem] = Field(default_factory=list, description="Structured work history")
    skills: List[str] = Field(default_factory=list, description="Alias for skills")
    summary: Optional[str] = Field(default=None, description="Summary")
    experience: List[Dict[str, Any]] = Field(default_factory=list, description="Structured experience alias")
    education: List[Dict[str, Any]] = Field(default_factory=list, description="Structured education alias")

    def model_post_init(self, __context: Any) -> None:
        if not self.skills and self.technical_skills:
            self.skills = list(self.technical_skills)
        elif not self.technical_skills and self.skills:
            self.technical_skills = list(self.skills)
        if not self.experience and self.work_history:
            self.experience = [
                {
                    "title": item.title,
                    "company": item.company,
                    "duration": f"{item.start or ''} - {item.end or 'Present'}".strip(" -"),
                    "description": "; ".join(item.highlights) if item.highlights else "",
                }
                for item in self.work_history
            ]


class ExperienceItem(BaseModel):
    title: str = Field(..., description="Job title or position")
    company: str = Field(..., description="Company name")
    duration: Optional[str] = Field(None, description="Time period or years")
    description: Optional[str] = Field(None, description="Key duties and achievements")


class EducationItem(BaseModel):
    degree: str = Field(..., description="Degree or certification name")
    institution: str = Field(..., description="University, college, or issuer")
    year: Optional[str] = Field(None, description="Graduation year or dates")


ParsedResumeData = ParsedProfile


class ResumeUpdate(BaseModel):
    skills: Optional[List[str]] = None
    summary: Optional[str] = None


class ResumeInDB(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str = Field(..., alias="_id", description="Unique resume ID")
    user_id: str = Field(..., description="Owner user ID")
    filename: str = Field(..., description="Uploaded file name")
    file_size: int = Field(default=0, description="File size in bytes")
    raw_text: Optional[str] = Field(default="", description="Raw text parsed from PDF")
    parsed_profile: ParsedProfile = Field(..., description="Structured parsed profile")
    parsed_data: Optional[ParsedProfile] = Field(default=None, description="Alias for parsed profile")
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc), description="Upload timestamp (UTC)"
    )

    def model_post_init(self, __context: Any) -> None:
        if not self.parsed_data and self.parsed_profile:
            self.parsed_data = self.parsed_profile


class ResumeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str = Field(..., description="Unique resume ID")
    user_id: str = Field(..., description="Owner user ID")
    filename: str = Field(..., description="Uploaded file name")
    file_size: int = Field(default=0, description="File size in bytes")
    raw_text: Optional[str] = Field(default="", description="Raw text parsed from PDF")
    parsed_profile: Optional[ParsedProfile] = Field(default=None, description="Structured parsed profile")
    parsed_data: Optional[ParsedProfile] = Field(default=None, description="Alias for parsed profile")
    created_at: datetime = Field(..., description="Upload timestamp (UTC)")

    def model_post_init(self, __context: Any) -> None:
        if not self.parsed_data and self.parsed_profile:
            self.parsed_data = self.parsed_profile
        elif not self.parsed_profile and self.parsed_data:
            self.parsed_profile = self.parsed_data

