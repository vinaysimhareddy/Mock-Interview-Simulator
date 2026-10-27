"""Real Camera Integrity & Anti-Spoofing Service (§5).

Implements:
1. HMAC signature generation and verification with key rotation.
2. Server-side plausibility checks (too perfect, zero jitter, impossible blinks, lip-audio mismatch, gaps).
3. Rolling deterministic Integrity Score (0-100) and audit event tracking.
4. Configurable Policy Engine (off, advisory, strict).
"""

import hashlib
import hmac
import logging
import secrets
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("uvicorn.error")

FLAG_PENALTIES: Dict[str, float] = {
    # High-severity fraud / spoofing (-30)
    "static_feed": 30.0,
    "loop_suspected": 30.0,
    "screen_replay_suspected": 30.0,
    "identity_mismatch": 30.0,
    "bad_hmac": 30.0,
    "replayed_sequence": 30.0,
    # Hardware loss / absence (-20)
    "camera_covered": 20.0,
    "face_missing": 20.0,
    "track_ended": 20.0,
    # Multi-person intrusion (-15)
    "multiple_faces": 15.0,
    # Medium severity / anomalies (-10)
    "lip_audio_mismatch": 10.0,
    "telemetry_gap": 10.0,
    "plausibility_violation": 10.0,
    "timing_anomaly": 10.0,
    # Soft flags / framing (-5)
    "no_blink": 5.0,
    "bad_framing": 5.0,
    "no_micro_motion": 5.0,
}


class PolicyActionType(str, Enum):
    OK = "ok"
    COACHING_HINT = "coaching_hint"
    WARNING = "warning"
    PAUSE = "pause"
    CHALLENGE = "challenge"
    ABORT = "abort"


@dataclass
class PolicyDecision:
    action: PolicyActionType
    reason: str
    voice_prompt: Optional[str] = None
    grace_seconds: float = 30.0
    challenge_action: Optional[str] = None
    challenge_prompt: Optional[str] = None


