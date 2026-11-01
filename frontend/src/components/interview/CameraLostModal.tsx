import React, { useState, useEffect } from 'react';
import {
  CameraOff,
  RotateCcw,
  HelpCircle,
  ShieldAlert,
} from 'lucide-react';
import { Button } from '../ui/button';

export interface CameraLostModalProps {
  isOpen: boolean;
  graceSeconds?: number;
  reason?: string;
  availableCameras?: MediaDeviceInfo[];
  selectedDeviceId?: string;
  onSelectCamera?: (deviceId: string) => Promise<void> | void;
  onRestore: () => Promise<void> | void;
  onGraceExpired?: () => void;
}

export function CameraLostModal({
  isOpen,
  graceSeconds = 30,
  reason = 'Camera feed disconnected or obstructed.',
  availableCameras,
  selectedDeviceId,
  onSelectCamera,
  onRestore,
  onGraceExpired,
}: CameraLostModalProps): React.ReactElement | null {
  const [remainingSec, setRemainingSec] = useState<number>(graceSeconds);
  const [isRestoring, setIsRestoring] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen) {
      setRemainingSec(graceSeconds);
      return;
    }

    setRemainingSec(graceSeconds);
    const interval = setInterval(() => {
      setRemainingSec((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          if (onGraceExpired) {
            onGraceExpired();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isOpen, graceSeconds, onGraceExpired]);

  if (!isOpen) return null;

  const handleRestoreClick = async () => {
    setIsRestoring(true);
    try {
      await onRestore();
    } finally {
      setIsRestoring(false);
    }
  };

  const isCritical = remainingSec <= 10;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="camera-lost-title"
      className="fixed inset-0 z-50 bg-background/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
    >
      <div className="w-full max-w-lg bg-card border border-border rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 text-center">
        {/* Pulsing Icon */}
        <div className="relative mx-auto w-16 h-16 flex items-center justify-center">
          <span className="absolute inset-0 rounded-full bg-destructive/25 animate-ping" />
          <div className="relative p-4 rounded-full bg-destructive/15 border border-destructive/40 text-destructive shadow-lg">
            <CameraOff className="h-8 w-8" />
          </div>
        </div>

        {/* Title & Reason */}
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2 text-destructive text-xs font-bold uppercase tracking-wider">
            <ShieldAlert className="h-4 w-4" />
            Interview Paused — Camera Lost
          </div>
          <h2 id="camera-lost-title" className="text-xl sm:text-2xl font-bold text-foreground">
            Please Restore Your Camera
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
            {reason} All interview question timers are paused during this recovery grace period.
          </p>
        </div>

        {/* 30-Second Countdown Meter */}
        <div className="p-4 rounded-2xl bg-muted/40 border border-border space-y-2 text-left">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground font-medium">Recovery Grace Window</span>
            <span
              className={`font-mono font-bold text-sm ${
                isCritical ? 'text-destructive animate-pulse' : 'text-amber-500'
              }`}
            >
              00:{remainingSec < 10 ? `0${remainingSec}` : remainingSec}
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full transition-all duration-1000 ease-linear ${
                isCritical ? 'bg-destructive' : 'bg-amber-400'
              }`}
              style={{ width: `${(remainingSec / graceSeconds) * 100}%` }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            If camera feed is not restored before timeout, the session will be paused or aborted under interview integrity policy.
          </p>
        </div>

        {/* Camera Selector Dropdown (if multiple webcams available) */}
        {availableCameras && availableCameras.length > 1 && onSelectCamera && (
          <div className="p-3 rounded-2xl bg-muted/40 border border-border text-left space-y-1.5">
            <label className="text-[11px] text-muted-foreground font-medium block">
              Switch to alternative physical camera:
            </label>
            <select
              value={selectedDeviceId}
              onChange={(e) => onSelectCamera(e.target.value)}
              className="w-full h-9 rounded-xl bg-card border border-border text-xs text-foreground px-3 focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
            >
              {availableCameras.map((cam) => (
                <option key={cam.deviceId} value={cam.deviceId}>
                  {cam.label || `Camera ${cam.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Action Button */}
        <Button
          onClick={handleRestoreClick}
          disabled={isRestoring}
          className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm gap-2 shadow-lg cursor-pointer rounded-full"
        >
          <RotateCcw className={`h-4 w-4 ${isRestoring ? 'animate-spin' : ''}`} />
          {isRestoring ? 'Reconnecting Camera...' : 'Restore Camera Feed'}
        </Button>

        {/* Troubleshooting Tips Card */}
        <div className="p-4 rounded-2xl bg-muted/30 border border-border/80 text-left space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <HelpCircle className="h-3.5 w-3.5 text-primary" />
            Troubleshooting Tips:
          </div>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc list-inside">
            <li>Unplug and replug your external webcam cable.</li>
            <li>Close other apps using the camera (Zoom, Microsoft Teams, Google Meet, Skype).</li>
            <li>Verify browser camera permissions in the address bar (lock icon).</li>
            <li>Ensure laptop lid is open and camera privacy shutter is retracted.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
