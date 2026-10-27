from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import uuid
from app.core.database import get_collection


class IntegrityRepository:
    """Repository handling persistence for camera integrity and liveness events."""

    @property
    def collection(self) -> Any:
        return get_collection("integrity_events")

    async def record_event(
        self,
        session_id: str,
        event_type: str,
        t: float,
        confidence: float = 1.0,
        details: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Record an individual camera integrity or liveness event."""
        now = datetime.now(timezone.utc)
        event_id = str(uuid.uuid4())

        doc: Dict[str, Any] = {
            "_id": event_id,
            "session_id": session_id,
            "event_type": event_type,
            "t": t,
            "confidence": confidence,
            "details": details or {},
            "created_at": now,
        }

        await self.collection.insert_one(doc)
        return doc

    async def record_events_batch(self, session_id: str, events: List[Dict[str, Any]]) -> None:
        """Batch insert integrity events using insert_many."""
        if not events:
            return
        now = datetime.now(timezone.utc)
        docs = []
        for e in events:
            d = dict(e)
            d["session_id"] = session_id
            if "_id" not in d:
                d["_id"] = str(uuid.uuid4())
            if "created_at" not in d:
                d["created_at"] = now
            docs.append(d)
        await self.collection.insert_many(docs)

    async def list_by_session(self, session_id: str) -> List[Dict[str, Any]]:
        """List all integrity events for an interview session sorted chronologically."""
        cursor = self.collection.find({"session_id": session_id}).sort("t", 1)
        return await cursor.to_list(length=1000)


integrity_repo = IntegrityRepository()
