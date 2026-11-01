"""
Seniority Profiles and Difficulty Control Configuration (§Q4).
Defines starting difficulty tiers, allowed ranges, topic boundaries,
style prompts, and adaptation rules for Junior, Mid, Senior, and Staff levels.
"""

import re
from typing import Any, Dict, List, Optional, Set, Tuple


# Numeric difficulty to canonical label mapping
DIFFICULTY_LABEL_MAP: Dict[int, str] = {
    1: "Easy",
    2: "Easy-Medium",
    3: "Medium",
    4: "Medium-Hard",
    5: "Hard/Expert",
}


def get_difficulty_label(score: float) -> str:
    """Map numeric difficulty (1.0..5.0) to user-facing difficulty label."""
    if score < 1.5:
        return "Easy"
    elif score < 2.5:
        return "Easy-Medium"
    elif score < 3.5:
        return "Medium"
    elif score < 4.5:
        return "Medium-Hard"
    else:
        return "Hard/Expert"


class SeniorityProfile:
    def __init__(
        self,
        name: str,
        start_difficulty: float,
        allowed_range: Tuple[float, float],
        style_prompt: str,
        forbidden_topics: List[str],
        allowed_topics: List[str],
    ) -> None:
        self.name = name
        self.start_difficulty = start_difficulty
        self.min_difficulty, self.max_difficulty = allowed_range
        self.style_prompt = style_prompt
        self.forbidden_topics = forbidden_topics
        self.allowed_topics = allowed_topics

    def clamp_difficulty(self, value: float) -> float:
        """Clamp numeric difficulty to this level's allowed range."""
        return max(self.min_difficulty, min(self.max_difficulty, round(value, 2)))

    def is_topic_forbidden(self, text: str, resume_evidence_tags: Optional[Set[str]] = None) -> bool:
        """
        Check if text mentions a forbidden topic for this seniority.
        If the candidate's resume explicitly evidences that technology, it is permitted.
        """
        text_lower = text.lower()
        evidence = {t.lower() for t in (resume_evidence_tags or set())}

        for forbidden in self.forbidden_topics:
            pattern = r"(?<!\w)" + re.escape(forbidden.lower()) + r"(?!\w)"
            if re.search(pattern, text_lower):
                # Check if resume explicitly mentions this exact concept
                if not any(forbidden.lower() in ev or ev in forbidden.lower() for ev in evidence):
                    return True
        return False


