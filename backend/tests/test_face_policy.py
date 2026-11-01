"""Pytest verification for Server-side FacePolicy and Help Drawer Pause Cap (§3.4, §3.5).

Verifies:
1. Face absence < 3s ignored (Action OK)
2. Face absence >= 3s soft popup (Action SOFT_POPUP, timers paused)
3. Face absence >= 10s Warning 1 of 2 with spoken notice (Action WARNING_1)
4. Face absence >= 20s Warning 2 of 2 with spoken final notice (Action WARNING_2)
5. Face absence >= 30s immediate abort (Action ABORT, status 'aborted_face_not_visible')
6. 3-strike rule: 3 separate warning-tier absence incidents (>= 10s) triggers ABORT
7. Gaze aversion (looking away) & posture anomalies logged silently (NEVER popups/aborts)
8. Server-side Help Drawer pause cap (120 s default) logged as integrity events.
"""

import pytest
from app.services.face_policy import FacePolicy, FacePolicyAction
from app.services.help_pause_policy import HelpDrawerPausePolicy


def test_face_missing_under_3s_ignored():
    policy = FacePolicy()
    
    # 1s absence
    d1 = policy.evaluate_sample(face_present=False, dt_seconds=1.0, current_time=1.0)
    assert d1.action == FacePolicyAction.OK
    assert not d1.timers_paused

    # 2s absence
    d2 = policy.evaluate_sample(face_present=False, dt_seconds=1.0, current_time=2.0)
    assert d2.action == FacePolicyAction.OK
    assert not d2.timers_paused


def test_face_missing_3s_triggers_soft_popup():
    policy = FacePolicy()

    # Reach 3.0 seconds absence
    policy.evaluate_sample(face_present=False, dt_seconds=2.0, current_time=2.0)
    d = policy.evaluate_sample(face_present=False, dt_seconds=1.0, current_time=3.0)

    assert d.action == FacePolicyAction.SOFT_POPUP
    assert d.timers_paused is True
    assert "Response timers paused" in d.reason


def test_face_missing_10s_triggers_warning_1():
    policy = FacePolicy()

    # Fast forward to 10 seconds absence
    d = policy.evaluate_sample(face_present=False, dt_seconds=10.0, current_time=10.0)

    assert d.action == FacePolicyAction.WARNING_1
    assert d.timers_paused is True
    assert "Warning 1 of 2" in d.voice_prompt
    assert "Face not detected" in d.voice_prompt


def test_face_missing_20s_triggers_warning_2():
    policy = FacePolicy()

    # Fast forward to 20 seconds absence
    d = policy.evaluate_sample(face_present=False, dt_seconds=20.0, current_time=20.0)

    assert d.action == FacePolicyAction.WARNING_2
    assert d.timers_paused is True
    assert "Warning 2 of 2" in d.voice_prompt
    assert "Final notice" in d.voice_prompt


def test_face_missing_30s_triggers_immediate_abort():
    policy = FacePolicy()

    # Fast forward to 30 consecutive seconds
    d = policy.evaluate_sample(face_present=False, dt_seconds=30.0, current_time=30.0)

    assert d.action == FacePolicyAction.ABORT
    assert d.abort_reason == "aborted_face_not_visible"
    assert d.timers_paused is True
    assert "30 consecutive seconds" in d.reason


def test_three_strike_rule_aborts_interview():
    policy = FacePolicy(strike_threshold=3)

    # Strike 1: Face absent for 12 seconds, then returns
    policy.evaluate_sample(face_present=False, dt_seconds=12.0, current_time=12.0)
    d_return1 = policy.evaluate_sample(face_present=True, dt_seconds=1.0, current_time=13.0)
    assert d_return1.strike_count == 1
    assert d_return1.action == FacePolicyAction.OK

    # Strike 2: Face absent for 15 seconds, then returns
    policy.evaluate_sample(face_present=False, dt_seconds=15.0, current_time=28.0)
    d_return2 = policy.evaluate_sample(face_present=True, dt_seconds=1.0, current_time=29.0)
    assert d_return2.strike_count == 2
    assert d_return2.action == FacePolicyAction.OK

    # Strike 3: Face absent for 11 seconds, then returns -> 3-strike rule triggers ABORT!
    policy.evaluate_sample(face_present=False, dt_seconds=11.0, current_time=40.0)
    d_return3 = policy.evaluate_sample(face_present=True, dt_seconds=1.0, current_time=41.0)
    assert d_return3.action == FacePolicyAction.ABORT
    assert d_return3.abort_reason == "aborted_face_not_visible"
    assert d_return3.strike_count == 3
    assert "Exceeded maximum allowed face absence strikes" in d_return3.reason


def test_looking_away_and_posture_anomaly_logged_silently():
    policy = FacePolicy()

    # Candidate is looking down at notebook or away from camera, but face is detected in frame
    d_look_away = policy.evaluate_sample(
        face_present=True,
        dt_seconds=5.0,
        current_time=5.0,
        is_looking_away=True,
        posture_poor=False,
    )
    assert d_look_away.action == FacePolicyAction.OK
    assert not d_look_away.timers_paused
    assert d_look_away.audit_event is not None
    assert d_look_away.audit_event["event_type"] == "telemetry_logged_silently"

    # Candidate has poor posture, face present
    d_posture = policy.evaluate_sample(
        face_present=True,
        dt_seconds=5.0,
        current_time=10.0,
        is_looking_away=False,
        posture_poor=True,
    )
    assert d_posture.action == FacePolicyAction.OK
    assert not d_posture.timers_paused


def test_help_drawer_pause_cap_120_seconds():
    tracker = HelpDrawerPausePolicy(max_pause_seconds=120.0)

    # 1. Candidate opens help drawer at t=10.0
    evt_open1 = tracker.handle_help_opened(current_time=10.0)
    assert evt_open1["event_type"] == "help_opened"
    assert evt_open1["max_allowed_sec"] == 120.0

    # Candidate closes help drawer at t=70.0 (60s used)
    evt_close1 = tracker.handle_help_closed(current_time=70.0)
    assert evt_close1["duration_sec"] == 60.0
    assert evt_close1["accumulated_pause_sec"] == 60.0
    assert not evt_close1["cap_exceeded"]

    # 2. Candidate opens help drawer again at t=100.0
    tracker.handle_help_opened(current_time=100.0)

    # Check while still open at t=140.0 (40s more = 100s total, within 120s cap)
    exceeded, _ = tracker.check_active_pause(current_time=140.0)
    assert not exceeded

    # Check while still open at t=170.0 (70s more = 130s total, cap EXCEEDED!)
    exceeded, cap_evt = tracker.check_active_pause(current_time=170.0)
    assert exceeded
    assert cap_evt is not None
    assert cap_evt["event_type"] == "help_pause_cap_exceeded"
    assert cap_evt["total_pause_sec"] == 130.0
    assert cap_evt["action"] == "force_resume"

