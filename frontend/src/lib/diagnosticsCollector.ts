/**
 * diagnosticsCollector.ts
 *
 * Collects runtime environment, hardware devices, active stream metadata,
 * track settings, quality metrics, stage timings, audio proofs, and getUserMedia counts (§S6).
 */

import { getVisionDiagnostics, VisionDiagnostics } from './visionManager';

export interface TrackDiagnostics {
  readyState: MediaStreamTrackState | string;
  enabled: boolean;
  muted: boolean;
  id: string;
  label: string;
  settings: MediaTrackSettings;
}

export interface DiagnosticsReport {
  timestamp: string;
  isSecureContext: boolean;
  hasMediaDevices: boolean;
  cameraPermission: string;
  microphonePermission: string;
  devices: Array<{
    deviceId: string;
    kind: MediaDeviceKind;
    label: string;
  }>;
  activeVideoTrack: TrackDiagnostics | null;
  videoElement: {
    videoWidth: number;
    videoHeight: number;
    paused: boolean;
    readyState: number;
  } | null;
  metrics: {
    measuredFps: number;
    meanLuminance: number;
    faceCount: number;
    centeringOffsetPct?: number;
    faceHeightPct?: number;
    sharpnessScore?: number;
    headPose?: { yaw: number; pitch: number; roll: number };
    eyeBlink?: number;
  };
  stageTimings: {
    timeToStreamMs: number | null;
    timeToModelReadyMs: number | null;
    timeToFirstDetectionMs: number | null;
  };
  audioQuality: {
    noiseFloorRms: number | null;
    noiseFloorDb: number | null;
    estimatedSnrDb: number | null;
    voicedSeconds: number | null;
  };
  visionDelegate: VisionDiagnostics;
  getUserMediaCalls: {
    video: number;
    audio: number;
    total: number;
  };
  audioDiagnostics: {
    speechRecognitionSupported: boolean;
    audioContextState: string;
    audioInputs: Array<{
      deviceId: string;
      label: string;
      isDeviceIdEmpty: boolean;
      groupId: string;
    }>;
    activeAudioTrack: {
      readyState: string;
      enabled: boolean;
      muted: boolean;
      id: string;
      label: string;
      settings?: MediaTrackSettings;
    } | null;
    isAudioTrackMutedOrEnded: boolean;
    lastGetUserMediaError: string | null;
    lastSpeechRecognitionError: string | null;
  };
  lastError: string | null;
}

export interface CollectDiagnosticsOptions {
  stream?: MediaStream | null;
  audioStream?: MediaStream | null;
  audioContext?: AudioContext | null;
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
  lastGetUserMediaError?: string | null;
  lastSpeechRecognitionError?: string | null;
}

// ---------------------------------------------------------------------------
// getUserMedia Tracking (§2.3, §S6)
// ---------------------------------------------------------------------------

let videoGetUserMediaCount = 0;
let audioGetUserMediaCount = 0;

export function recordGetUserMediaCall(kind: 'video' | 'audio'): void {
  if (kind === 'video') videoGetUserMediaCount += 1;
  if (kind === 'audio') audioGetUserMediaCount += 1;
}

export function getGetUserMediaCounts(): { video: number; audio: number; total: number } {
  return {
    video: videoGetUserMediaCount,
    audio: audioGetUserMediaCount,
    total: videoGetUserMediaCount + audioGetUserMediaCount,
  };
}

export function resetGetUserMediaCounts(): void {
  videoGetUserMediaCount = 0;
  audioGetUserMediaCount = 0;
}

// ---------------------------------------------------------------------------
// Collector Implementation
// ---------------------------------------------------------------------------

