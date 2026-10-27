"""R6 Verification Tests: Integrity Report, Non-Verbal Flag Exclusion & Verdict Logic (§7)."""

import pytest
from app.models.interview import CategoryScores, FinalReport, IntegritySummary, IntegrityTimelineEvent
from app.services.integrity_service import (
    is_telemetry_clean,
    compute_verified_non_verbal_scores,
    build_integrity_summary,
)


def test_is_telemetry_clean_identifies_clean_and_flagged_samples():
    clean_sample = {
        "t": 12.0,
        "eye_contact_ratio": 0.88,
        "posture_score": 0.92,
        "face_present": True,
        "distraction_flags": [],
        "integrity": {"faces_detected": 1, "flags": []},
    }
    assert is_telemetry_clean(clean_sample) is True

    # Face missing
    dirty_face_missing = dict(clean_sample)
    dirty_face_missing["face_present"] = False
    assert is_telemetry_clean(dirty_face_missing) is False

    # Camera covered flag
    dirty_camera_covered = {
        "t": 13.0,
        "eye_contact_ratio": 0.0,
        "posture_score": 0.0,
        "face_present": True,
        "distraction_flags": ["camera_covered"],
    }
    assert is_telemetry_clean(dirty_camera_covered) is False

    # Spoof flag in nested integrity object
    dirty_spoof = {
        "t": 14.0,
        "eye_contact_ratio": 0.88,
        "posture_score": 0.92,
        "face_present": True,
        "distraction_flags": [],
        "integrity": {"faces_detected": 1, "flags": [{"flag": "static_feed"}]},
    }
    assert is_telemetry_clean(dirty_spoof) is False


def test_compute_verified_non_verbal_scores_excludes_flagged_segments():
    # 5 clean samples with eye_contact = 0.90, posture = 0.90
    clean_samples = [
        {
            "t": float(i),
            "eye_contact_ratio": 0.90,
            "posture_score": 0.90,
            "face_present": True,
            "distraction_flags": [],
            "integrity": {"faces_detected": 1, "flags": []},
        }
        for i in range(5)
    ]

    # 3 flagged samples (camera covered, static feed) with 0.0 scores
    flagged_samples = [
        {
            "t": float(5 + i),
            "eye_contact_ratio": 0.10,
            "posture_score": 0.10,
            "face_present": False,
            "distraction_flags": ["camera_covered"],
            "integrity": {"faces_detected": 0, "flags": [{"flag": "camera_covered"}]},
        }
        for i in range(3)
    ]

    all_samples = clean_samples + flagged_samples

    avg_eye, avg_posture, excluded_count = compute_verified_non_verbal_scores(all_samples)

    # Must equal clean average (0.90), NOT degraded by flagged samples!
    assert avg_eye == 0.90
    assert avg_posture == 0.90
    assert excluded_count == 3


def test_build_integrity_summary_verdict_verified():
    samples = [
        {
            "t": float(i),
            "eye_contact_ratio": 0.85,
            "posture_score": 0.85,
            "face_present": True,
            "distraction_flags": [],
            "integrity": {"faces_detected": 1, "flags": []},
        }
        for i in range(10)
    ]
    events = []

    summary = build_integrity_summary(
        session_id="session_test_1",
        integrity_score=98.0,
        events=events,
        samples=samples,
        camera_device_name="HD Pro Webcam C920",
        challenges_passed=2,
        challenges_failed=0,
    )

    assert summary["verdict"] == "Verified"
    assert summary["integrity_score"] == 98.0
    assert summary["camera_device_name"] == "HD Pro Webcam C920"
    assert summary["challenges_passed"] == 2
    assert summary["challenges_failed"] == 0
    assert summary["face_present_percentage"] == 100.0
    assert summary["pauses_count"] == 0
    assert summary["camera_loss_incidents"] == 0
    assert summary["excluded_segments_count"] == 0
    assert "automated heuristics" in summary["disclaimer"]


def test_build_integrity_summary_verdict_with_warnings():
    samples = [
        {
            "t": float(i),
            "eye_contact_ratio": 0.85,
            "posture_score": 0.85,
            "face_present": True,
            "distraction_flags": [],
            "integrity": {"faces_detected": 1, "flags": []},
        }
        for i in range(10)
    ]
    # Minor warning event (soft flags reducing score to 75)
    events = [
        {"flag": "no_blink", "confidence": 0.6, "t": 45.0, "details": {}},
        {"flag": "bad_framing", "confidence": 0.7, "t": 60.0, "details": {}},
    ]

    summary = build_integrity_summary(
        session_id="session_test_2",
        integrity_score=75.0,
        events=events,
        samples=samples,
        challenges_passed=1,
        challenges_failed=0,
    )

    assert summary["verdict"] == "Verified with warnings"
    assert summary["integrity_score"] == 75.0
    assert len(summary["timeline_events"]) == 2


def test_build_integrity_summary_verdict_not_verified():
    samples = [
        {
            "t": float(i),
            "eye_contact_ratio": 0.0,
            "posture_score": 0.0,
            "face_present": False,
            "distraction_flags": ["static_feed"],
            "integrity": {"faces_detected": 1, "flags": [{"flag": "static_feed"}]},
        }
        for i in range(10)
    ]
    events = [
        {"flag": "static_feed", "confidence": 1.0, "t": 10.0, "details": {}},
        {"flag": "challenge_failed", "confidence": 1.0, "t": 20.0, "details": {}},
    ]

    summary = build_integrity_summary(
        session_id="session_test_3",
        integrity_score=40.0,
        events=events,
        samples=samples,
        challenges_passed=0,
        challenges_failed=2,
    )

    assert summary["verdict"] == "Not verified"
    assert summary["integrity_score"] == 40.0
    assert summary["challenges_failed"] == 2


def test_final_report_pydantic_schema_serialization():
    report_data = {
        "overall_score": 88.5,
        "category_scores": {"technical": 90.0, "communication": 85.0, "composure": 90.0},
        "hiring_recommendation": "Strong Hire",
        "strengths": ["Strong architectural instincts", "Maintained composure"],
        "weaknesses": ["Deepen metrics discussion"],
        "executive_summary": "Excellent performance across technical interview dimensions.",
        "integrity_summary": {
            "verdict": "Verified",
            "integrity_score": 96.0,
            "camera_device_name": "Built-in Camera",
            "challenges_passed": 2,
            "challenges_failed": 0,
            "face_present_percentage": 99.5,
            "pauses_count": 0,
            "camera_loss_incidents": 0,
            "timeline_events": [
                {"flag": "no_blink", "timestamp": 24.5, "duration_sec": 1.0, "confidence": 0.5}
            ],
            "excluded_segments_count": 0,
            "non_verbal_excluded_note": "Non-verbal scores computed only from verified-live segments.",
            "disclaimer": "Integrity checks are automated heuristics.",
        },
    }

    report = FinalReport(**report_data)
    assert report.integrity_summary is not None
    assert report.integrity_summary.verdict == "Verified"
    assert report.integrity_summary.integrity_score == 96.0
    assert len(report.integrity_summary.timeline_events) == 1

    dumped = report.model_dump()
    assert dumped["integrity_summary"]["verdict"] == "Verified"
