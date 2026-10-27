import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  Camera,
  CameraOff,
  CheckCircle2,
  Layers,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { MetricsHUD } from './MetricsHUD';
import { useMediaPipeVision, VisionStatus } from '../../hooks/useMediaPipeVision';
import { TelemetrySample } from '../../lib/types';
import { IntegrityFlagEvent } from '../../lib/integrityTypes';

export interface WebcamMonitorStatusInfo {
  status: VisionStatus;
  error: string | null;
  isPhysicalVerified: boolean;
  activeFlags: IntegrityFlagEvent[];
  activeCameraLabel: string;
}

export interface WebcamMonitorAction {
  restore: () => Promise<void>;
  startChallenge: (count?: number) => void;
}

export interface WebcamMonitorProps {
  onTelemetryPacket?: (packet: TelemetrySample) => void;
  showHUD?: boolean;
  className?: string;
  onIntegrityStatusChange?: (info: WebcamMonitorStatusInfo) => void;
  actionRef?: React.MutableRefObject<WebcamMonitorAction | null>;
}

export function WebcamMonitor({
  onTelemetryPacket,
  showHUD = true,
  className = '',
  onIntegrityStatusChange,
  actionRef,
}: WebcamMonitorProps): React.ReactElement {
  const [showOverlay, setShowOverlay] = useState<boolean>(true);

  const {
    status,
    error,
    videoRef,
    canvasRef,
    latestMetrics,
    isCalibrating,
    calibrationProgress,
    availableCameras,
    activeCameraLabel,
    isPhysicalVerified,
    activeIntegrityFlags,
    activeChallenge,
    challengeStatus,
    startCalibration,
    selectCamera,
    startChallenge,
    resetChallenge,
    start,
    stop: _stop,
  } = useMediaPipeVision({
    onTelemetryPacket,
    autoStart: true,
  });

  useEffect(() => {
    if (onIntegrityStatusChange) {
      onIntegrityStatusChange({
        status,
        error,
        isPhysicalVerified,
        activeFlags: activeIntegrityFlags,
        activeCameraLabel,
      });
    }
  }, [status, error, isPhysicalVerified, activeIntegrityFlags, activeCameraLabel, onIntegrityStatusChange]);

  useEffect(() => {
    if (actionRef) {
      actionRef.current = {
        restore: start,
        startChallenge,
      };
    }
  }, [actionRef, start, startChallenge]);

  return (
    <div className={`flex flex-col space-y-3 ${className}`}>
      {/* Video Container Card */}
      <div className="relative aspect-video w-full rounded-2xl bg-slate-950 border border-slate-800 overflow-hidden shadow-2xl flex items-center justify-center">
        {/* Hidden / Visible Video Element */}
        <video
          ref={videoRef}
          playsInline
          muted
          className={`w-full h-full object-cover transform -scale-x-100 ${
            status === 'running' ? 'block' : 'hidden'
          }`}
        />

        {/* Optional Landmark Mesh Overlay Canvas */}
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 w-full h-full pointer-events-none transform -scale-x-100 ${
            showOverlay && status === 'running' ? 'block' : 'hidden'
          }`}
        />

        {/* Status Overlay: Initializing */}
        {status === 'initializing' && (
          <div className="flex flex-col items-center justify-center p-6 text-center space-y-3 z-10">
            <div className="h-10 w-10 border-3 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-white">Initializing Physical Camera</h4>
              <p className="text-xs text-slate-400 max-w-xs">
                Verifying physical hardware feed and loading local MediaPipe neural models...
              </p>
            </div>
          </div>
        )}

        {/* Status Overlay: Permission Denied, Virtual Blocked, or No Camera Error */}
        {status === 'error' && (
          <div className="flex flex-col items-center justify-center p-8 text-center space-y-4 z-10 max-w-md">
            <div className="p-3.5 rounded-full bg-rose-950/80 border border-rose-800 text-rose-400 shadow-lg">
              <CameraOff className="h-8 w-8" />
            </div>
            <div className="space-y-1.5">
              <h4 className="text-base font-bold text-white">Camera Check Failed</h4>
              <p className="text-xs text-rose-300/90 leading-relaxed">{error}</p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <Button
                variant="outline"
                size="sm"
                onClick={start}
                className="gap-1.5 text-xs text-slate-200 border-slate-700 hover:bg-slate-800 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Retry Physical Camera
              </Button>
              {availableCameras.length > 0 && (
                <select
                  onChange={(e) => selectCamera(e.target.value)}
                  className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-md px-2.5 py-1.5 outline-none cursor-pointer"
                >
                  <option value="">Switch to another camera...</option>
                  {availableCameras.map((device, idx) => (
                    <option key={device.deviceId || idx} value={device.deviceId}>
                      {device.label || `Camera ${idx + 1}`}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        )}

        {/* Calibration In-Progress Overlay */}
        {isCalibrating && (
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 space-y-3 z-20 animate-in fade-in">
            <Sparkles className="h-8 w-8 text-indigo-400 animate-bounce" />
            <div className="text-center space-y-1">
              <h4 className="text-sm font-bold text-white">Calibrating Neutral Baseline</h4>
              <p className="text-xs text-slate-300">
                Please sit upright and look straight at the camera (3 seconds)...
              </p>
            </div>
            <div className="w-48 bg-slate-800 rounded-full h-2 overflow-hidden border border-slate-700">
              <div
                className="h-full bg-indigo-500 transition-all duration-100 ease-out"
                style={{ width: `${calibrationProgress}%` }}
              />
            </div>
            <span className="text-[11px] font-mono text-indigo-300">{calibrationProgress}%</span>
          </div>
        )}

        {/* Active Liveness Challenge Overlay Banner (§4.2) */}
        {activeChallenge && challengeStatus === 'in_progress' && (
          <div className="absolute bottom-3 left-3 right-3 bg-indigo-950/90 border border-indigo-500/60 backdrop-blur-md rounded-xl p-3 flex items-center justify-between z-20 shadow-2xl animate-in slide-in-from-bottom-2">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-300 animate-pulse">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">
                    Live Anti-Spoof Challenge
                  </span>
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-ping" />
                </div>
                <p className="text-xs md:text-sm font-semibold text-white">
                  {activeChallenge.prompt}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={resetChallenge}
              className="h-7 text-[11px] text-slate-300 border-slate-700 hover:bg-slate-800"
            >
              Cancel
            </Button>
          </div>
        )}

        {/* Challenge Passed Notice */}
        {challengeStatus === 'passed' && (
          <div className="absolute bottom-3 left-3 right-3 bg-emerald-950/90 border border-emerald-500/60 backdrop-blur-md rounded-xl p-2.5 flex items-center justify-between z-20 shadow-xl animate-in fade-in">
            <div className="flex items-center gap-2 text-emerald-300 text-xs font-semibold">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              Liveness & Anti-Spoof Challenge Passed
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={resetChallenge}
              className="h-6 text-[10px] text-emerald-300 border-emerald-800 hover:bg-emerald-900"
            >
              Dismiss
            </Button>
          </div>
        )}

        {/* Passive Anti-Spoof Warning Indicator Pill (§4.1) */}
        {activeIntegrityFlags.length > 0 && challengeStatus !== 'in_progress' && (
          <div className="absolute bottom-3 left-3 right-3 bg-amber-950/90 border border-amber-500/50 backdrop-blur-md rounded-xl p-2.5 flex items-center gap-2.5 z-20 shadow-xl animate-in fade-in">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
            <span className="text-xs text-amber-200 truncate">
              {activeIntegrityFlags[0].flag === 'static_feed'
                ? 'Camera feed appears static or frozen. Please ensure live webcam feed is active.'
                : activeIntegrityFlags[0].flag === 'loop_suspected'
                ? 'Repeating video loop suspected. Live camera feed required.'
                : activeIntegrityFlags[0].flag === 'multiple_faces'
                ? 'Multiple faces detected in frame. Candidate must be alone.'
                : activeIntegrityFlags[0].flag === 'bad_framing'
                ? 'Please center your face inside the camera frame.'
                : activeIntegrityFlags[0].flag === 'camera_covered'
                ? 'Camera lens appears dark or covered. Please ensure adequate lighting.'
                : activeIntegrityFlags[0].flag === 'identity_mismatch'
                ? 'Face geometry deviation detected. Please sit facing the camera.'
                : 'Camera feed integrity alert. Please check your camera feed.'}
            </span>
          </div>
        )}

        {/* Video Control Pills (Top Right & Left Overlays) */}
        {status === 'running' && (
          <>
            <div className="absolute top-3 left-3 flex flex-wrap items-center gap-2 z-10">
              {isPhysicalVerified ? (
                <Badge
                  variant="outline"
                  className="gap-1.5 bg-emerald-950/80 backdrop-blur-md text-emerald-300 border-emerald-700/60 text-xs py-1"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  Physical camera verified
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="gap-1.5 bg-slate-900/80 backdrop-blur-md text-emerald-400 border-slate-800 text-xs py-1"
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  Live Local Vision
                </Badge>
              )}

              <Badge
                variant="outline"
                className="gap-1 bg-slate-900/80 backdrop-blur-md text-slate-300 border-slate-800 text-[11px] py-1"
              >
                <ShieldCheck className="h-3 w-3 text-indigo-400" />
                No Video Uploaded
              </Badge>
            </div>

            <div className="absolute top-3 right-3 flex items-center gap-2 z-10">
              <Button
                variant="outline"
                size="sm"
                onClick={() => startChallenge(3)}
                disabled={challengeStatus === 'in_progress'}
                className="h-8 px-2.5 text-xs bg-indigo-950/80 backdrop-blur-md border-indigo-800/80 text-indigo-300 hover:text-white cursor-pointer"
                title="Start 3-step active liveness challenge"
              >
                <UserCheck className="h-3.5 w-3.5 mr-1" />
                Verify Liveness
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowOverlay(!showOverlay)}
                className="h-8 px-2.5 text-xs bg-slate-900/80 backdrop-blur-md border-slate-800 text-slate-300 hover:text-white cursor-pointer"
                title="Toggle landmark mesh overlay"
              >
                <Layers className="h-3.5 w-3.5 mr-1 text-indigo-400" />
                {showOverlay ? 'Mesh On' : 'Mesh Off'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={startCalibration}
                disabled={isCalibrating}
                className="h-8 px-2.5 text-xs bg-slate-900/80 backdrop-blur-md border-slate-800 text-slate-300 hover:text-white cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                Recalibrate
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Hardware Device Selection Toolbar (§3.1) */}
      {availableCameras.length > 0 && (
        <div className="flex items-center justify-between px-1 py-1 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <Camera className="h-3.5 w-3.5 text-slate-400" />
            <span className="font-medium text-slate-300">Camera:</span>
            <select
              value={availableCameras.find((c) => c.label === activeCameraLabel)?.deviceId || ''}
              onChange={(e) => selectCamera(e.target.value)}
              className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1 focus:ring-1 focus:ring-indigo-500 outline-none cursor-pointer max-w-[260px] truncate"
              title="Select physical camera"
            >
              {availableCameras.map((device, idx) => (
                <option key={device.deviceId || idx} value={device.deviceId}>
                  {device.label || `Physical Camera ${idx + 1}`}
                </option>
              ))}
            </select>
          </div>
          {activeCameraLabel && (
            <span className="text-[11px] text-slate-500 truncate max-w-xs" title={activeCameraLabel}>
              {activeCameraLabel}
            </span>
          )}
        </div>
      )}

      {/* Embedded Live Metrics HUD */}
      {showHUD && (
        <MetricsHUD
          eyeContactRatio={latestMetrics.eyeContactRatio}
          postureScore={latestMetrics.postureScore}
          headPose={latestMetrics.headPose}
          expression={latestMetrics.expression}
          distractionFlags={latestMetrics.distractionFlags}
          fps={latestMetrics.fps}
          facePresent={latestMetrics.facePresent}
        />
      )}
    </div>
  );
}
