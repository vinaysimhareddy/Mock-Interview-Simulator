import React, { useEffect, useRef } from 'react';
import { UserX, ShieldAlert, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export interface FaceLostModalProps {
  isOpen: boolean;
  missingSeconds: number;
  videoStream?: MediaStream | null;
  onFaceRestored?: () => void;
}

export function FaceLostModal({
  isOpen,
  missingSeconds,
  videoStream,
  onFaceRestored: _onFaceRestored,
}: FaceLostModalProps): React.ReactElement | null {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (isOpen && videoRef.current && videoStream) {
      videoRef.current.srcObject = videoStream;
      videoRef.current.play().catch(() => {});
    }
  }, [isOpen, videoStream]);

  if (!isOpen) return null;

  // Warning tiers according to policy §3.5:
  // >= 3s: soft popup
  // >= 10s: Warning 1 of 2
  // >= 20s: Warning 2 of 2
  // >= 30s: abort
  const isWarning1 = missingSeconds >= 10 && missingSeconds < 20;
  const isWarning2 = missingSeconds >= 20 && missingSeconds < 30;
  const isCritical = missingSeconds >= 20;
  const remainingUntilAbort = Math.max(0, 30 - Math.floor(missingSeconds));

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="face-lost-title"
      className="fixed inset-0 z-50 bg-background/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
    >
      <div className="w-full max-w-md bg-card border border-border rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 text-center">
        {/* Pulsing Alert Icon */}
        <div className="relative mx-auto w-16 h-16 flex items-center justify-center">
          <span
            className={`absolute inset-0 rounded-full animate-ping ${
              isCritical ? 'bg-destructive/30' : 'bg-amber-500/20'
            }`}
          />
          <div
            className={`relative p-4 rounded-full border shadow-lg ${
              isCritical
                ? 'bg-destructive/15 border-destructive/40 text-destructive'
                : 'bg-amber-500/15 border-amber-500/40 text-amber-500'
            }`}
          >
            {isCritical ? <ShieldAlert className="h-8 w-8" /> : <UserX className="h-8 w-8" />}
          </div>
        </div>

        {/* Title & Warning Header */}
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2">
            {isWarning2 ? (
              <Badge variant="destructive" className="font-mono text-xs uppercase tracking-wider">
                Warning 2 of 2 • Final Notice
              </Badge>
            ) : isWarning1 ? (
              <Badge variant="outline" className="border-amber-500/50 text-amber-500 font-mono text-xs uppercase tracking-wider">
                Warning 1 of 2
              </Badge>
            ) : (
              <span className="text-amber-500 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" />
                Face Not Detected
              </span>
            )}
          </div>

          <h2 id="face-lost-title" className="text-xl sm:text-2xl font-bold text-foreground">
            Please Return to Camera View
          </h2>

          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
            {isWarning2
              ? 'Continued absence from camera view will conclude the interview session automatically.'
              : 'Your face must remain clearly visible in the camera frame to preserve interview integrity. Timers are paused.'}
          </p>
        </div>

        {/* Live Camera Viewfinder to help candidate align */}
        <div className="relative aspect-video w-full rounded-2xl bg-muted overflow-hidden border border-border shadow-inner">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="w-full h-full object-cover transform -scale-x-100"
          />
          <div className="absolute inset-4 rounded-xl border-2 border-dashed border-amber-400/40 pointer-events-none flex items-center justify-center">
            <span className="text-[11px] text-amber-200/80 bg-background/70 px-2 py-0.5 rounded-full backdrop-blur-sm">
              Center your face here
            </span>
          </div>
        </div>

        {/* Countdown Grace Meter */}
        <div className="p-3.5 rounded-2xl bg-muted/40 border border-border space-y-2 text-left">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground font-medium">Auto-abort countdown</span>
            <span
              className={`font-mono font-bold ${
                isCritical ? 'text-destructive animate-pulse' : 'text-foreground'
              }`}
            >
              {remainingUntilAbort}s remaining
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                isCritical ? 'bg-destructive' : 'bg-amber-400'
              }`}
              style={{ width: `${(remainingUntilAbort / 30) * 100}%` }}
            />
          </div>
        </div>

        <div className="text-[11px] text-muted-foreground flex items-center justify-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
          <span>This dialog will close automatically as soon as your face is detected.</span>
        </div>
      </div>
    </div>
  );
}