export async function collectDiagnosticsReport(
  options: CollectDiagnosticsOptions = {}
): Promise<DiagnosticsReport> {
  const isSecure = typeof window !== 'undefined' ? window.isSecureContext : false;
  const hasMediaDevices =
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  let cameraPermission = 'unknown';
  let micPermission = 'unknown';

  if (typeof navigator !== 'undefined' && 'permissions' in navigator && navigator.permissions?.query) {
    try {
      // @ts-expect-error PermissionName 'camera' is standard in Chromium/Edge
      const camStatus = await navigator.permissions.query({ name: 'camera' });
      cameraPermission = camStatus.state;
    } catch {
      cameraPermission = 'unsupported';
    }

    try {
      // @ts-expect-error PermissionName 'microphone' is standard in Chromium/Edge
      const micStatus = await navigator.permissions.query({ name: 'microphone' });
      micPermission = micStatus.state;
    } catch {
      micPermission = 'unsupported';
    }
  }

  const devices: DiagnosticsReport['devices'] = [];
  if (typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices) {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      all.forEach((d) => {
        devices.push({
          deviceId: d.deviceId,
          kind: d.kind,
          label: d.label || `(Unlabeled ${d.kind})`,
        });
      });
    } catch {
      // Enumeration blocked
    }
  }

  let activeVideoTrack: TrackDiagnostics | null = null;
  if (options.stream) {
    const track = options.stream.getVideoTracks()[0];
    if (track) {
      activeVideoTrack = {
        readyState: track.readyState,
        enabled: track.enabled,
        muted: track.muted,
        id: track.id,
        label: track.label || '(Unlabeled Track)',
        settings: track.getSettings ? track.getSettings() : {},
      };
    }
  }

  let videoElementData: DiagnosticsReport['videoElement'] = null;
  if (options.videoEl) {
    videoElementData = {
      videoWidth: options.videoEl.videoWidth || 0,
      videoHeight: options.videoEl.videoHeight || 0,
      paused: options.videoEl.paused,
      readyState: options.videoEl.readyState,
    };
  }

  const visionDiagnostics = getVisionDiagnostics();
  const mediaCounts = getGetUserMediaCounts();

  const speechSupported =
    typeof window !== 'undefined' &&
    Boolean(
      window.SpeechRecognition ||
        (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
    );

  const audioInputs: DiagnosticsReport['audioDiagnostics']['audioInputs'] = [];
  devices
    .filter((d) => d.kind === 'audioinput')
    .forEach((d) => {
      audioInputs.push({
        deviceId: d.deviceId,
        label: d.label || '(Unlabeled audio input)',
        isDeviceIdEmpty: !d.deviceId || d.deviceId.length === 0,
        groupId: '',
      });
    });

  let activeAudioTrack: DiagnosticsReport['audioDiagnostics']['activeAudioTrack'] = null;
  let isAudioTrackMutedOrEnded = false;
  if (options.audioStream) {
    const aTrack = options.audioStream.getAudioTracks()[0];
    if (aTrack) {
      activeAudioTrack = {
        readyState: aTrack.readyState,
        enabled: aTrack.enabled,
        muted: aTrack.muted,
        id: aTrack.id,
        label: aTrack.label || '(Unlabeled Audio Track)',
        settings: aTrack.getSettings ? aTrack.getSettings() : {},
      };
      isAudioTrackMutedOrEnded = aTrack.muted || aTrack.readyState === 'ended';
    }
  }

  const audioDiagnostics = {
    speechRecognitionSupported: speechSupported,
    audioContextState: options.audioContext?.state ?? 'null',
    audioInputs,
    activeAudioTrack,
    isAudioTrackMutedOrEnded,
    lastGetUserMediaError: options.lastGetUserMediaError ?? null,
    lastSpeechRecognitionError: options.lastSpeechRecognitionError ?? null,
  };

  return {
    timestamp: new Date().toISOString(),
    isSecureContext: isSecure,
    hasMediaDevices,
    cameraPermission,
    microphonePermission: micPermission,
    devices,
    activeVideoTrack,
    videoElement: videoElementData,
    metrics: {
      measuredFps: options.measuredFps ?? 0,
      meanLuminance: options.meanLuminance ?? 0,
      faceCount: options.faceCount ?? 0,
      centeringOffsetPct: options.centeringOffsetPct,
      faceHeightPct: options.faceHeightPct,
      sharpnessScore: options.sharpnessScore,
      headPose: options.headPose,
      eyeBlink: options.eyeBlink,
    },
    stageTimings: {
      timeToStreamMs: visionDiagnostics.timeToStreamMs,
      timeToModelReadyMs: visionDiagnostics.timeToModelReadyMs,
      timeToFirstDetectionMs: visionDiagnostics.timeToFirstDetectionMs,
    },
    audioQuality: {
      noiseFloorRms: options.noiseFloorRms ?? null,
      noiseFloorDb: options.noiseFloorDb ?? null,
      estimatedSnrDb: options.estimatedSnrDb ?? null,
      voicedSeconds: options.voicedSeconds ?? null,
    },
    visionDelegate: visionDiagnostics,
    getUserMediaCalls: mediaCounts,
    audioDiagnostics,
    lastError: options.lastError ?? null,
  };
}

