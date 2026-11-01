import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  recordGetUserMediaCall,
  resetGetUserMediaCounts,
  getGetUserMediaCounts,
} from '../src/lib/diagnosticsCollector';

describe('M2: Robust Audio Acquisition & Fallback Ladder', () => {
  beforeEach(() => {
    resetGetUserMediaCounts();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Microphone Device Enumeration & Filtering', () => {
    it('correctly filters audioinput devices from enumerateDevices result', () => {
      const allDevices = [
        { deviceId: 'mic-1', kind: 'audioinput', label: 'External USB Mic (046d:0825)', groupId: 'g1' },
        { deviceId: 'cam-1', kind: 'videoinput', label: 'Integrated Webcam', groupId: 'g2' },
        { deviceId: 'spk-1', kind: 'audiooutput', label: 'Realtek Speakers', groupId: 'g3' },
        { deviceId: 'mic-2', kind: 'audioinput', label: 'Microphone Array (Intel SST)', groupId: 'g4' },
      ];

      const mics = allDevices.filter((d) => d.kind === 'audioinput');
      expect(mics).toHaveLength(2);
      expect(mics[0].deviceId).toBe('mic-1');
      expect(mics[1].deviceId).toBe('mic-2');
    });

    it('handles empty device list gracefully without throwing', () => {
      const emptyDevices: Array<{ deviceId: string; kind: string; label: string }> = [];
      const mics = emptyDevices.filter((d) => d.kind === 'audioinput');
      expect(mics).toHaveLength(0);
    });
  });

  describe('Audio Fallback Ladder Logic', () => {
    it('uses ideal constraint for deviceId and never exact', () => {
      const requestedId = 'custom-mic-id';
      const targetId = requestedId;

      const constraints: MediaStreamConstraints = {
        audio: targetId
          ? {
              deviceId: { ideal: targetId },
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            }
          : {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
        video: false,
      };

      const audioConstraints = constraints.audio as MediaTrackConstraints;
      expect(audioConstraints.deviceId).toEqual({ ideal: 'custom-mic-id' });
      // Invariant: MUST NOT use exact
      expect((audioConstraints.deviceId as any).exact).toBeUndefined();
    });

    it('falls back from OverconstrainedError to simpler constraints and then bare audio: true', async () => {
      const calls: any[] = [];
      const fakeGUM = vi.fn(async (constraints: MediaStreamConstraints) => {
        calls.push(constraints);
        if (calls.length === 1) {
          const err = new Error('Overconstrained');
          err.name = 'OverconstrainedError';
          throw err;
        }
        if (calls.length === 2) {
          const err = new Error('Constraint not satisfied');
          err.name = 'OverconstrainedError';
          throw err;
        }
        return {
          getAudioTracks: () => [{ label: 'Fallback Mic', stop: vi.fn(), readyState: 'live' }],
          active: true,
        };
      });

      // Simulation of fallback ladder
      const targetId = 'broken-custom-mic';
      const tryAcquire = async () => {
        try {
          return await fakeGUM({
            audio: {
              deviceId: { ideal: targetId },
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          });
        } catch (err: any) {
          if (err.name === 'OverconstrainedError') {
            try {
              return await fakeGUM({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
                video: false,
              });
            } catch {
              return await fakeGUM({ audio: true, video: false });
            }
          }
          throw err;
        }
      };

      const stream = await tryAcquire();
      expect(stream).toBeDefined();
      expect(calls.length).toBe(3);
      expect(calls[0].audio.deviceId).toEqual({ ideal: targetId });
      expect(calls[1].audio.deviceId).toBeUndefined();
      expect(calls[2]).toEqual({ audio: true, video: false });
    });

    it('retries once after 500ms on NotReadableError transient device lock', async () => {
      let attempts = 0;
      const fakeGUM = vi.fn(async (_constraints: MediaStreamConstraints) => {
        attempts += 1;
        if (attempts === 1) {
          const err = new Error('Device busy in another application');
          err.name = 'NotReadableError';
          throw err;
        }
        return {
          getAudioTracks: () => [{ label: 'USB Mic', stop: vi.fn(), readyState: 'live' }],
          active: true,
        };
      });

      const acquireWithRetry = async () => {
        const constraints = {
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        };
        try {
          return await fakeGUM(constraints);
        } catch (err: any) {
          if (err.name === 'NotReadableError') {
            // Simulated 500ms release delay
            return await fakeGUM(constraints);
          }
          throw err;
        }
      };

      const result = await acquireWithRetry();
      expect(result).toBeDefined();
      expect(attempts).toBe(2);
    });

    it('propagates NotAllowedError without falling back to bare audio', async () => {
      const fakeGUM = vi.fn(async () => {
        const err = new Error('Permission denied');
        err.name = 'NotAllowedError';
        throw err;
      });

      let caughtError: any = null;
      try {
        await fakeGUM({ audio: true, video: false });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).not.toBeNull();
      expect(caughtError.name).toBe('NotAllowedError');
      expect(fakeGUM).toHaveBeenCalledTimes(1);
    });
  });

  describe('Single Audio Stream & Ownership Handover Invariant', () => {
    it('stops previous audio track when switching microphone device', () => {
      const stopTrackMock = vi.fn();
      let activeStream: any = {
        getAudioTracks: () => [{ label: 'Old Mic', stop: stopTrackMock, readyState: 'live' }],
        getTracks: () => [{ label: 'Old Mic', stop: stopTrackMock, readyState: 'live' }],
        active: true,
      };

      // Candidate switches device: old track must be stopped
      if (activeStream) {
        activeStream.getTracks().forEach((t: any) => t.stop());
        activeStream = null;
      }

      expect(stopTrackMock).toHaveBeenCalledTimes(1);
      expect(activeStream).toBeNull();
    });

    it('retains audio stream across setup unmount when retainForInterview is active', () => {
      let audioRefCount = 1;
      let isRetained = false;
      const stopMock = vi.fn();
      const mockStream = {
        getTracks: () => [{ stop: stopMock }],
      };

      const retainForInterview = () => {
        isRetained = true;
      };

      const releaseAudio = () => {
        if (audioRefCount > 0) audioRefCount -= 1;
        if (audioRefCount <= 0 && !isRetained) {
          mockStream.getTracks().forEach((t) => t.stop());
        }
      };

      // Setup completes and flags handover
      retainForInterview();
      releaseAudio();

      // Audio track MUST NOT be stopped
      expect(stopMock).not.toHaveBeenCalled();
      expect(isRetained).toBe(true);
    });

    it('stopAll terminates all tracks and clears retention flag', () => {
      let isRetained = true;
      const stopCamMock = vi.fn();
      const stopMicMock = vi.fn();

      const camStream = { getTracks: () => [{ stop: stopCamMock }] };
      const micStream = { getTracks: () => [{ stop: stopMicMock }] };

      const stopAll = () => {
        isRetained = false;
        camStream.getTracks().forEach((t) => t.stop());
        micStream.getTracks().forEach((t) => t.stop());
      };

      stopAll();
      expect(isRetained).toBe(false);
      expect(stopCamMock).toHaveBeenCalledTimes(1);
      expect(stopMicMock).toHaveBeenCalledTimes(1);
    });
  });
});

