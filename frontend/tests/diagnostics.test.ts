import { describe, it, expect, beforeEach } from 'vitest';
import {
  collectDiagnosticsReport,
  formatDiagnosticsAsMarkdown,
  recordGetUserMediaCall,
  getGetUserMediaCounts,
  resetGetUserMediaCounts,
} from '../src/lib/diagnosticsCollector';

describe('Diagnostics Collector & Report (F6 / S6)', () => {
  beforeEach(() => {
    resetGetUserMediaCounts();
  });

  it('tracks video and audio getUserMedia call counts for single-request invariant', () => {
    expect(getGetUserMediaCounts()).toEqual({ video: 0, audio: 0, total: 0 });

    recordGetUserMediaCall('video');
    expect(getGetUserMediaCounts()).toEqual({ video: 1, audio: 0, total: 1 });

    recordGetUserMediaCall('audio');
    expect(getGetUserMediaCounts()).toEqual({ video: 1, audio: 1, total: 2 });

    resetGetUserMediaCounts();
    expect(getGetUserMediaCounts()).toEqual({ video: 0, audio: 0, total: 0 });
  });

  it('collects diagnostic report with expected schema and S6 metrics', async () => {
    const fakeTrack = {
      readyState: 'live',
      enabled: true,
      muted: false,
      id: 'trk-123',
      label: 'HD Pro Camera',
      getSettings: () => ({ width: 1280, height: 720, frameRate: 30 }),
    };

    const fakeStream = {
      getVideoTracks: () => [fakeTrack],
    } as unknown as MediaStream;

    const fakeVideo = {
      videoWidth: 1280,
      videoHeight: 720,
      paused: false,
      readyState: 4,
    } as unknown as HTMLVideoElement;

    recordGetUserMediaCall('video');
    recordGetUserMediaCall('audio');

    const report = await collectDiagnosticsReport({
      stream: fakeStream,
      videoEl: fakeVideo,
      measuredFps: 29,
      meanLuminance: 124.5,
      faceCount: 1,
      centeringOffsetPct: 4.5,
      faceHeightPct: 48.2,
      sharpnessScore: 182,
      headPose: { yaw: 1.2, pitch: -0.5, roll: 0.1 },
      noiseFloorRms: 0.0035,
      noiseFloorDb: -49.1,
      estimatedSnrDb: 18.5,
      voicedSeconds: 1.6,
      lastError: null,
    });

    expect(report.timestamp).toBeDefined();
    expect(report.activeVideoTrack?.label).toBe('HD Pro Camera');
    expect(report.activeVideoTrack?.readyState).toBe('live');
    expect(report.videoElement?.videoWidth).toBe(1280);
    expect(report.metrics.measuredFps).toBe(29);
    expect(report.metrics.meanLuminance).toBeCloseTo(124.5, 1);
    expect(report.metrics.faceCount).toBe(1);
    expect(report.metrics.centeringOffsetPct).toBe(4.5);
    expect(report.metrics.faceHeightPct).toBe(48.2);
    expect(report.metrics.sharpnessScore).toBe(182);
    expect(report.metrics.headPose).toEqual({ yaw: 1.2, pitch: -0.5, roll: 0.1 });
    expect(report.audioQuality.noiseFloorRms).toBe(0.0035);
    expect(report.audioQuality.noiseFloorDb).toBe(-49.1);
    expect(report.audioQuality.estimatedSnrDb).toBe(18.5);
    expect(report.audioQuality.voicedSeconds).toBe(1.6);
    expect(report.getUserMediaCalls).toEqual({ video: 1, audio: 1, total: 2 });
    expect(report.lastError).toBeNull();
  });

  it('formats diagnostic report into readable markdown for clipboard copying', async () => {
    recordGetUserMediaCall('video');
    const report = await collectDiagnosticsReport({
      measuredFps: 30,
      meanLuminance: 5.2, // Black image
      faceCount: 0,
      centeringOffsetPct: 15.0,
      faceHeightPct: 45.0,
      sharpnessScore: 85,
      headPose: { yaw: 2.0, pitch: 1.0, roll: 0.0 },
      noiseFloorRms: 0.004,
      noiseFloorDb: -48.0,
      estimatedSnrDb: 14.5,
      voicedSeconds: 1.5,
      lastError: 'Camera in use by Zoom',
    });

    const markdown = formatDiagnosticsAsMarkdown(report);

    expect(markdown).toContain('# Hardware & Media Diagnostics Report');
    expect(markdown).toContain('Environment & Permissions');
    expect(markdown).toContain('Real-Time Proof Metrics');
    expect(markdown).toContain('Stage Timings & Delegate (§S6)');
    expect(markdown).toContain('Hardware Acquisition Count (Single-Request Invariant)');
    expect(markdown).toContain('Video getUserMedia Requests: 1');
    expect(markdown).toContain('Audio Proofs & Microphone Quality');
    expect(markdown).toContain('30 FPS');
    expect(markdown).toContain('BLACK IMAGE / SHUTTER WARNING');
    expect(markdown).toContain('-48.0 dBFS');
    expect(markdown).toContain('Camera in use by Zoom');
  });

  it('collects comprehensive audio diagnostics and speech engine state (§M5)', async () => {
    const fakeAudioTrack = {
      readyState: 'live',
      enabled: true,
      muted: false,
      id: 'mic-trk-999',
      label: 'USB Yeti Microphone',
      getSettings: () => ({
        channelCount: 1,
        sampleRate: 48000,
        echoCancellation: true,
        noiseSuppression: true,
      }),
    };

    const fakeAudioStream = {
      getAudioTracks: () => [fakeAudioTrack],
    } as unknown as MediaStream;

    const fakeAudioContext = {
      state: 'running',
    } as unknown as AudioContext;

    const report = await collectDiagnosticsReport({
      audioStream: fakeAudioStream,
      audioContext: fakeAudioContext,
      lastGetUserMediaError: 'NotReadableError',
      lastSpeechRecognitionError: 'audio-capture',
    });

    expect(report.audioDiagnostics).toBeDefined();
    expect(report.audioDiagnostics.audioContextState).toBe('running');
    expect(report.audioDiagnostics.activeAudioTrack?.label).toBe('USB Yeti Microphone');
    expect(report.audioDiagnostics.activeAudioTrack?.readyState).toBe('live');
    expect(report.audioDiagnostics.activeAudioTrack?.settings).toEqual({
      channelCount: 1,
      sampleRate: 48000,
      echoCancellation: true,
      noiseSuppression: true,
    });
    expect(report.audioDiagnostics.isAudioTrackMutedOrEnded).toBe(false);
    expect(report.audioDiagnostics.lastGetUserMediaError).toBe('NotReadableError');
    expect(report.audioDiagnostics.lastSpeechRecognitionError).toBe('audio-capture');

    const markdown = formatDiagnosticsAsMarkdown(report);
    expect(markdown).toContain('## Audio Diagnostics & Speech Engine (§M5)');
    expect(markdown).toContain('AudioContext State: running');
    expect(markdown).toContain('Active Audio Track: USB Yeti Microphone (live, muted=false)');
    expect(markdown).toContain('Last getUserMedia Error: NotReadableError');
    expect(markdown).toContain('Last SpeechRecognition Error: audio-capture');
    expect(markdown).toContain('Active Audio Track Settings:');
    expect(markdown).toContain('NO (Healthy)');
  });

  it('detects muted or ended audio track in diagnostics (§M5)', async () => {
    const fakeMutedAudioTrack = {
      readyState: 'ended',
      enabled: true,
      muted: true,
      id: 'mic-trk-ended',
      label: 'Disconnected Mic',
      getSettings: () => ({}),
    };

    const fakeAudioStream = {
      getAudioTracks: () => [fakeMutedAudioTrack],
    } as unknown as MediaStream;

    const report = await collectDiagnosticsReport({
      audioStream: fakeAudioStream,
      audioContext: { state: 'suspended' } as AudioContext,
    });

    expect(report.audioDiagnostics.isAudioTrackMutedOrEnded).toBe(true);
    expect(report.audioDiagnostics.audioContextState).toBe('suspended');

    const markdown = formatDiagnosticsAsMarkdown(report);
    expect(markdown).toContain('Audio Track Muted/Ended: YES (Microphone lost or muted)');
  });

  it('handles permission query failure gracefully (§M5)', async () => {
    const report = await collectDiagnosticsReport({});
    expect(['granted', 'denied', 'prompt', 'unsupported', 'unknown']).toContain(
      report.microphonePermission
    );
  });
});
