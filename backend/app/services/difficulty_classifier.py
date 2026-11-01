"""
Difficulty Classifier Service (§Q4).
Evaluates whether a question matches the target difficulty tier and flags
questions that exceed the allowed seniority ceiling (e.g. Staff CAP theorem questions given to Mid).
"""

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.seniority_profiles import (
    DIFFICULTY_LABEL_MAP,
    get_difficulty_label,
    get_seniority_profile,
)

logger = logging.getLogger("uvicorn.error")
settings = get_settings()


class DifficultyClassification(BaseModel):
    estimated_tier: float = Field(..., description="Estimated difficulty on 1.0..5.0 scale")
    estimated_label: str = Field(..., description="Easy, Easy-Medium, Medium, Medium-Hard, Hard/Expert")
    is_too_hard_for_level: bool = Field(..., description="True if estimated_tier > level's maximum allowed range")
    detected_forbidden_topics: List[str] = Field(default_factory=list)
    reason: str = Field(...)


# Heuristic rule patterns for fast, deterministic classification
TIER_INDICATORS = {
    5.0: [
        "raft", "paxos", "distributed consensus", "consensus protocol", "cap theorem",
        "pacelc", "byzantine fault", "network partition", "network partitions",
        "cell-based architecture", "multi-region active-active", "multi-region sharding",
        "eventual-consistency lag", "cross-system reliability", "two-phase commit across datacenters",
    ],
    4.0: [
        "strangler fig", "saga pattern", "transactional outbox", "monolith decomposition",
        "cpu flamegraph", "garbage collection tuning", "heap dump", "rto", "rpo",
        "multi-cluster", "zero-trust", "point-in-time recovery", "flamegraph",
    ],
    3.0: [
        "cache stampede", "thundering herd", "b-tree", "composite index", "explain analyze",
        "dead-letter queue", "circuit breaker", "read committed", "serializable", "optimistic locking",
        "pessimistic locking", "cursor-based pagination", "idempotency key", "token blacklist",
        "connection pool exhaustion", "distributed tracing", "opentelemetry", "expand and contract",
    ],
    2.0: [
        "caching", "redis", "ttl", "jwt", "refresh token", "index", "indexes", "n+1",
        "inner join", "left join", "unit test", "integration test", "mock", "webhook",
        "presigned url", "dockerfile", "component re-rendering", "usememo", "usecallback",
    ],
    1.0: [
        "what is the difference between get and post", "http status codes",
        "what does http 404", "basic sql", "what is a list", "what is a dictionary",
        "git add", "git commit", "let vs const", "what is props",
    ],
}


def _classify_heuristic(question_text: str) -> float:
    """Classify question difficulty using keyword and phrasing heuristics."""
    q_lower = question_text.lower()

    # Check Tier 5 (Hard/Expert)
    for kw in TIER_INDICATORS[5.0]:
        pattern = r"(?<!\w)" + re.escape(kw) + r"(?!\w)"
        if re.search(pattern, q_lower):
            return 5.0

    # Check Tier 4 (Medium-Hard / Senior)
    for kw in TIER_INDICATORS[4.0]:
        pattern = r"(?<!\w)" + re.escape(kw) + r"(?!\w)"
        if re.search(pattern, q_lower):
            return 4.0

    # Check Tier 3 (Medium)
    for kw in TIER_INDICATORS[3.0]:
        pattern = r"(?<!\w)" + re.escape(kw) + r"(?!\w)"
        if re.search(pattern, q_lower):
            return 3.0

    # Check Tier 1 (Easy / Definitions)
    for kw in TIER_INDICATORS[1.0]:
        if kw in q_lower:
            return 1.0

    # Check Tier 2 (Easy-Medium / Mid practical)
    for kw in TIER_INDICATORS[2.0]:
        pattern = r"(?<!\w)" + re.escape(kw) + r"(?!\w)"
        if re.search(pattern, q_lower):
            return 2.5

    # Default to practical Mid-level difficulty
    return 2.5


async def classify_difficulty(
    question_text: str,
    target_seniority: str = "Mid",
    role: str = "Backend",
    candidate_resume_tags: Optional[List[str]] = None,
    use_llm: bool = False,
) -> DifficultyClassification:
    """
    Evaluate whether question_text matches target_seniority.
    Flags questions that exceed the seniority ceiling or contain forbidden topics (§Q4).
    """
    profile = get_seniority_profile(target_seniority)
    evidence_set = set(candidate_resume_tags or [])

    # 1. Check for forbidden topics first
    forbidden_hits: List[str] = []
    q_lower = question_text.lower()
    for forb in profile.forbidden_topics:
        pattern = r"(?<!\w)" + re.escape(forb.lower()) + r"(?!\w)"
        if re.search(pattern, q_lower):
            if not any(forb.lower() in ev.lower() for ev in evidence_set):
                forbidden_hits.append(forb)

    # 2. Estimate numeric difficulty tier
    estimated_tier = _classify_heuristic(question_text)

    # Optional LLM evaluation in live non-test environments if requested
    if use_llm and not os.environ.get("PYTEST_CURRENT_TEST") and settings.GOOGLE_API_KEY:
        try:
            from langchain_google_genai import ChatGoogleGenerativeAI
            llm = ChatGoogleGenerativeAI(
                model="gemini-2.5-flash",
                google_api_key=settings.GOOGLE_API_KEY,
                temperature=0.0,
            )
            prompt = (
                f"Classify the difficulty of this technical interview question for a {role} candidate:\n"
                f"Question: \"{question_text}\"\n\n"
                f"Rate on a scale of 1.0 to 5.0:\n"
                f"1.0 = Junior definition/basics\n"
                f"2.0 = Easy-Medium practical feature usage\n"
                f"3.0 = Medium feature optimization, caching, indexing\n"
                f"4.0 = Medium-Hard service architecture, failover, profiling\n"
                f"5.0 = Hard/Staff global consensus, multi-region distributed theory\n"
                f"Respond with JSON: {{\"tier\": float, \"reason\": string}}"
            )
            response = await llm.ainvoke(prompt)
            content = response.content
            if isinstance(content, str):
                match = re.search(r"\{.*\}", content, re.DOTALL)
                if match:
                    parsed = json.loads(match.group(0))
                    tier_val = float(parsed.get("tier", estimated_tier))
                    estimated_tier = max(1.0, min(5.0, tier_val))
        except Exception as exc:
            logger.info("LLM difficulty classification fallback to heuristic: %s", exc)

    label = get_difficulty_label(estimated_tier)

    # If forbidden topics are present without resume evidence, force tier up to 5.0 (Too Hard)
    if forbidden_hits:
        estimated_tier = max(estimated_tier, 5.0)
        label = get_difficulty_label(estimated_tier)
        is_too_hard = True
        reason = f"Contains forbidden topics for {profile.name} without resume evidence: {', '.join(forbidden_hits)}"
    else:
        is_too_hard = estimated_tier > profile.max_difficulty
        reason = (
            f"Estimated difficulty {estimated_tier} ({label}) exceeds {profile.name} cap {profile.max_difficulty}"
            if is_too_hard else
            f"Question difficulty {estimated_tier} ({label}) within allowed {profile.name} range [{profile.min_difficulty}, {profile.max_difficulty}]"
        )

    return DifficultyClassification(
        estimated_tier=estimated_tier,
        estimated_label=label,
        is_too_hard_for_level=is_too_hard,
        detected_forbidden_topics=forbidden_hits,
        reason=reason,
    )

