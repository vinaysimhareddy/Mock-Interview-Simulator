"""
Tests for Seniority Profiles and Difficulty Control (§Q4).
Verifies:
1. A Mid session can never exceed Medium-Hard (numeric 4.0).
2. Forbidden topics (network partitions, Paxos, multi-region failover) are rejected for Mid unless present on the resume.
3. classify_difficulty flags a known Staff question as too hard for Mid.
4. Adaptive step rule updates difficulty (+0.5 on strong, -0.5 on weak) clamped to bounds.
5. Junior session is capped at 2.0 (Easy-Medium).
"""

import pytest
from app.core.seniority_profiles import (
    calculate_adaptive_step,
    get_difficulty_label,
    get_seniority_profile,
)
from app.services.difficulty_classifier import classify_difficulty


def test_mid_session_can_never_exceed_numeric_four():
    """Verify a Mid session can never exceed Medium-Hard (numeric 4.0) (§Q4)."""
    profile = get_seniority_profile("Mid")
    assert profile.max_difficulty == 4.0
    assert profile.min_difficulty == 1.0

    # Start at 2.0 and simulate 10 consecutive perfect answers (score = 5/5)
    current = profile.start_difficulty
    for _ in range(10):
        current, label = calculate_adaptive_step(current, answer_score=5.0, seniority="Mid")

    # MUST be strictly clamped at 4.0
    assert current == 4.0
    assert label == "Medium-Hard"


def test_junior_session_can_never_exceed_numeric_two():
    """Verify a Junior session starts at 1.0 and is capped at 2.0 (§Q4)."""
    profile = get_seniority_profile("Junior")
    assert profile.start_difficulty == 1.0
    assert profile.max_difficulty == 2.0

    # Simulate 5 consecutive perfect answers
    current = profile.start_difficulty
    for _ in range(5):
        current, label = calculate_adaptive_step(current, answer_score=5.0, seniority="Junior")

    assert current == 2.0
    assert label == "Easy-Medium"


def test_adaptive_step_downward_and_simplification():
    """Verify weak answers and simplify requests drop difficulty down to level min (§Q4)."""
    profile = get_seniority_profile("Mid")
    current = 2.5

    # Weak answer (score 1.5) drops by 0.5
    current, label = calculate_adaptive_step(current, answer_score=1.5, seniority="Mid")
    assert current == 2.0

    # Candidate explicitly requests simplification
    current, label = calculate_adaptive_step(current, answer_score=3.0, seniority="Mid", candidate_requested_simplify=True)
    assert current == 1.5

    # Further drops clamp at minimum 1.0
    for _ in range(5):
        current, label = calculate_adaptive_step(current, answer_score=1.0, seniority="Mid")
    assert current == 1.0
    assert label == "Easy"


def test_forbidden_topics_rejected_for_mid_unless_on_resume():
    """
    Verify forbidden topics (network partitions, Paxos, multi-region failover)
    are rejected for Mid unless present on candidate resume (§Q4).
    """
    profile = get_seniority_profile("Mid")

    q_partition = "How would you handle network partitions and split-brain scenarios?"
    q_paxos = "Explain how Paxos achieves consensus during node failures."
    q_multi_region = "Design a multi-region active-active database failover strategy."
    q_caching = "How do you implement Redis cache-aside invalidation and select TTLs?"

    # Without resume evidence: all three must be flagged as forbidden
    assert profile.is_topic_forbidden(q_partition, resume_evidence_tags=set()) is True
    assert profile.is_topic_forbidden(q_paxos, resume_evidence_tags=set()) is True
    assert profile.is_topic_forbidden(q_multi_region, resume_evidence_tags=set()) is True

    # Standard Mid caching question must NOT be forbidden
    assert profile.is_topic_forbidden(q_caching, resume_evidence_tags=set()) is False

    # WITH resume evidence: if candidate's resume explicitly mentions Paxos and multi-region
    candidate_resume_tags = {"PostgreSQL", "Paxos", "Multi-Region"}
    assert profile.is_topic_forbidden(q_paxos, resume_evidence_tags=candidate_resume_tags) is False


@pytest.mark.asyncio
async def test_classify_difficulty_flags_known_staff_question():
    """Verify classify_difficulty flags a known Staff question as too hard for Mid (§Q4)."""
    staff_question = (
        "Under the CAP theorem, how do you handle network partitions and eventual-consistency "
        "lag across multi-region datacenters using Raft or Paxos consensus?"
    )

    classification = await classify_difficulty(
        question_text=staff_question,
        target_seniority="Mid",
        role="Backend",
        candidate_resume_tags=[],
    )

    assert classification.is_too_hard_for_level is True
    assert classification.estimated_tier >= 4.0
    assert len(classification.detected_forbidden_topics) > 0
    assert any("paxos" in t or "network partition" in t or "raft" in t for t in classification.detected_forbidden_topics)


@pytest.mark.asyncio
async def test_classify_difficulty_approves_appropriate_mid_question():
    """Verify classify_difficulty approves a practical Mid backend question (§Q4)."""
    mid_question = (
        "In your past project using Spring Boot, how did you implement Redis cache-aside "
        "and prevent stale data when PostgreSQL records were updated?"
    )

    classification = await classify_difficulty(
        question_text=mid_question,
        target_seniority="Mid",
        role="Backend",
        candidate_resume_tags=["Spring Boot", "PostgreSQL", "Redis"],
    )

    assert classification.is_too_hard_for_level is False
    assert classification.estimated_tier <= 4.0
    assert len(classification.detected_forbidden_topics) == 0