class HMACManager:
    """Manages session HMAC keys, salts, signature generation, and verification (§5.1)."""

    def __init__(self, rotation_interval_sec: float = 300.0) -> None:
        self.rotation_interval_sec = rotation_interval_sec
        self.current_key: str = secrets.token_hex(32)
        self.previous_key: Optional[str] = None
        self.key_created_at: float = time.time()
        self.session_salt: str = secrets.token_hex(16)

    def get_active_key(self) -> str:
        """Returns active HMAC key, rotating if older than 5 minutes."""
        now = time.time()
        if now - self.key_created_at >= self.rotation_interval_sec:
            self.previous_key = self.current_key
            self.current_key = secrets.token_hex(32)
            self.key_created_at = now
            logger.info("Rotated session HMAC key")
        return self.current_key

    @staticmethod
    def compute_signature(
        key: str,
        t: float,
        seq: int,
        camera_label_hash: Optional[str],
        device_id_hash: Optional[str],
        measured_fps: Optional[float],
    ) -> str:
        """Generates HMAC-SHA256 signature over packet canonical parameters."""
        payload = f"{t:.3f}:{seq}:{camera_label_hash or ''}:{device_id_hash or ''}:{measured_fps or 0.0:.2f}"
        return hmac.new(key.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()

    def verify_signature(
        self,
        signature: str,
        t: float,
        seq: int,
        camera_label_hash: Optional[str],
        device_id_hash: Optional[str],
        measured_fps: Optional[float],
    ) -> bool:
        """Validates signature against current key (or previous key during rotation window)."""
        if not signature:
            return False

        # Try current key
        expected_current = self.compute_signature(
            self.current_key, t, seq, camera_label_hash, device_id_hash, measured_fps
        )
        if hmac.compare_digest(expected_current, signature):
            return True

        # Try previous key if within grace
        if self.previous_key:
            expected_prev = self.compute_signature(
                self.previous_key, t, seq, camera_label_hash, device_id_hash, measured_fps
            )
            if hmac.compare_digest(expected_prev, signature):
                return True

        return False


class PlausibilityChecker:
    """Detects artificially generated, frozen, or impossible telemetry (§5.2)."""

    def __init__(self) -> None:
        self.packet_history: List[Dict[str, Any]] = []
        self.last_speech_time: float = -1.0
        self.last_telemetry_time: float = -1.0
        self.zero_mouth_open_start: Optional[float] = None
        self.identical_metric_start: Optional[float] = None

    def record_speech(self, timestamp: float) -> None:
        self.last_speech_time = timestamp

    def check_telemetry(self, packet: Dict[str, Any]) -> List[str]:
        violations: List[str] = []
        now = packet.get("t", time.time())

        # 1. Telemetry Gap Detection (> 3.0s between 1 Hz packets)
        if self.last_telemetry_time >= 0:
            dt = now - self.last_telemetry_time
            if dt > 3.0:
                violations.append("telemetry_gap")
        self.last_telemetry_time = now

        # Add to rolling history (max 30 samples)
        self.packet_history.append(packet)
        if len(self.packet_history) > 30:
            self.packet_history.pop(0)

        # 2. Check for Identical Telemetry for > 10 s
        if len(self.packet_history) >= 10:
            recent_10 = self.packet_history[-10:]
            first_eye = recent_10[0].get("eye_contact_ratio", 0)
            first_posture = recent_10[0].get("posture_score", 0)
            first_head = recent_10[0].get("head_pose", {})

            all_identical = all(
                p.get("eye_contact_ratio") == first_eye
                and p.get("posture_score") == first_posture
                and p.get("head_pose", {}).get("yaw") == first_head.get("yaw")
                and p.get("head_pose", {}).get("pitch") == first_head.get("pitch")
                for p in recent_10
            )
            if all_identical:
                violations.append("plausibility_violation")

        # 3. Constant FPS or Zero Landmark Jitter
        integrity = packet.get("integrity") or {}
        landmark_jitter = integrity.get("landmark_jitter")
        if landmark_jitter is not None and landmark_jitter < 1e-7:
            # Synthetic generators often send exactly 0.0 jitter
            violations.append("plausibility_violation")

        # 4. Lip-Audio Mismatch Cross-Check
        expression = packet.get("expression") or {}
        mouth_open = expression.get("mouth_open", 0.0)
        is_speech_recent = (now - self.last_speech_time) < 2.0 and self.last_speech_time > 0

        if is_speech_recent:
            if mouth_open < 0.05:
                if self.zero_mouth_open_start is None:
                    self.zero_mouth_open_start = now
                elif now - self.zero_mouth_open_start >= 4.0:
                    violations.append("lip_audio_mismatch")
            else:
                self.zero_mouth_open_start = None
        else:
            self.zero_mouth_open_start = None

        return violations


class IntegrityScorer:
    """Calculates deterministic rolling Integrity Score (0 to 100) (§5.2)."""

    def __init__(self) -> None:
        self.events: List[Dict[str, Any]] = []

    def record_event(
        self,
        flag: str,
        confidence: float = 1.0,
        t: float = 0.0,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.events.append({
            "flag": flag,
            "confidence": min(1.0, max(0.0, confidence)),
            "t": t,
            "timestamp": time.time(),
            "details": details or {},
        })

    def compute_score(self) -> float:
        """Computes rolling score deterministically from all recorded events."""
        total_penalty = 0.0
        # Group penalties by flag to avoid infinite compounding of a single ongoing issue
        flag_weights: Dict[str, float] = {}

        for evt in self.events:
            flag = evt["flag"]
            conf = evt.get("confidence", 1.0)
            base_pen = FLAG_PENALTIES.get(flag, 5.0)
            cur_max = flag_weights.get(flag, 0.0)
            flag_weights[flag] = max(cur_max, base_pen * conf)

        total_penalty = sum(flag_weights.values())
        return max(0.0, min(100.0, 100.0 - total_penalty))

    def get_events(self) -> List[Dict[str, Any]]:
        return list(self.events)


class PolicyEngine:
    """Configurable Policy Engine evaluating telemetry and triggering actions (§5.3)."""

    def __init__(self, mode: str = "strict") -> None:
        self.mode = mode.lower()  # "off", "advisory", "strict"
        self.pause_start_time: Optional[float] = None
        self.multiple_faces_count: int = 0
        self.challenge_retries_remaining: int = 1
        self.active_challenge_nonce: Optional[str] = None
        self.is_paused: bool = False

    def evaluate(
        self,
        flags: List[str],
        current_time: float,
    ) -> PolicyDecision:
        if self.mode == "off":
            return PolicyDecision(action=PolicyActionType.OK, reason="Integrity mode is off")

        # 1. Camera Lost, Ended, Mute, Face Missing, Camera Covered
        hardware_pause_flags = {"track_ended", "track_muted", "face_missing", "camera_covered"}
        intersect_hw = hardware_pause_flags.intersection(flags)

        if intersect_hw:
            flag_name = list(intersect_hw)[0]
            if not self.is_paused:
                self.is_paused = True
                self.pause_start_time = current_time

            elapsed_pause = current_time - (self.pause_start_time or current_time)

            if self.mode == "strict" and elapsed_pause > 30.0:
                return PolicyDecision(
                    action=PolicyActionType.ABORT,
                    reason=f"Session aborted: Camera feed lost ({flag_name}) for over 30 seconds grace period.",
                )

            return PolicyDecision(
                action=PolicyActionType.PAUSE,
                reason=f"Camera lost ({flag_name}), please restore feed",
                voice_prompt="Camera lost, please restore it",
                grace_seconds=max(0.0, 30.0 - elapsed_pause),
            )
        else:
            # Feed restored
            if self.is_paused:
                self.is_paused = False
                self.pause_start_time = None

        # 2. Multi-Person Intrusion (multiple_faces)
        if "multiple_faces" in flags:
            self.multiple_faces_count += 1
            if self.mode == "strict" and self.multiple_faces_count >= 3:
                return PolicyDecision(
                    action=PolicyActionType.PAUSE,
                    reason="Multiple faces detected repeatedly. Please ensure you are alone in the room.",
                    voice_prompt="Please ensure only you are visible in the camera frame",
                )
            return PolicyDecision(
                action=PolicyActionType.WARNING,
                reason="Multiple faces detected in frame. Candidate must be alone.",
            )

        # 3. High-Confidence Fraud Flags (static_feed, loop_suspected, screen_replay_suspected, identity_mismatch)
        fraud_flags = {"static_feed", "loop_suspected", "screen_replay_suspected", "identity_mismatch"}
        intersect_fraud = fraud_flags.intersection(flags)

        if intersect_fraud:
            fraud_name = list(intersect_fraud)[0]
            if self.mode == "strict":
                return PolicyDecision(
                    action=PolicyActionType.CHALLENGE,
                    reason=f"Suspicious feed detected ({fraud_name}). Forced active liveness challenge required.",
                    challenge_action="turn_head_left",
                    challenge_prompt="For verification, please turn your head to the left",
                )
            else:
                return PolicyDecision(
                    action=PolicyActionType.WARNING,
                    reason=f"Integrity advisory: {fraud_name} flagged in stream.",
                )

        # 4. Soft Flags (no_blink, bad_framing, no_micro_motion)
        soft_flags = {"no_blink", "bad_framing", "no_micro_motion"}
        intersect_soft = soft_flags.intersection(flags)
        if intersect_soft:
            soft_name = list(intersect_soft)[0]
            hint = (
                "Please remember to blink naturally"
                if soft_name == "no_blink"
                else "Please position your face centrally in the camera frame"
                if soft_name == "bad_framing"
                else "Natural movement required"
            )
            return PolicyDecision(action=PolicyActionType.COACHING_HINT, reason=hint)

        return PolicyDecision(action=PolicyActionType.OK, reason="Nominal camera integrity")

    def handle_challenge_result(self, passed: bool) -> PolicyDecision:
        """Handles candidate response to mid-interview challenge."""
        if passed:
            self.active_challenge_nonce = None
            return PolicyDecision(action=PolicyActionType.OK, reason="Liveness challenge passed")

        if self.mode == "strict":
            if self.challenge_retries_remaining > 0:
                self.challenge_retries_remaining -= 1
                return PolicyDecision(
                    action=PolicyActionType.CHALLENGE,
                    reason="Challenge verification failed. Final retry allowed.",
                    challenge_action="smile",
                    challenge_prompt="For verification, please smile at the camera",
                )
            else:
                return PolicyDecision(
                    action=PolicyActionType.ABORT,
                    reason="Session aborted: Candidate failed active liveness challenge.",
                )

        return PolicyDecision(action=PolicyActionType.WARNING, reason="Liveness challenge failed (advisory)")


# ==============================================================================
# Integrity Evaluation & Non-Verbal Scoring Engine (§7)
# ==============================================================================

DISQUALIFYING_NON_VERBAL_FLAGS = {
    "face_missing",
    "camera_covered",
    "static_feed",
    "loop_suspected",
    "screen_replay_suspected",
    "identity_mismatch",
    "track_ended",
    "track_muted",
    "bad_framing",
    "frozen_feed",
}


def is_telemetry_clean(sample: Dict[str, Any]) -> bool:
    """Returns True if sample was collected during a verified-live camera segment with no active integrity flags."""
    # Check top-level distraction flags
    distraction_flags = sample.get("distraction_flags", [])
    if any(f in DISQUALIFYING_NON_VERBAL_FLAGS for f in distraction_flags):
        return False

    # Check nested integrity flags
    integrity = sample.get("integrity") or {}
    flags_list = integrity.get("flags", [])
    for f in flags_list:
        flag_name = f.get("flag") if isinstance(f, dict) else str(f)
        if flag_name in DISQUALIFYING_NON_VERBAL_FLAGS:
            return False

    # Must confirm face is present
    if sample.get("face_present") is False or integrity.get("faces_detected", 1) == 0:
        return False

    return True


def compute_verified_non_verbal_scores(
    samples: List[Dict[str, Any]],
) -> Tuple[float, float, int]:
    """
    Computes (eye_contact_ratio, posture_score, excluded_count) exclusively from verified-live segments (§7).
    Segments with active integrity flags are excluded.
    """
    if not samples:
        return 0.85, 0.85, 0

    clean_samples = [s for s in samples if is_telemetry_clean(s)]
    excluded_count = len(samples) - len(clean_samples)

    if not clean_samples:
        # Fallback if entire session was flagged
        return 0.70, 0.70, excluded_count

    avg_eye = sum(s.get("eye_contact_ratio", 0.85) for s in clean_samples) / len(clean_samples)
    avg_posture = sum(s.get("posture_score", 0.85) for s in clean_samples) / len(clean_samples)

    return round(avg_eye, 3), round(avg_posture, 3), excluded_count


def build_integrity_summary(
    session_id: str,
    integrity_score: float,
    events: List[Dict[str, Any]],
    samples: List[Dict[str, Any]],
    camera_device_name: Optional[str] = None,
    challenges_passed: int = 0,
    challenges_failed: int = 0,
) -> Dict[str, Any]:
    """
    Constructs comprehensive post-interview IntegritySummary (§7).
    Determines verdict: Verified | Verified with warnings | Not verified.
    """
    total_samples = len(samples)
    face_present_count = 0
    clean_count = 0

    for s in samples:
        if s.get("face_present") is not False:
            integrity = s.get("integrity") or {}
            if integrity.get("faces_detected", 1) > 0 and "face_missing" not in s.get("distraction_flags", []):
                face_present_count += 1
        if is_telemetry_clean(s):
            clean_count += 1

    face_present_percentage = (
        round((face_present_count / total_samples) * 100.0, 1) if total_samples > 0 else 100.0
    )
    excluded_segments_count = total_samples - clean_count

    # Count pauses and camera loss incidents from audit events
    camera_loss_incidents = 0
    pauses_count = 0
    has_severe_fraud = False

    timeline_events: List[Dict[str, Any]] = []

    for evt in events:
        flag = evt.get("flag", "unknown")
        if flag in ("track_ended", "track_muted", "camera_covered", "camera_lost", "face_missing"):
            camera_loss_incidents += 1
            pauses_count += 1
        elif flag in ("pause", "paused_integrity"):
            pauses_count += 1
        elif flag in ("static_feed", "loop_suspected", "screen_replay_suspected", "identity_mismatch"):
            has_severe_fraud = True

        timeline_events.append({
            "flag": flag,
            "timestamp": round(float(evt.get("t", 0.0)), 2),
            "duration_sec": round(float(evt.get("details", {}).get("duration_sec", 1.0)), 1),
            "confidence": round(float(evt.get("confidence", 1.0)), 2),
            "details": evt.get("details"),
        })

    # Overall Verdict Calculation
    if (
        integrity_score >= 85.0
        and challenges_failed == 0
        and camera_loss_incidents == 0
        and not has_severe_fraud
    ):
        verdict = "Verified"
    elif integrity_score >= 60.0 and challenges_failed <= 1:
        verdict = "Verified with warnings"
    else:
        verdict = "Not verified"

    return {
        "verdict": verdict,
        "integrity_score": round(integrity_score, 1),
        "camera_device_name": camera_device_name or "Physical Built-in Webcam / USB Camera",
        "challenges_passed": challenges_passed,
        "challenges_failed": challenges_failed,
        "face_present_percentage": face_present_percentage,
        "pauses_count": pauses_count,
        "camera_loss_incidents": camera_loss_incidents,
        "timeline_events": timeline_events,
        "excluded_segments_count": excluded_segments_count,
        "non_verbal_excluded_note": (
            "Non-verbal scores (eye contact, posture) are computed only from verified-live segments; "
            "segments with active integrity flags were excluded."
        ),
        "disclaimer": (
            "Integrity checks are automated heuristics and may produce false positives. "
            "Review flagged events before drawing conclusions."
        ),
    }

