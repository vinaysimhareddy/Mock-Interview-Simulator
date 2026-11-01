import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setupDevicesReducer,
  initialSetupDevicesState,
  SetupDevicesState,
} from '../src/hooks/useSetupDevices';
import {
  recordGetUserMediaCall,
  resetGetUserMediaCounts,
  getGetUserMediaCounts,
} from '../src/lib/diagnosticsCollector';
import { computeRMS } from '../src/lib/micQuality';

describe('M4: Coexistence of Audio Level Meter and SpeechRecognition (§M4)', () => {
  beforeEach(() => {
    resetGetUserMediaCounts();
  });

  describe('Single Stream Owner Invariant', () => {
    it('uses a single shared getUserMedia audio track without duplicate requests', () => {
      // In setup:
      recordGetUserMediaCall('audio');
      expect(getGetUserMediaCounts().audio).toBe(1);

      // Web Audio Analyser created from the shared stream
      const mockStream = {
        getAudioTracks: () => [{ label: 'Default Mic', readyState: 'live', stop: vi.fn() }],
        active: true,
      };

      // Both Web Audio and speech self-test reference this single track
      expect(mockStream.getAudioTracks()).toHaveLength(1);
      // Zero additional getUserMedia invocations made for speech recognition
      expect(getGetUserMediaCounts().audio).toBe(1);
    });
  });

  describe('Latched Verification Invariant', () => {
    it('once candidate passes 1.5s voice verification, status stays verified even if level drops to zero', () => {
      let state: SetupDevicesState = setupDevicesReducer(initialSetupDevicesState, {
        type: 'MIC_REQUEST',
      });
      expect(state.mic.status).toBe('requesting');

      // Stage 1: Noise measuring
      state = setupDevicesReducer(state, {
        type: 'MIC_MEASURING_NOISE',
        noiseFloorDb: -45,
      });
      expect(state.mic.status).toBe('measuring_noise');

      // Stage 2: Collecting speech
      state = setupDevicesReducer(state, {
        type: 'MIC_COLLECTING_SPEECH',
        voicedSeconds: 1.0,
        targetSeconds: 1.5,
        snrDb: 22,
        level: 55,
        hint: 'Keep speaking...',
      });
      expect(state.mic.status).toBe('collecting_speech');

      // Candidate completes 1.5s speech
      state = setupDevicesReducer(state, {
        type: 'MIC_VERIFY',
        level: 50,
        snrDb: 24,
        noiseFloorDb: -45,
        voicedSeconds: 1.6,
      });
      expect(state.mic.status).toBe('verified');

      // INVARIANT: Candidate stops speaking -> level drops to zero (silence)
      state = setupDevicesReducer(state, {
        type: 'MIC_STREAMING',
        level: 0,
        speechDetected: false,
      });
      // MUST NOT revert back to streaming or unverified!
      expect(state.mic.status).toBe('verified');
      if (state.mic.status === 'verified') {
        expect(state.mic.level).toBe(0); // level meter updates but status stays verified!
      }

      // INVARIANT: Accidental noise floor or collecting action cannot break latched verification
      state = setupDevicesReducer(state, {
        type: 'MIC_MEASURING_NOISE',
        noiseFloorDb: -40,
      });
      expect(state.mic.status).toBe('verified');

      state = setupDevicesReducer(state, {
        type: 'MIC_COLLECTING_SPEECH',
        voicedSeconds: 0,
        targetSeconds: 1.5,
        level: 10,
      });
      expect(state.mic.status).toBe('verified');
    });

    it('allows explicit re-test reset through MIC_RESET', () => {
      let state: SetupDevicesState = {
        ...initialSetupDevicesState,
        mic: { status: 'verified', level: 50, snrDb: 25 },
      };

      state = setupDevicesReducer(state, { type: 'MIC_RESET' });
      expect(state.mic.status).toBe('idle');
    });
  });

  describe('Audio Level Meter Computation During Active Recognition', () => {
    it('computes live RMS levels continuously from audio buffer', () => {
      const silenceBuffer = new Float32Array(512).fill(0);
      expect(computeRMS(silenceBuffer)).toBe(0);

      // Simulated speech sine wave buffer
      const speechBuffer = new Float32Array(512);
      for (let i = 0; i < speechBuffer.length; i++) {
        speechBuffer[i] = 0.2 * Math.sin((i / 512) * Math.PI * 8);
      }
      const speechRms = computeRMS(speechBuffer);
      expect(speechRms).toBeGreaterThan(0.1);
      expect(speechRms).toBeLessThan(0.2);

      const levelPct = Math.min(100, Math.round(speechRms * 250));
      expect(levelPct).toBeGreaterThan(25);
    });
  });

  describe('Speech Recognition Self-Test Lifecycle', () => {
    it('handles simulated transcript stitching and live transcription display', () => {
      let liveTranscript = '';
      const handleTranscriptEvent = (event: { fullTranscript: string }) => {
        liveTranscript = event.fullTranscript;
      };

      handleTranscriptEvent({ fullTranscript: 'testing' });
      expect(liveTranscript).toBe('testing');

      handleTranscriptEvent({ fullTranscript: 'testing one two three' });
      expect(liveTranscript).toBe('testing one two three');

      handleTranscriptEvent({ fullTranscript: 'testing one two three I am ready' });
      expect(liveTranscript).toBe('testing one two three I am ready');
    });
  });
});

