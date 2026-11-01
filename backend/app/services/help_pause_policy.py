"""Server-side Help Drawer Pause Cap & Tracker (§3.4, §5).

Enforces a maximum total time budget for candidate troubleshooting in the help drawer
(default: 120 seconds per interview session). All events and accumulated durations are
logged to session integrity events.
"""

from typing import Any, Dict, List, Optional, Tuple


class HelpDrawerPausePolicy:
    """Enforces server-side time budget for troubleshooting pauses."""

    def __init__(self, max_pause_seconds: float = 120.0) -> None:
        self.max_pause_seconds = max_pause_seconds
        self.accumulated_pause_sec: float = 0.0
        self.active_pause_start: Optional[float] = None
        self.cap_exceeded: bool = False
        self.events: List[Dict[str, Any]] = []

    def handle_help_opened(self, current_time: float) -> Dict[str, Any]:
        """Record candidate opening the help troubleshooting drawer."""
        self.active_pause_start = current_time
        event = {
            "event_type": "help_opened",
            "t": round(current_time, 3),
            "accumulated_pause_sec": round(self.accumulated_pause_sec, 2),
            "max_allowed_sec": self.max_pause_seconds,
        }
        self.events.append(event)
        return event

    def handle_help_closed(self, current_time: float) -> Dict[str, Any]:
        """Record candidate closing the help troubleshooting drawer."""
        duration = 0.0
        if self.active_pause_start is not None:
            duration = max(0.0, current_time - self.active_pause_start)
            self.accumulated_pause_sec += duration
            self.active_pause_start = None

        if self.accumulated_pause_sec >= self.max_pause_seconds and not self.cap_exceeded:
            self.cap_exceeded = True

        event = {
            "event_type": "help_closed",
            "t": round(current_time, 3),
            "duration_sec": round(duration, 2),
            "accumulated_pause_sec": round(self.accumulated_pause_sec, 2),
            "max_allowed_sec": self.max_pause_seconds,
            "cap_exceeded": self.cap_exceeded,
        }
        self.events.append(event)
        return event

    def check_active_pause(self, current_time: float) -> Tuple[bool, Optional[Dict[str, Any]]]:
        """Check ongoing help pause against the 120 s cap."""
        if self.active_pause_start is None:
            return self.cap_exceeded, None

        current_elapsed = max(0.0, current_time - self.active_pause_start)
        total_projected = self.accumulated_pause_sec + current_elapsed

        if total_projected >= self.max_pause_seconds:
            self.cap_exceeded = True
            exceeded_event = {
                "event_type": "help_pause_cap_exceeded",
                "t": round(current_time, 3),
                "total_pause_sec": round(total_projected, 2),
                "cap_limit_sec": self.max_pause_seconds,
                "action": "force_resume",
            }
            self.events.append(exceeded_event)
            return True, exceeded_event

        return False, None

    def get_audit_events(self) -> List[Dict[str, Any]]:
        return list(self.events)

