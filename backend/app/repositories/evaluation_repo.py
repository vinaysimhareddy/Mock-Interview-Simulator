from datetime import datetime, timezone
from typing import Any, Dict, Optional
from app.core.database import get_collection


class EvaluationRepository:
    """Repository handling persistence for final scores, report cards, and evaluations."""

    @property
    def collection(self) -> Any:
        return get_collection("evaluations")

    async def save_evaluation(
        self,
        session_id: str,
        user_id: str,
        report: Dict[str, Any],
        final_score: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Upsert the final evaluation and score report for a completed session."""
        now = datetime.now(timezone.utc)

        doc: Dict[str, Any] = {
            "session_id": str(session_id),
            "user_id": str(user_id),
            "report": report,
            "final_score": final_score,
            "overall_score": report.get("overall_score", final_score),
            "technical_competency_score": report.get("technical_competency_score"),
            "communication_score": report.get("communication_score"),
            "non_verbal_score": report.get("non_verbal_score"),
            "dimension_breakdown": report.get("dimension_breakdown", {}),
            "strengths": report.get("strengths", []),
            "improvements": report.get("improvements", []),
            "detailed_summary": report.get("detailed_summary"),
            "updated_at": now,
        }

        await self.collection.update_one(
            {"session_id": str(session_id)},
            {
                "$set": doc,
                "$setOnInsert": {"created_at": now},
            },
            upsert=True,
        )
        return doc

    async def get_by_session_and_user(
        self, session_id: str, user_id: str
    ) -> Optional[Dict[str, Any]]:
        """Retrieve evaluation report ensuring strict candidate ownership isolation."""
        doc = await self.collection.find_one({"session_id": str(session_id), "user_id": str(user_id)})
        if not doc:
            return None
        return dict(doc)


evaluation_repo = EvaluationRepository()
