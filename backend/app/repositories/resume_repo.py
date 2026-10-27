from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union
from bson import ObjectId
from pymongo import DESCENDING

from app.core.database import get_collection


class ResumeRepository:
    """Repository handling all reads and writes for the 'resumes' collection."""

    @property
    def collection(self) -> Any:
        return get_collection("resumes")

    async def create_resume(
        self,
        user_id: str,
        filename: str,
        file_size: int,
        raw_text: str,
        parsed_profile: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Insert a newly parsed candidate resume document."""
        now = datetime.now(timezone.utc)
        resume_id = str(ObjectId())

        doc: Dict[str, Any] = {
            "_id": ObjectId(resume_id),
            "id": resume_id,
            "user_id": str(user_id),
            "filename": filename,
            "file_size": file_size,
            "raw_text": raw_text,
            "parsed_profile": parsed_profile,
            "parsed_data": parsed_profile,
            "created_at": now,
        }

        await self.collection.insert_one(doc)
        return self._format(doc)

    async def list_by_user(self, user_id: str, limit: int = 100) -> List[Dict[str, Any]]:
        """List resumes owned by the authenticated candidate, sorted by creation date desc."""
        # Use projection to avoid loading huge raw_text field when listing
        projection = {"raw_text": 0}
        cursor = self.collection.find({"user_id": str(user_id)}, projection).sort("created_at", DESCENDING).limit(limit)
        docs = await cursor.to_list(length=limit)
        return [self._format(d) for d in docs]

    async def get_by_id_and_user(self, resume_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve a resume by ID ensuring strict user ownership isolation."""
        filter_doc: Dict[str, Any] = {"user_id": str(user_id)}
        if ObjectId.is_valid(resume_id):
            doc = await self.collection.find_one({"_id": ObjectId(resume_id), **filter_doc})
        else:
            doc = None

        if doc is None:
            doc = await self.collection.find_one({"_id": resume_id, **filter_doc})
        if doc is None:
            doc = await self.collection.find_one({"id": resume_id, **filter_doc})

        if doc is None:
            return None
        return self._format(doc)

    async def update_profile(
        self, resume_id: str, user_id: str, profile_update: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Update parsed profile on a resume belonging to the authenticated user."""
        resume = await self.get_by_id_and_user(resume_id, user_id)
        if not resume:
            return None

        target_id: Union[ObjectId, str] = ObjectId(resume["id"]) if ObjectId.is_valid(resume["id"]) else resume["id"]
        await self.collection.update_one(
            {"_id": target_id, "user_id": str(user_id)},
            {"$set": {"parsed_profile": profile_update, "parsed_data": profile_update}},
        )
        resume["parsed_profile"] = profile_update
        resume["parsed_data"] = profile_update
        return resume

    def _format(self, doc: Dict[str, Any]) -> Dict[str, Any]:
        data = dict(doc)
        doc_id = str(data.get("_id") or data.get("id"))
        data["id"] = doc_id
        if "_id" in data:
            data["_id"] = doc_id
        if "created_at" in data and isinstance(data["created_at"], datetime) and data["created_at"].tzinfo is None:
            data["created_at"] = data["created_at"].replace(tzinfo=timezone.utc)
        return data


resume_repo = ResumeRepository()
