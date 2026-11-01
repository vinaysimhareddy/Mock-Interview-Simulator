"""Server-side Face Absence Policy Engine (§3.5).

Enforces strict proctoring and face presence rules independently on the server:
- Face missing < 3 s: Ignored (transient occlusion/look-down)
- Face missing >= 3 s: Soft popup (timers paused on server)
- Face missing >= 10 s: Warning 1 of 2 (spoken warning triggered)
- Face missing >= 20 s: Warning 2 of 2 (final notice triggered)
- Face missing >= 30 s: Abort session with status 'aborted_face_not_visible'
- 3-Strike Rule: 3 separate warning-tier absence incidents (>= 10 s) aborts the session
- Gaze aversion (looking away) and posture changes are logged silently, NEVER triggering popups or aborts.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class FacePolicyAction(str, Enum):
    OK = "ok"
    SOFT_POPUP = "soft_popup"
    WARNING_1 = "warning_1"
    WARNING_2 = "warning_2"
    ABORT = "abort"


@dataclass
class FacePolicyDecision:
    action: FacePolicyAction
    consecutive_missing_sec: float
    strike_count: int
    reason: str
    voice_prompt: Optional[str] = None
    abort_reason: Optional[str] = None
    timers_paused: bool = False
    audit_event: Optional[Dict[str, Any]] = None


class FacePolicy:
    """Configurable server-side face absence and proctoring policy."""

    def __init__(self, strike_threshold: int = 3, abort_consecutive_sec: float = 30.0) -> None:
        self.strike_threshold = strike_threshold
        self.abort_consecutive_sec = abort_consecutive_sec
        self.consecutive_missing_sec: float = 0.0
        self.strikes: int = 0
        self.is_paused: bool = False
        self.warned_1: bool = False
        self.warned_2: bool = False
        self.history: List[Dict[str, Any]] = []

    def evaluate_sample(
        self,
        face_present: bool,
        dt_seconds: float = 1.0,
        current_time: float = 0.0,
        is_looking_away: bool = False,
        posture_poor: bool = False,
    ) -> FacePolicyDecision:
        """Process incoming 1 Hz telemetry sample and evaluate face absence policy."""

        # 1. Non-verbal composure checks: Looking away or posture anomaly
        # Must be logged silently, NEVER triggering popup or abort (§3.5)
        if face_present:
            # If candidate was in an active absence incident of >= 10s, record a strike upon return
            if self.consecutive_missing_sec >= 10.0:
                self.strikes += 1
                strike_event = {
                    "event_type": "face_absence_strike",
                    "t": current_time,
                    "strike_number": self.strikes,
                    "consecutive_absence_sec": self.consecutive_missing_sec,
                }
                self.history.append(strike_event)

                # Check 3-strike rule
                if self.strikes >= self.strike_threshold:
                    return FacePolicyDecision(
                        action=FacePolicyAction.ABORT,
                        consecutive_missing_sec=0.0,
                        strike_count=self.strikes,
                        reason=f"Interview aborted: Exceeded maximum allowed face absence strikes ({self.strikes}/{self.strike_threshold}).",
                        abort_reason="aborted_face_not_visible",
                        timers_paused=True,
                        audit_event=strike_event,
                    )

            # Reset consecutive missing counter upon face restoration
            self.consecutive_missing_sec = 0.0
            self.is_paused = False
            self.warned_1 = False
            self.warned_2 = False

            # Silent logging of gaze or posture (no popup/warning)
            silent_audit = None
            if is_looking_away or posture_poor:
                silent_audit = {
                    "event_type": "telemetry_logged_silently",
                    "t": current_time,
                    "looking_away": is_looking_away,
                    "posture_poor": posture_poor,
                }
                self.history.append(silent_audit)

            return FacePolicyDecision(
                action=FacePolicyAction.OK,
                consecutive_missing_sec=0.0,
                strike_count=self.strikes,
                reason="Face present in camera frame.",
                timers_paused=False,
                audit_event=silent_audit,
            )

        # 2. Face Absent: Accumulate consecutive absence time
        self.consecutive_missing_sec += dt_seconds
        missing = self.consecutive_missing_sec

        # Rule: >= 30 seconds consecutive absence -> Immediate ABORT
        if missing >= self.abort_consecutive_sec:
            abort_evt = {
                "event_type": "face_absence_timeout",
                "t": current_time,
                "consecutive_absence_sec": missing,
            }
            self.history.append(abort_evt)
            return FacePolicyDecision(
                action=FacePolicyAction.ABORT,
                consecutive_missing_sec=missing,
                strike_count=self.strikes + 1,
                reason="Interview aborted: Face was not detected in camera frame for 30 consecutive seconds.",
                abort_reason="aborted_face_not_visible",
                timers_paused=True,
                audit_event=abort_evt,
            )

        # Rule: >= 20 seconds -> Warning 2 of 2 (Spoken final notice)
        if missing >= 20.0:
            warn_evt = {
                "event_type": "face_absence_warning_2",
                "t": current_time,
                "consecutive_absence_sec": missing,
            }
            self.history.append(warn_evt)
            self.warned_2 = True
            return FacePolicyDecision(
                action=FacePolicyAction.WARNING_2,
                consecutive_missing_sec=missing,
                strike_count=self.strikes,
                reason="Warning 2 of 2: Face absent for over 20 seconds.",
                voice_prompt="Warning 2 of 2: Final notice. Continued face absence will end the interview.",
                timers_paused=True,
                audit_event=warn_evt,
            )

        # Rule: >= 10 seconds -> Warning 1 of 2 (Spoken warning)
        if missing >= 10.0:
            warn_evt = {
                "event_type": "face_absence_warning_1",
                "t": current_time,
                "consecutive_absence_sec": missing,
            }
            self.history.append(warn_evt)
            self.warned_1 = True
            return FacePolicyDecision(
                action=FacePolicyAction.WARNING_1,
                consecutive_missing_sec=missing,
                strike_count=self.strikes,
                reason="Warning 1 of 2: Face absent for over 10 seconds.",
                voice_prompt="Warning 1 of 2: Face not detected. Please return to camera frame.",
                timers_paused=True,
                audit_event=warn_evt,
            )

        # Rule: >= 3 seconds -> Soft popup (timers paused)
        if missing >= 3.0:
            self.is_paused = True
            popup_evt = {
                "event_type": "face_absence_soft_popup",
                "t": current_time,
                "consecutive_absence_sec": missing,
            }
            self.history.append(popup_evt)
            return FacePolicyDecision(
                action=FacePolicyAction.SOFT_POPUP,
                consecutive_missing_sec=missing,
                strike_count=self.strikes,
                reason="Face not detected. Response timers paused.",
                timers_paused=True,
                audit_event=popup_evt,
            )

        # Rule: < 3 seconds -> Ignore (transient jitter or downward gaze)
        return FacePolicyDecision(
            action=FacePolicyAction.OK,
            consecutive_missing_sec=missing,
            strike_count=self.strikes,
            reason="Transient absence ignored (< 3s).",
            timers_paused=False,
        )

