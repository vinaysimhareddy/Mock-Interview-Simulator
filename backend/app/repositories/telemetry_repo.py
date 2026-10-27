from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import uuid
from app.core.database import get_collection


class TelemetryRepository:
    """Repository handling persistence for 1 Hz camera and behavior telemetry samples."""

    @property
    def collection(self) -> Any:
        return get_collection("telemetry_samples")

    async def insert_telemetry_bucket(
        self,
        session_id: str,
        bucket_index: int,
        samples: List[Dict[str, Any]],
        bucket_start: Optional[float] = None,
    ) -> str:
        """Insert a single bucket of telemetry samples into telemetry_samples collection."""
        if not samples:
            return ""

        now = datetime.now(timezone.utc)
        first_t = bucket_start if bucket_start is not None else float(samples[0].get("t", 0.0))
        bucket_id = str(uuid.uuid4())

        bucket_doc: Dict[str, Any] = {
            "_id": bucket_id,
            "session_id": session_id,
            "bucket_index": bucket_index,
            "bucket_start": first_t,
            "sample_count": len(samples),
            "samples": samples,
            "created_at": now,
        }

        await self.collection.insert_one(bucket_doc)
        return bucket_id

    async def batch_insert_buckets(self, buckets: List[Dict[str, Any]]) -> None:
        """Insert a batch of telemetry bucket documents using insert_many."""
        if not buckets:
            return
        await self.collection.insert_many(buckets)

    async def get_session_buckets_metadata(
        self, session_id: str, limit: int = 1000
    ) -> List[Dict[str, Any]]:
        """Retrieve bucket headers using projection to exclude massive samples arrays."""
        projection = {"samples": 0}
        cursor = self.collection.find({"session_id": session_id}, projection).sort("bucket_index", 1).limit(limit)
        return await cursor.to_list(length=limit)

    async def get_full_session_samples(
        self, session_id: str, limit_buckets: int = 200
    ) -> List[Dict[str, Any]]:
        """Retrieve all individual samples flattened across buckets for session reporting."""
        cursor = self.collection.find({"session_id": session_id}).sort("bucket_index", 1).limit(limit_buckets)
        buckets = await cursor.to_list(length=limit_buckets)
        all_samples: List[Dict[str, Any]] = []
        for b in buckets:
            all_samples.extend(b.get("samples", []))
        return all_samples


telemetry_repo = TelemetryRepository()
