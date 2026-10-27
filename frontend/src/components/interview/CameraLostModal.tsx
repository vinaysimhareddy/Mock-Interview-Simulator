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
  onRestore: () => Promise<void> | void;
  onGraceExpired?: () => void;
}

export function CameraLostModal({
  isOpen,
  graceSeconds = 30,
  reason = 'Camera feed disconnected or obstructed.',
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
      className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
    >
      <div className="w-full max-w-lg bg-slate-900 border border-rose-500/40 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6 text-center">
        {/* Pulsing Icon */}
        <div className="relative mx-auto w-16 h-16 flex items-center justify-center">
          <span className="absolute inset-0 rounded-full bg-rose-500/20 animate-ping" />
          <div className="relative p-4 rounded-full bg-rose-950 border border-rose-600 text-rose-400 shadow-lg">
            <CameraOff className="h-8 w-8" />
          </div>
        </div>

        {/* Title & Reason */}
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2 text-rose-400 text-xs font-bold uppercase tracking-wider">
            <ShieldAlert className="h-4 w-4" />
            Interview Paused — Camera Lost
          </div>
          <h2 id="camera-lost-title" className="text-xl sm:text-2xl font-extrabold text-white">
            Please Restore Your Camera
          </h2>
          <p className="text-xs sm:text-sm text-slate-300 max-w-md mx-auto leading-relaxed">
            {reason} All interview question timers are paused during this recovery grace period.
          </p>
        </div>

        {/* 30-Second Countdown Meter */}
        <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 font-medium">Recovery Grace Window</span>
            <span
              className={`font-mono font-bold text-sm ${
                isCritical ? 'text-rose-400 animate-pulse' : 'text-amber-300'
              }`}
            >
              00:{remainingSec < 10 ? `0${remainingSec}` : remainingSec}
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
            <div
              className={`h-full transition-all duration-1000 ease-linear ${
                isCritical ? 'bg-rose-500' : 'bg-amber-400'
              }`}
              style={{ width: `${(remainingSec / graceSeconds) * 100}%` }}
            />
          </div>
          <p className="text-[11px] text-slate-500 text-left">
            If camera feed is not restored before timeout, the session will be paused or aborted under interview integrity policy.
          </p>
        </div>

        {/* Action Button */}
        <Button
          onClick={handleRestoreClick}
          disabled={isRestoring}
          className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm gap-2 shadow-lg cursor-pointer"
        >
          <RotateCcw className={`h-4 w-4 ${isRestoring ? 'animate-spin' : ''}`} />
          {isRestoring ? 'Reconnecting Camera...' : 'Restore Camera Feed'}
        </Button>

        {/* Troubleshooting Tips Card */}
        <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 text-left space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
            <HelpCircle className="h-3.5 w-3.5 text-indigo-400" />
            Troubleshooting Tips:
          </div>
          <ul className="text-[11px] text-slate-400 space-y-1 list-disc list-inside">
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
