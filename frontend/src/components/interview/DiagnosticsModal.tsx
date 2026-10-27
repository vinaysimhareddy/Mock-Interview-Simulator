import React, { useState, useEffect } from 'react';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  X,
  Copy,
  Check,
  RefreshCw,
  Video,
  ShieldCheck,
  Monitor,
  Mic,
  Zap,
  Cpu,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  collectDiagnosticsReport,
  formatDiagnosticsAsMarkdown,
  DiagnosticsReport,
} from '@/lib/diagnosticsCollector';

export interface DiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  stream?: MediaStream | null;
  videoEl?: HTMLVideoElement | null;
  measuredFps?: number;
  meanLuminance?: number;
  faceCount?: number;
  centeringOffsetPct?: number;
  faceHeightPct?: number;
  sharpnessScore?: number;
  headPose?: { yaw: number; pitch: number; roll: number };
  eyeBlink?: number;
  noiseFloorRms?: number | null;
  noiseFloorDb?: number | null;
  estimatedSnrDb?: number | null;
  voicedSeconds?: number | null;
  lastError?: string | null;
}

export function DiagnosticsModal({
  isOpen,
  onClose,
  stream,
  videoEl,
  measuredFps,
  meanLuminance,
  faceCount,
  centeringOffsetPct,
  faceHeightPct,
  sharpnessScore,
  headPose,
  eyeBlink,
  noiseFloorRms,
  noiseFloorDb,
  estimatedSnrDb,
  voicedSeconds,
  lastError,
}: DiagnosticsModalProps): React.ReactElement | null {
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const refreshReport = async () => {
    setIsLoading(true);
    const data = await collectDiagnosticsReport({
      stream,
      videoEl,
      measuredFps,
      meanLuminance,
      faceCount,
      centeringOffsetPct,
      faceHeightPct,
      sharpnessScore,
      headPose,
      eyeBlink,
      noiseFloorRms,
      noiseFloorDb,
      estimatedSnrDb,
      voicedSeconds,
      lastError,
    });
    setReport(data);
    setIsLoading(false);
  };

  useEffect(() => {
    if (isOpen) {
      refreshReport();
    }
  }, [
    isOpen,
    stream,
    videoEl,
    measuredFps,
    meanLuminance,
    faceCount,
    centeringOffsetPct,
    faceHeightPct,
    sharpnessScore,
    headPose,
    eyeBlink,
    noiseFloorRms,
    noiseFloorDb,
    estimatedSnrDb,
    voicedSeconds,
    lastError,
  ]);

  if (!isOpen) return null;

  const handleCopy = () => {
    if (!report) return;
    const text = formatDiagnosticsAsMarkdown(report);
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in">
      <Card className="w-full max-w-2xl max-h-[85vh] flex flex-col border-slate-800 bg-slate-900 shadow-2xl overflow-hidden">
        <CardHeader className="pb-3 border-b border-slate-800 flex flex-row items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-indigo-400" />
            <div>
              <CardTitle className="text-base text-white">System & Hardware Diagnostics</CardTitle>
              <span className="text-[11px] text-slate-400">Machine verification & device proof report</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={refreshReport}
              disabled={isLoading}
              className="h-8 text-xs border-slate-700 text-slate-300 gap-1.5 hover:bg-slate-800"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-8 w-8 p-0 text-slate-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto p-4 space-y-4 text-xs font-mono">
          {report ? (
            <>
              {/* Quick Status Pill Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="text-[10px] text-slate-500 uppercase block font-sans">Context</span>
                  <span className="text-xs font-semibold text-white flex items-center gap-1 mt-0.5">
                    {report.isSecureContext ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                    )}
                    {report.isSecureContext ? 'HTTPS / Local' : 'Insecure'}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="text-[10px] text-slate-500 uppercase block font-sans">Camera Perm</span>
                  <span className="text-xs font-semibold text-white flex items-center gap-1 mt-0.5">
                    {report.cameraPermission === 'granted' ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <ShieldCheck className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    )}
                    {report.cameraPermission}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="text-[10px] text-slate-500 uppercase block font-sans">Track Status</span>
                  <span className="text-xs font-semibold text-white flex items-center gap-1 mt-0.5">
                    {report.activeVideoTrack?.readyState === 'live' ? (
                      <Video className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                    )}
                    {report.activeVideoTrack?.readyState || 'No Track'}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="text-[10px] text-slate-500 uppercase block font-sans">Luminance</span>
                  <span className="text-xs font-semibold text-white flex items-center gap-1 mt-0.5">
                    {report.metrics.meanLuminance < 8 ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                    )}
                    {report.metrics.meanLuminance.toFixed(1)} / 255
                  </span>
                </div>
              </div>

              {/* Stage Timings & Delegate Section */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <span className="text-xs font-semibold text-indigo-400 font-sans flex items-center gap-1.5">
                  <Zap className="h-4 w-4" /> Stage Timings & Vision Delegate (§S6)
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-slate-300">
                  <div>
                    <span className="text-slate-500 block text-[10px]">Time to Stream:</span>
                    <strong className="text-white text-xs">
                      {report.stageTimings.timeToStreamMs !== null ? `${report.stageTimings.timeToStreamMs.toFixed(0)} ms` : 'N/A'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Model Ready:</span>
                    <strong className="text-white text-xs">
                      {report.stageTimings.timeToModelReadyMs !== null ? `${report.stageTimings.timeToModelReadyMs.toFixed(0)} ms` : 'N/A'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">First Detection:</span>
                    <strong className="text-white text-xs">
                      {report.stageTimings.timeToFirstDetectionMs !== null ? `${report.stageTimings.timeToFirstDetectionMs.toFixed(0)} ms` : 'N/A'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Delegate Used:</span>
                    <span className="text-xs font-semibold text-emerald-400">
                      {report.visionDelegate.delegateUsed || 'CPU (Fallback)'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Hardware Acquisition Counts Section */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-indigo-400 font-sans flex items-center gap-1.5">
                    <Cpu className="h-4 w-4" /> Hardware Acquisition Counts (Single-Request Invariant)
                  </span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${
                      report.getUserMediaCalls.video <= 1 && report.getUserMediaCalls.audio <= 1
                        ? 'border-emerald-700/60 text-emerald-400 bg-emerald-950/20'
                        : 'border-amber-700/60 text-amber-400 bg-amber-950/20'
                    }`}
                  >
                    {report.getUserMediaCalls.video <= 1 && report.getUserMediaCalls.audio <= 1
                      ? '✓ Single-Request Invariant'
                      : 'Multiple Calls Detected'}
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-slate-300">
                  <div>
                    <span className="text-slate-500 block text-[10px]">Video Requests:</span>
                    <strong className="text-white text-sm">{report.getUserMediaCalls.video}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Audio Requests:</span>
                    <strong className="text-white text-sm">{report.getUserMediaCalls.audio}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Total Invocations:</span>
                    <strong className="text-white text-sm">{report.getUserMediaCalls.total}</strong>
                  </div>
                </div>
              </div>

              {/* Real-Time Vision & Face Alignment Metrics Section */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <span className="text-xs font-semibold text-indigo-400 font-sans flex items-center gap-1.5">
                  <Activity className="h-4 w-4" /> Real-Time Machine Proofs & Face Alignment
                </span>
                <div className="grid grid-cols-3 gap-2 text-slate-300">
                  <div>
                    <span className="text-slate-500 block text-[10px]">FPS (1s Rolling):</span>
                    <strong className="text-white text-sm">{report.metrics.measuredFps} FPS</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Detected Faces:</span>
                    <strong className="text-white text-sm">{report.metrics.faceCount}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Video Resolution:</span>
                    <strong className="text-white text-sm">
                      {report.videoElement
                        ? `${report.videoElement.videoWidth}x${report.videoElement.videoHeight}`
                        : 'N/A'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Centering Offset:</span>
                    <strong className="text-white text-xs">
                      {report.metrics.centeringOffsetPct !== undefined
                        ? `${report.metrics.centeringOffsetPct.toFixed(1)}%`
                        : 'N/A'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Face Height:</span>
                    <strong className="text-white text-xs">
                      {report.metrics.faceHeightPct !== undefined
                        ? `${report.metrics.faceHeightPct.toFixed(1)}%`
                        : 'N/A'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Laplacian Sharpness:</span>
                    <strong className="text-white text-xs">
                      {report.metrics.sharpnessScore !== undefined
                        ? report.metrics.sharpnessScore.toFixed(0)
                        : 'N/A'}
                    </strong>
                  </div>
                </div>
                {report.metrics.headPose && (
                  <div className="pt-1 text-[11px] text-slate-400 flex items-center gap-3">
                    <span>Yaw: <strong className="text-slate-200">{report.metrics.headPose.yaw.toFixed(1)}°</strong></span>
                    <span>Pitch: <strong className="text-slate-200">{report.metrics.headPose.pitch.toFixed(1)}°</strong></span>
                    <span>Roll: <strong className="text-slate-200">{report.metrics.headPose.roll.toFixed(1)}°</strong></span>
                  </div>
                )}
              </div>

              {/* Microphone & Audio Proofs Section */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <span className="text-xs font-semibold text-indigo-400 font-sans flex items-center gap-1.5">
                  <Mic className="h-4 w-4" /> Audio Quality Proofs & Calibration
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-slate-300">
                  <div>
                    <span className="text-slate-500 block text-[10px]">Noise Floor (RMS):</span>
                    <strong className="text-white text-xs">
                      {report.audioQuality.noiseFloorRms !== null
                        ? report.audioQuality.noiseFloorRms.toFixed(4)
                        : 'N/A'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Noise Floor (dBFS):</span>
                    <strong className="text-white text-xs">
                      {report.audioQuality.noiseFloorDb !== null
                        ? `${report.audioQuality.noiseFloorDb.toFixed(1)} dBFS`
                        : 'N/A'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Estimated Speech SNR:</span>
                    <strong className="text-white text-xs">
                      {report.audioQuality.estimatedSnrDb !== null
                        ? `${report.audioQuality.estimatedSnrDb.toFixed(1)} dB`
                        : 'N/A'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Voiced Speech:</span>
                    <strong className="text-white text-xs">
                      {report.audioQuality.voicedSeconds !== null
                        ? `${report.audioQuality.voicedSeconds.toFixed(1)} s / 1.5 s`
                        : 'N/A'}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Active Track Settings */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <span className="text-xs font-semibold text-indigo-400 font-sans flex items-center gap-1.5">
                  <Monitor className="h-4 w-4" /> Active Camera Track & Settings
                </span>
                {report.activeVideoTrack ? (
                  <div className="space-y-1 text-slate-400">
                    <div>
                      Label: <span className="text-white">{report.activeVideoTrack.label}</span>
                    </div>
                    <div>
                      Live: <span className="text-emerald-400">{String(report.activeVideoTrack.readyState === 'live')}</span> | Enabled: <span className="text-emerald-400">{String(report.activeVideoTrack.enabled)}</span> | Muted: <span className="text-white">{String(report.activeVideoTrack.muted)}</span>
                    </div>
                    <pre className="p-2 rounded bg-slate-900 border border-slate-800/80 text-[11px] text-slate-300 overflow-x-auto">
                      {JSON.stringify(report.activeVideoTrack.settings, null, 2)}
                    </pre>
                  </div>
                ) : (
                  <p className="text-slate-500">No active media stream acquired.</p>
                )}
              </div>

              {/* Enumerated Devices */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <span className="text-xs font-semibold text-slate-300 font-sans">
                  Enumerated Hardware Devices ({report.devices.length})
                </span>
                <div className="divide-y divide-slate-900 max-h-36 overflow-y-auto">
                  {report.devices.map((d, i) => (
                    <div key={`${d.deviceId || 'device'}-${d.kind}-${i}`} className="py-1.5 flex items-center justify-between">
                      <span className="text-slate-300 truncate max-w-sm">{d.label}</span>
                      <Badge variant="outline" className="text-[10px] border-slate-800 text-slate-500">
                        {d.kind}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>

              {/* Last Error Notice */}
              {report.lastError && (
                <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-800/80 text-rose-300 text-[11px] flex items-center gap-2 font-sans">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
                  <span>Last Error: {report.lastError}</span>
                </div>
              )}
            </>
          ) : (
            <div className="py-8 text-center text-slate-500">Compiling device report...</div>
          )}
        </CardContent>

        {/* Footer Actions */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between shrink-0">
          <span className="text-[11px] text-slate-500 font-sans">
            Diagnostic logs exclude biometric vectors.
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="text-xs border-indigo-700 text-indigo-300 hover:bg-indigo-950/60 gap-1.5"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied to Clipboard' : 'Copy Report'}
            </Button>
            <Button size="sm" onClick={onClose} className="text-xs bg-slate-800 hover:bg-slate-700 text-white">
              Close
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