SENIORITY_PROFILES: Dict[str, SeniorityProfile] = {
    "junior": SeniorityProfile(
        name="Junior",
        start_difficulty=1.0,
        allowed_range=(1.0, 2.0),
        style_prompt=(
            "Tone: encouraging, clear, educational. "
            "Focus: definitions, core syntax, basic debugging, simple data structures, small code reasoning. "
            "Question length: 1-2 concise sentences. "
            "DO NOT ask system design, distributed systems, or performance optimization at scale."
        ),
        forbidden_topics=[
            "system design", "distributed systems", "microservices architecture",
            "sharding", "replication lag", "consensus", "paxos", "raft",
            "cache stampede", "acid isolation levels", "multi-region",
            "circuit breaker", "eventual consistency", "cap theorem",
        ],
        allowed_topics=[
            "basic syntax", "functions", "loops", "data structures", "git basics",
            "http status codes", "basic sql queries", "error handling",
        ],
    ),
    "mid": SeniorityProfile(
        name="Mid",
        start_difficulty=2.0,
        allowed_range=(1.0, 4.0),
        style_prompt=(
            "Tone: professional, practical, inquisitive. "
            "Focus: practical implementation experience: how you built, debugged, and tested features. "
            "Key topics: REST/API design, SQL query indexing & optimization, caching strategies (Redis TTLs, invalidation), "
            "state management, connection pooling, automated unit/integration testing, and observability (logging, metrics). "
            "Question length: 2-3 focused sentences referring to their own experience. "
            "STRICT CAP: DO NOT ask about multi-region failover, Raft/Paxos consensus, CAP theorem proofs, "
            "network partitions, or distributed consensus unless their resume explicitly lists deep distributed systems work."
        ),
        forbidden_topics=[
            "network partitions", "network partition", "paxos", "raft", "distributed consensus",
            "consensus protocol", "cap theorem", "pacelc", "multi-region failover",
            "multi-region active-active", "eventual-consistency lag", "cell-based architecture",
            "multi-region sharding", "byzantine fault tolerance", "two-phase commit across datacenters",
        ],
        allowed_topics=[
            "caching", "redis", "database optimization", "indexes", "transactions",
            "rest api design", "idempotency", "message queues", "jwt auth",
            "observability", "unit testing", "connection pooling", "resilience patterns",
        ],
    ),
    "senior": SeniorityProfile(
        name="Senior",
        start_difficulty=3.0,
        allowed_range=(3.0, 5.0),
        style_prompt=(
            "Tone: peer-to-peer, architectural, trade-off oriented. "
            "Focus: service architecture, distributed data consistency (Saga, Outbox), high availability, "
            "failure recovery, performance profiling (flamegraphs, memory dumps), mentoring, and technical trade-offs. "
            "Question length: 2-3 sentences presenting realistic architectural constraints."
        ),
        forbidden_topics=[
            "org-wide platform strategy", "enterprise tech radar governance",
        ],
        allowed_topics=[
            "service architecture", "monolith decomposition", "scalability",
            "saga pattern", "transactional outbox", "performance profiling",
            "disaster recovery", "rto rpo", "code reviews", "mentorship",
        ],
    ),
    "staff": SeniorityProfile(
        name="Staff",
        start_difficulty=4.0,
        allowed_range=(4.0, 5.0),
        style_prompt=(
            "Tone: strategic, executive-level engineering, systems-thinking. "
            "Focus: cross-system reliability, multi-region architecture, global consensus, platform engineering as a product, "
            "chaos engineering, multi-tenant isolation, enterprise security, and long-term technical vision."
        ),
        forbidden_topics=[],
        allowed_topics=[
            "global consensus", "raft paxos", "multi-region active-active",
            "platform engineering", "chaos engineering", "blast radius",
            "enterprise architecture", "technical roadmapping",
        ],
    ),
}


def get_seniority_profile(seniority: str) -> SeniorityProfile:
    """Retrieve SeniorityProfile for given seniority string, defaulting to Mid."""
    sen_key = seniority.lower().strip()
    if "junior" in sen_key or "entry" in sen_key:
        return SENIORITY_PROFILES["junior"]
    elif "senior" in sen_key or "sr" in sen_key:
        return SENIORITY_PROFILES["senior"]
    elif "staff" in sen_key or "principal" in sen_key or "lead" in sen_key:
        return SENIORITY_PROFILES["staff"]
    return SENIORITY_PROFILES["mid"]


def calculate_adaptive_step(
    current_difficulty: float,
    answer_score: float,
    seniority: str,
    candidate_requested_simplify: bool = False,
) -> Tuple[float, str]:
    """
    Calculate next difficulty tier based on candidate answer performance (§Q4).
    - Strong answer (score >= 4/5) -> bump difficulty by +0.5, clamped at level's max.
    - Weak answer (score <= 2/5) or simplify requested -> drop difficulty by -0.5, clamped at level's min.
    - Average answer (score == 3/5) -> keep difficulty unchanged.
    Returns: (new_numeric_difficulty, new_difficulty_label)
    """
    profile = get_seniority_profile(seniority)

    if candidate_requested_simplify or answer_score <= 2.0:
        new_val = current_difficulty - 0.5
    elif answer_score >= 4.0:
        new_val = current_difficulty + 0.5
    else:
        new_val = current_difficulty

    clamped_val = profile.clamp_difficulty(new_val)
    label = get_difficulty_label(clamped_val)
    return clamped_val, label

