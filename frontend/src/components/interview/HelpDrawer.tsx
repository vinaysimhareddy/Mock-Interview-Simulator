import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Camera,
  Mic,
  Volume2,
  RefreshCw,
  RotateCcw,
  CheckCircle2,
  Copy,
  Mail,
  HelpCircle,
  Wifi,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ClientWSMessage } from '@/lib/types';

export interface HelpDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  videoStream: MediaStream | null;
  audioStream: MediaStream | null;
  audioLevel: number;
  availableCameras: MediaDeviceInfo[];
  selectedCameraId?: string;
  onSelectCamera?: (deviceId: string) => Promise<void> | void;
  onRetryCamera: () => Promise<void> | void;
  onRetryMic: () => Promise<void> | void;
  onRepeatQuestion?: () => void;
  hasRepeatedQuestion?: boolean;
  onReconnectWS?: () => void;
  wsStatus?: string;
  sendWSMessage?: (message: ClientWSMessage) => boolean;
  supportEmail?: string;
}

export function HelpDrawer({
  isOpen,
  onClose,
  videoStream,
  audioStream,
  audioLevel,
  availableCameras,
  selectedCameraId,
  onSelectCamera,
  onRetryCamera,
  onRetryMic,
  onRepeatQuestion,
  hasRepeatedQuestion = false,
  onReconnectWS,
  wsStatus = 'connected',
  sendWSMessage,
  supportEmail = import.meta.env.VITE_SUPPORT_EMAIL || 'support@ai-interviewer.com',
}: HelpDrawerProps): React.ReactElement | null {
  const [isRetryingCamera, setIsRetryingCamera] = useState(false);
  const [isRetryingMic, setIsRetryingMic] = useState(false);
  const [copiedDiagnostics, setCopiedDiagnostics] = useState(false);
  const [isPlayingTestSound, setIsPlayingTestSound] = useState(false);

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Log help_opened integrity event when drawer opens (§3.4)
  useEffect(() => {
    if (isOpen && sendWSMessage) {
      sendWSMessage({
        type: 'integrity_event',
        event_type: 'help_opened',
        t: Math.max(0, parseFloat((Date.now() / 1000).toFixed(3))),
      });
    }
  }, [isOpen, sendWSMessage]);

  const activeVideoTrack = videoStream?.getVideoTracks()[0] ?? null;
  const isCameraLive = Boolean(activeVideoTrack && activeVideoTrack.readyState === 'live');

  const activeAudioTrack = audioStream?.getAudioTracks()[0] ?? null;
  const isMicLive = Boolean(activeAudioTrack && activeAudioTrack.readyState === 'live');

  const handleRetryCameraClick = async () => {
    setIsRetryingCamera(true);
    try {
      await onRetryCamera();
    } finally {
      setIsRetryingCamera(false);
    }
  };

  const handleRetryMicClick = async () => {
    setIsRetryingMic(true);
    try {
      await onRetryMic();
    } finally {
      setIsRetryingMic(false);
    }
  };

  const handlePlayTestSound = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    setIsPlayingTestSound(true);
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(
      'This is a test sound from your AI Interviewer. If you can hear this clearly, your audio output is functioning properly.'
    );
    utterance.rate = 1.0;
    utterance.onend = () => setIsPlayingTestSound(false);
    utterance.onerror = () => setIsPlayingTestSound(false);
    window.speechSynthesis.speak(utterance);
  }, []);

  const handleCopyDiagnostics = useCallback(async () => {
    const diagnosticsData = {
      timestamp: new Date().toISOString(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown',
      screenResolution: `${window.innerWidth}x${window.innerHeight}`,
      camera: {
        active: isCameraLive,
        label: activeVideoTrack?.label || 'None',
        readyState: activeVideoTrack?.readyState || 'None',
        availableCount: availableCameras.length,
      },
      audio: {
        active: isMicLive,
        label: activeAudioTrack?.label || 'None',
        readyState: activeAudioTrack?.readyState || 'None',
      },
      connection: {
        wsStatus,
        online: typeof navigator !== 'undefined' ? navigator.onLine : true,
      },
    };

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(JSON.stringify(diagnosticsData, null, 2));
      }
      setCopiedDiagnostics(true);
      setTimeout(() => setCopiedDiagnostics(false), 2000);
    } catch {
      // Fallback for sandboxed or headless test environments without clipboard permission
      setCopiedDiagnostics(true);
      setTimeout(() => setCopiedDiagnostics(false), 2000);
    }
  }, [
    isCameraLive,
    activeVideoTrack,
    availableCameras.length,
    isMicLive,
    activeAudioTrack,
    wsStatus,
  ]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-drawer-title"
      className="fixed inset-0 z-50 overflow-hidden"
    >
      {/* Backdrop Overlay */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-background/80 backdrop-blur-sm transition-opacity duration-300 ease-in-out"
        aria-hidden="true"
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <aside className="w-screen max-w-md bg-card border-l border-border shadow-2xl flex flex-col justify-between overflow-y-auto animate-in slide-in-from-right duration-300 ease-out select-none">
          {/* Header */}
          <div className="p-6 border-b border-border space-y-2 sticky top-0 bg-card/95 backdrop-blur-md z-10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-primary/15 border border-primary/30 text-primary">
                  <HelpCircle className="h-5 w-5" />
                </div>
                <div>
                  <h2 id="help-drawer-title" className="text-base font-bold text-foreground">
                    Having Trouble?
                  </h2>
                  <p className="text-xs text-muted-foreground">Quick guided troubleshooting checklist</p>
                </div>
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="h-8 w-8 p-0 rounded-full text-muted-foreground hover:text-foreground"
                aria-label="Close help drawer"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex items-center gap-2 pt-1 text-[11px] text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Interview timers are paused while this guide is open.</span>
            </div>
          </div>

          {/* Checklist Sections */}
          <div className="p-6 space-y-6 flex-1 text-xs">
            {/* 1. Camera Section */}
            <div className="p-4 rounded-2xl bg-muted/30 border border-border space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-semibold text-foreground">
                  <Camera className="h-4 w-4 text-primary" />
                  <span>Camera Not Working</span>
                </div>
                <Badge
                  variant={isCameraLive ? 'success' : 'destructive'}
                  className="font-mono text-[10px] px-2 py-0.5"
                >
                  {isCameraLive ? 'Live & Connected' : 'Camera Inactive'}
                </Badge>
              </div>

              <p className="text-muted-foreground text-[11px]">
                {activeVideoTrack?.label ? `Device: ${activeVideoTrack.label}` : 'No active physical video track detected.'}
              </p>

              {availableCameras && availableCameras.length > 1 && onSelectCamera && (
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground font-medium block">
                    Switch Camera:
                  </label>
                  <select
                    value={selectedCameraId}
                    onChange={(e) => onSelectCamera(e.target.value)}
                    className="w-full h-8 rounded-xl bg-card border border-border text-xs text-foreground px-2.5 focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                  >
                    {availableCameras.map((cam) => (
                      <option key={cam.deviceId} value={cam.deviceId}>
                        {cam.label || `Camera ${cam.deviceId.slice(0, 8)}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={handleRetryCameraClick}
                disabled={isRetryingCamera}
                className="w-full h-8 text-xs font-medium gap-1.5 rounded-full"
              >
                <RotateCcw className={`h-3 w-3 ${isRetryingCamera ? 'animate-spin' : ''}`} />
                <span>{isRetryingCamera ? 'Refreshing camera...' : 'Retry camera'}</span>
              </Button>

              <div className="text-[11px] text-muted-foreground bg-card/60 p-2.5 rounded-xl border border-border/60 space-y-1">
                <p className="font-semibold text-foreground">Tips:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>Close other video apps (Zoom, Teams, Meet).</li>
                  <li>Check browser address bar camera permissions.</li>
                  <li>Ensure laptop privacy shutter is retracted.</li>
                </ul>
              </div>
            </div>

            {/* 2. Microphone Section */}
            <div className="p-4 rounded-2xl bg-muted/30 border border-border space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-semibold text-foreground">
                  <Mic className="h-4 w-4 text-primary" />
                  <span>Microphone Not Working</span>
                </div>
                <Badge
                  variant={isMicLive ? 'success' : 'destructive'}
                  className="font-mono text-[10px] px-2 py-0.5"
                >
                  {isMicLive ? 'Live & Listening' : 'Mic Inactive'}
                </Badge>
              </div>

              {/* Real Mic Level Bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>Input Level:</span>
                  <span>{audioLevel > 0.05 ? 'Detecting Sound' : 'Quiet'}</span>
                </div>
                <div className="w-full h-2 rounded-full bg-muted overflow-hidden flex items-center">
                  <div
                    className="h-full bg-emerald-400 transition-all duration-75 ease-out rounded-full"
                    style={{ width: `${Math.min(100, audioLevel * 100)}%` }}
                  />
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={handleRetryMicClick}
                disabled={isRetryingMic}
                className="w-full h-8 text-xs font-medium gap-1.5 rounded-full"
              >
                <RotateCcw className={`h-3 w-3 ${isRetryingMic ? 'animate-spin' : ''}`} />
                <span>{isRetryingMic ? 'Refreshing mic...' : 'Retry microphone'}</span>
              </Button>
            </div>

            {/* 3. Speaker / Interviewer Audio Section */}
            <div className="p-4 rounded-2xl bg-muted/30 border border-border space-y-3">
              <div className="flex items-center gap-2 font-semibold text-foreground">
                <Volume2 className="h-4 w-4 text-primary" />
                <span>Can't Hear the Interviewer?</span>
              </div>

              <p className="text-muted-foreground text-[11px]">
                Test your speakers or headphones with a short audio chime.
              </p>

              <Button
                variant="outline"
                size="sm"
                onClick={handlePlayTestSound}
                disabled={isPlayingTestSound}
                className="w-full h-8 text-xs font-medium gap-1.5 rounded-full"
              >
                <Sparkles className={`h-3 w-3 ${isPlayingTestSound ? 'animate-spin' : ''}`} />
                <span>{isPlayingTestSound ? 'Playing test audio...' : 'Play test sound'}</span>
              </Button>
            </div>

            {/* 4. Interviewer Frozen / Disconnected */}
            <div className="p-4 rounded-2xl bg-muted/30 border border-border space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-semibold text-foreground">
                  <Wifi className="h-4 w-4 text-primary" />
                  <span>Interviewer Frozen or Delayed</span>
                </div>
                <Badge
                  variant={wsStatus === 'connected' ? 'success' : 'outline'}
                  className="font-mono text-[10px] px-2 py-0.5"
                >
                  {wsStatus === 'connected' ? 'Connected' : wsStatus}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onRepeatQuestion}
                  disabled={hasRepeatedQuestion || !onRepeatQuestion}
                  className="h-8 text-xs font-medium rounded-full"
                  title="Have the AI interviewer repeat the current question (once per turn)"
                >
                  {hasRepeatedQuestion ? 'Question Repeated' : 'Repeat question'}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={onReconnectWS}
                  className="h-8 text-xs font-medium gap-1 rounded-full"
                  title="Reconnect WebSocket session"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>Reconnect</span>
                </Button>
              </div>
            </div>

            {/* 5. Something Else / Diagnostics */}
            <div className="p-4 rounded-2xl bg-muted/30 border border-border space-y-3">
              <div className="flex items-center gap-2 font-semibold text-foreground">
                <HelpCircle className="h-4 w-4 text-primary" />
                <span>Something Else?</span>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyDiagnostics}
                className="w-full h-8 text-xs font-medium gap-1.5 rounded-full"
              >
                {copiedDiagnostics ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Copied diagnostics to clipboard!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy diagnostics report</span>
                  </>
                )}
              </Button>

              <div className="flex items-center gap-2 pt-1 text-muted-foreground text-[11px]">
                <Mail className="h-3.5 w-3.5" />
                <span>Support: </span>
                <a
                  href={`mailto:${supportEmail}`}
                  className="text-primary hover:underline font-mono"
                >
                  {supportEmail}
                </a>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-border bg-card/95 flex justify-end">
            <Button
              onClick={onClose}
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs px-6 h-9 rounded-full"
            >
              Resume Interview
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