export function formatDiagnosticsAsMarkdown(report: DiagnosticsReport): string {
  return [
    `# Hardware & Media Diagnostics Report`,
    `Generated: ${report.timestamp}`,
    ``,
    `## Environment & Permissions`,
    `- Secure Context (HTTPS/localhost): ${report.isSecureContext ? 'YES' : 'NO (Camera will be blocked)'}`,
    `- navigator.mediaDevices Available: ${report.hasMediaDevices ? 'YES' : 'NO'}`,
    `- Camera Permission State: ${report.cameraPermission}`,
    `- Microphone Permission State: ${report.microphonePermission}`,
    ``,
    `## Stage Timings & Delegate (§S6)`,
    `- Time to Video Stream: ${report.stageTimings.timeToStreamMs ? `${report.stageTimings.timeToStreamMs.toFixed(0)} ms` : 'N/A'}`,
    `- Time to Vision Model Ready: ${report.stageTimings.timeToModelReadyMs ? `${report.stageTimings.timeToModelReadyMs.toFixed(0)} ms` : 'N/A'}`,
    `- Time to First Face Detection: ${report.stageTimings.timeToFirstDetectionMs ? `${report.stageTimings.timeToFirstDetectionMs.toFixed(0)} ms` : 'N/A'}`,
    `- Vision Delegate: ${report.visionDelegate.delegateUsed || 'CPU (Default)'}`,
    `- Compatibility Mode Active: ${report.visionDelegate.isCompatibilityMode ? 'YES' : 'NO'}`,
    `- Background Preload Completed: ${report.visionDelegate.preloaded ? 'YES' : 'NO'}`,
    ``,
    `## Hardware Acquisition Count (Single-Request Invariant)`,
    `- Video getUserMedia Requests: ${report.getUserMediaCalls.video}`,
    `- Audio getUserMedia Requests: ${report.getUserMediaCalls.audio}`,
    `- Total getUserMedia Invocations: ${report.getUserMediaCalls.total}`,
    ``,
    `## Connected Media Devices (${report.devices.length})`,
    ...report.devices.map((d) => `- [${d.kind}] ${d.label} (id: ${d.deviceId.slice(0, 8)}...)`),
    ``,
    `## Active Video Track`,
    report.activeVideoTrack
      ? [
          `- Label: ${report.activeVideoTrack.label}`,
          `- Ready State: ${report.activeVideoTrack.readyState}`,
          `- Enabled: ${report.activeVideoTrack.enabled}`,
          `- Muted: ${report.activeVideoTrack.muted}`,
          `- Settings: ${JSON.stringify(report.activeVideoTrack.settings)}`,
        ].join('\n')
      : `- No active video track`,
    ``,
    `## Real-Time Proof Metrics & Vision Proofs`,
    `- Measured FPS: ${report.metrics.measuredFps} FPS`,
    `- Mean Luminance: ${report.metrics.meanLuminance.toFixed(1)} / 255 ${report.metrics.meanLuminance < 8 ? '(BLACK IMAGE / SHUTTER WARNING)' : '(OK)'}`,
    `- Detected Face Count: ${report.metrics.faceCount}`,
    `- Centering Offset: ${report.metrics.centeringOffsetPct !== undefined ? `${report.metrics.centeringOffsetPct.toFixed(1)}%` : 'N/A'}`,
    `- Face Height: ${report.metrics.faceHeightPct !== undefined ? `${report.metrics.faceHeightPct.toFixed(1)}%` : 'N/A'}`,
    `- Sharpness Laplacian Score: ${report.metrics.sharpnessScore !== undefined ? report.metrics.sharpnessScore.toFixed(0) : 'N/A'}`,
    `- Head Pose: ${report.metrics.headPose ? `yaw=${report.metrics.headPose.yaw.toFixed(1)}°, pitch=${report.metrics.headPose.pitch.toFixed(1)}°, roll=${report.metrics.headPose.roll.toFixed(1)}°` : 'N/A'}`,
    `- Resolution: ${report.videoElement ? `${report.videoElement.videoWidth}x${report.videoElement.videoHeight}` : 'N/A'}`,
    ``,
    `## Audio Proofs & Microphone Quality`,
    `- Ambient Noise Floor: ${report.audioQuality.noiseFloorDb !== null ? `${report.audioQuality.noiseFloorDb.toFixed(1)} dBFS` : 'N/A'} (RMS: ${report.audioQuality.noiseFloorRms !== null ? report.audioQuality.noiseFloorRms.toFixed(4) : 'N/A'})`,
    `- Estimated Speech SNR: ${report.audioQuality.estimatedSnrDb !== null ? `${report.audioQuality.estimatedSnrDb.toFixed(1)} dB` : 'N/A'}`,
    `- Cumulative Voiced Speech: ${report.audioQuality.voicedSeconds !== null ? `${report.audioQuality.voicedSeconds.toFixed(1)} s / 1.5 s` : 'N/A'}`,
    `- Last Reported Error: ${report.lastError || 'None'}`,
    ``,
    `## Audio Diagnostics & Speech Engine (§M5)`,
    `- Secure Context: ${report.isSecureContext ? 'YES (Microphone access permitted)' : 'NO (Microphone blocked by browser)'}`,
    `- Microphone Permission: ${report.microphonePermission}`,
    `- SpeechRecognition Supported: ${report.audioDiagnostics.speechRecognitionSupported ? 'YES' : 'NO'}`,
    `- AudioContext State: ${report.audioDiagnostics.audioContextState}`,
    `- Last getUserMedia Error: ${report.audioDiagnostics.lastGetUserMediaError || 'None'}`,
    `- Last SpeechRecognition Error: ${report.audioDiagnostics.lastSpeechRecognitionError || 'None'}`,
    `- Active Audio Track: ${report.audioDiagnostics.activeAudioTrack ? `${report.audioDiagnostics.activeAudioTrack.label} (${report.audioDiagnostics.activeAudioTrack.readyState}, muted=${report.audioDiagnostics.activeAudioTrack.muted})` : 'None'}`,
    ...(report.audioDiagnostics.activeAudioTrack?.settings && Object.keys(report.audioDiagnostics.activeAudioTrack.settings).length > 0
      ? [`- Active Audio Track Settings: ${JSON.stringify(report.audioDiagnostics.activeAudioTrack.settings)}`]
      : []),
    `- Audio Track Muted/Ended: ${report.audioDiagnostics.isAudioTrackMutedOrEnded ? 'YES (Microphone lost or muted)' : 'NO (Healthy)'}`,
    `- Audio Input Devices (${report.audioDiagnostics.audioInputs.length}):`,
    ...report.audioDiagnostics.audioInputs.map(
      (m) => `  - ${m.label || '(Unlabeled)'} [ID: ${m.isDeviceIdEmpty ? 'EMPTY' : m.deviceId.slice(0, 8) + '...'}]`
    ),
  ].join('\n');
}
