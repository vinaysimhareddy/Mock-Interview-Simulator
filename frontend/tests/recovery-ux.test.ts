import { describe, it, expect, vi } from 'vitest';
import {
  ChallengeGestureEvaluator,
  generateChallengeSequence,
} from '../src/lib/activeChallenge';
import {
  PassiveAntiSpoofDetector,
  IntegrityAccommodationSettings,
} from '../src/lib/passiveAntiSpoof';
import { CameraWatchdog } from '../src/lib/cameraWatchdog';

describe('R5: User Experience, Accommodations & Edge Cases', () => {
  describe('Accessibility Accommodations (§6)', () => {
    it('suppresses micro-movement and posture flags when motor impairment accommodation is active', () => {
      const accommodations: IntegrityAccommodationSettings = {
        motorImpairment: true,
        speechImpairment: false,
      };

      const detector = new PassiveAntiSpoofDetector();
      detector.setAccommodations(accommodations);

      expect(detector.getAccommodations().motorImpairment).toBe(true);
      expect(detector.getAccommodations().speechImpairment).toBe(false);

      // Verify that suppression rule logic is configured
      const suppressedFlags = ['fidgeting', 'micro_movement_anomaly', 'posture_variance'];
      for (const flag of suppressedFlags) {
        expect(detector.isFlagSuppressed(flag)).toBe(true);
      }
    });

    it('suppresses mouth movement and lip-sync flags when speech impairment accommodation is active', () => {
      const accommodations: IntegrityAccommodationSettings = {
        motorImpairment: false,
        speechImpairment: true,
      };

      const detector = new PassiveAntiSpoofDetector();
      detector.setAccommodations(accommodations);

      expect(detector.getAccommodations().speechImpairment).toBe(true);
      const suppressedFlags = ['lip_audio_mismatch', 'mouth_open_frozen', 'speech_atypical'];
      for (const flag of suppressedFlags) {
        expect(detector.isFlagSuppressed(flag)).toBe(true);
      }
    });
  });

  describe('Active Challenge Sequences & Fallbacks (§4.2)', () => {
    it('generates non-repeating cryptographic challenge sequence with nonces', () => {
      const sequence = generateChallengeSequence(3);
      expect(sequence.length).toBe(3);

      for (const step of sequence) {
        expect(step.id).toBeDefined();
        expect(step.nonce).toBeDefined();
        expect(step.nonce.length).toBeGreaterThanOrEqual(16);
        expect(step.prompt).toBeDefined();
        expect(step.timeoutMs).toBe(6000);
      }

      // Check actions are unique in sequence
      const actions = sequence.map((s) => s.action);
      const uniqueActions = new Set(actions);
      expect(uniqueActions.size).toBe(3);
    });

    it('accurately evaluates challenge gestures against blendshapes and landmarks', () => {
      const evaluator = new ChallengeGestureEvaluator();

      // Neutral frame -> not passed
      const neutralRes = evaluator.evaluateFrame(
        'smile',
        { yaw: 0, pitch: 0, roll: 0 },
        { mouthSmileLeft: 0.1, mouthSmileRight: 0.05 }
      );
      expect(neutralRes.passed).toBe(false);

      // Smiling frame -> passed
      const smilingRes = evaluator.evaluateFrame(
        'smile',
        { yaw: 0, pitch: 0, roll: 0 },
        { mouthSmileLeft: 0.75, mouthSmileRight: 0.7 }
      );
      expect(smilingRes.passed).toBe(true);
      expect(smilingRes.score).toBeGreaterThan(0.7);
    });

    it('accurately detects head turns left and right', () => {
      const evaluator = new ChallengeGestureEvaluator();

      const turnLeftSuccess = evaluator.evaluateFrame(
        'turn_head_left',
        { yaw: -20, pitch: 0, roll: 0 },
        {}
      );
      expect(turnLeftSuccess.passed).toBe(true);

      const turnLeftFail = evaluator.evaluateFrame(
        'turn_head_left',
        { yaw: 10, pitch: 0, roll: 0 },
        {}
      );
      expect(turnLeftFail.passed).toBe(false);

      const turnRightSuccess = evaluator.evaluateFrame(
        'turn_head_right',
        { yaw: 20, pitch: 0, roll: 0 },
        {}
      );
      expect(turnRightSuccess.passed).toBe(true);

      const turnRightFail = evaluator.evaluateFrame(
        'turn_head_right',
        { yaw: -10, pitch: 0, roll: 0 },
        {}
      );
      expect(turnRightFail.passed).toBe(false);
    });
  });

  describe('Hardware Watchdog & Edge Cases (§3.3, §5.2)', () => {
    it('dispatches track_ended when physical camera is unplugged mid-interview', () => {
      const mockTrack = {
        readyState: 'live',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getSettings: vi.fn().mockReturnValue({ width: 1280, height: 720, frameRate: 30 }),
      };

      const events: string[] = [];
      const watchdog = new CameraWatchdog(mockTrack as any, null, {
        onIntegrityEvent: (evt) => events.push(evt.type),
      });

      // Find the 'ended' listener registered on track
      const endedCalls = mockTrack.addEventListener.mock.calls.filter(
        (call: any[]) => call[0] === 'ended'
      );
      expect(endedCalls.length).toBe(1);

      // Trigger ended
      endedCalls[0][1]();

      expect(events).toContain('track_ended');
      watchdog.destroy();
    });

    it('dispatches track_muted when hardware privacy shutter or mute switch is engaged', () => {
      const mockTrack = {
        readyState: 'live',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getSettings: vi.fn().mockReturnValue({ width: 1280, height: 720, frameRate: 30 }),
      };

      const events: string[] = [];
      const watchdog = new CameraWatchdog(mockTrack as any, null, {
        onIntegrityEvent: (evt) => events.push(evt.type),
      });

      const muteCalls = mockTrack.addEventListener.mock.calls.filter(
        (call: any[]) => call[0] === 'mute'
      );
      expect(muteCalls.length).toBe(1);

      muteCalls[0][1]();
      expect(events).toContain('track_muted');
      watchdog.destroy();
    });
  });
});
