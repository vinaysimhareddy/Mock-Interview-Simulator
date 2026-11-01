from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union
import uuid
from bson import ObjectId
from pymongo import DESCENDING

from app.core.database import get_collection


class SessionRepository:
    """Repository handling all reads and writes for the 'interview_sessions' collection."""

    @property
    def collection(self) -> Any:
        return get_collection("interview_sessions")

    async def create_session(
        self,
        user_id: str,
        job_role: str,
        target_seniority: str,
        difficulty: str = "Adaptive",
        integrity_mode: str = "strict",
        resume_id: Optional[str] = None,
        max_questions: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Create a new interview session record in interview_sessions."""
        session_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)

        doc: Dict[str, Any] = {
            "_id": session_id,
            "id": session_id,
            "user_id": str(user_id),
            "resume_id": resume_id,
            "job_role": job_role,
            "role": job_role,
            "target_seniority": target_seniority,
            "seniority": target_seniority,
            "difficulty": difficulty or "Adaptive",
            "integrity_mode": integrity_mode or "strict",
            "max_questions": max_questions,
            "status": "CREATED",
            "session_status": "created",
            "created_at": now,
            "started_at": None,
            "ended_at": None,
            "current_question_index": 0,
            "transcript": [],
            "video_telemetry_time_series": [],
            "interview_state": {},
        }

        await self.collection.insert_one(doc)
        return self._format(doc)

    async def list_by_user(self, user_id: str, limit: int = 100) -> List[Dict[str, Any]]:
        """List sessions for a specific user using projection to avoid loading huge transcript/telemetry arrays."""
        projection = {
            "transcript": 0,
            "video_telemetry_time_series": 0,
            "interview_state.conversation_history": 0,
        }
        cursor = self.collection.find({"user_id": str(user_id)}, projection).sort("created_at", DESCENDING).limit(limit)
        docs = await cursor.to_list(length=limit)
        return [self._format(d) for d in docs]

    async def get_by_id_and_user(self, session_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve session ensuring strict user ownership isolation. Returns None on ownership mismatch."""
        filter_doc: Dict[str, Any] = {"user_id": str(user_id)}
        doc = await self.collection.find_one({"_id": session_id, **filter_doc})
        if doc is None:
            doc = await self.collection.find_one({"id": session_id, **filter_doc})

        if doc is None:
            return None
        return self._format(doc)

    async def get_by_id(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve session by ID regardless of user (used internally by WebSocket worker)."""
        doc = await self.collection.find_one({"_id": session_id})
        if doc is None:
            doc = await self.collection.find_one({"id": session_id})
        if doc is None:
            return None
        return self._format(doc)

    async def update_status(
        self,
        session_id: str,
        user_id: str,
        status: str,
        extra_fields: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Update session lifecycle status with user isolation."""
        session = await self.get_by_id_and_user(session_id, user_id)
        if not session:
            return None

        now = datetime.now(timezone.utc)
        update_set: Dict[str, Any] = {
            "status": status,
            "session_status": status.lower(),
            "updated_at": now,
        }
        if status in ("IN_PROGRESS", "in_progress") and not session.get("started_at"):
            update_set["started_at"] = now
        elif status in ("COMPLETED", "TERMINATED", "completed", "terminated"):
            update_set["ended_at"] = now

        if extra_fields:
            update_set.update(extra_fields)

        await self.collection.update_one(
            {"_id": session["id"], "user_id": str(user_id)},
            {"$set": update_set},
        )
        session.update(update_set)
        return session

    async def update_interview_state(
        self,
        session_id: str,
        state: Any,
        extra_fields: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Update active interview state dictionary and current question index."""
        now = datetime.now(timezone.utc)
        update_set: Dict[str, Any] = {
            "interview_state": state,
            "current_question_index": state.get("current_question_index", 0),
            "updated_at": now,
        }
        if extra_fields:
            update_set.update(extra_fields)

        target_filter = {"_id": session_id}
        await self.collection.update_one(target_filter, {"$set": update_set})

    async def add_transcript_turn(
        self, session_id: str, user_id: str, turn: Dict[str, Any]
    ) -> None:
        """Push a candidate or interviewer transcript turn to session document."""
        await self.collection.update_one(
            {"_id": session_id, "user_id": str(user_id)},
            {"$push": {"transcript": turn}},
        )

    async def push_telemetry_summary(
        self, session_id: str, summary_points: List[Dict[str, Any]]
    ) -> None:
        """Push downsampled video telemetry points to session document."""
        if not summary_points:
            return
        await self.collection.update_one(
            {"_id": session_id},
            {"$push": {"video_telemetry_time_series": {"$each": summary_points}}},
        )

    async def record_challenges(self, session_id: str, passed: bool) -> None:
        """Increment challenge counters."""
        field = "challenges_passed" if passed else "challenges_failed"
        await self.collection.update_one({"_id": session_id}, {"$inc": {field: 1}})

    async def record_camera_name(self, session_id: str, camera_name: str) -> None:
        """Update active camera hardware label."""
        await self.collection.update_one(
            {"_id": session_id},
            {"$set": {"camera_device_name": camera_name}},
        )

    async def record_integrity_result(
        self, session_id: str, score: float, events: List[Dict[str, Any]]
    ) -> None:
        """Persist final integrity score and event ledger."""
        await self.collection.update_one(
            {"_id": session_id},
            {"$set": {"integrity_score": score, "integrity_events": events}},
        )

    def _format(self, doc: Dict[str, Any]) -> Dict[str, Any]:
        data = dict(doc)
        doc_id = str(data.get("_id") or data.get("id"))
        data["id"] = doc_id
        if "_id" in data:
            data["_id"] = doc_id
        for field in ("created_at", "started_at", "ended_at", "updated_at"):
            if field in data and isinstance(data[field], datetime) and data[field].tzinfo is None:
                data[field] = data[field].replace(tzinfo=timezone.utc)
        return data


session_repo = SessionRepository()
