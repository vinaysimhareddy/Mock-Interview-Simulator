import { describe, it, expect, beforeEach } from 'vitest';
import { PassiveAntiSpoofDetector } from '../src/lib/passiveAntiSpoof';
import {
  extractFaceGeometrySignature,
  computeGeometryDeviation,
  Landmark3D,
} from '../src/lib/faceGeometry';
import {
  ChallengeGestureEvaluator,
  generateChallengeSequence,
} from '../src/lib/activeChallenge';
import { FrameSampleForIntegrity } from '../src/lib/integrityTypes';

/**
 * Generates synthetic MediaPipe 478 face landmark mesh with configurable geometry.
 */
function createSyntheticLandmarks(options: {
  centerX?: number;
  centerY?: number;
  width?: number;
  height?: number;
  zDepth?: number;
  jitter?: number;
  foreheadChinRatio?: number;
} = {}): Landmark3D[] {
  const {
    centerX = 0.5,
    centerY = 0.5,
    width = 0.3,
    height = 0.4,
    zDepth = 0.08,
    jitter = 0.0,
    foreheadChinRatio = 1.0,
  } = options;

  const landmarks: Landmark3D[] = [];
  const rand = () => (Math.random() - 0.5) * jitter;

  // Populate base landmarks up to 478
  for (let i = 0; i < 478; i++) {
    landmarks.push({
      x: centerX + (Math.sin(i) * width) / 2 + rand(),
      y: centerY + (Math.cos(i) * height) / 2 + rand(),
      z: -zDepth / 2 + (Math.sin(i * 2) * zDepth) / 2,
    });
  }

  // Key indices (§4.3)
  landmarks[10] = { x: centerX, y: centerY - (height * foreheadChinRatio) / 2 + rand(), z: -0.01 }; // Forehead
  landmarks[152] = { x: centerX, y: centerY + height / 2 + rand(), z: -0.01 }; // Chin
  landmarks[33] = { x: centerX - width / 2 + rand(), y: centerY - 0.05, z: 0.0 }; // Left eye outer
  landmarks[263] = { x: centerX + width / 2 + rand(), y: centerY - 0.05, z: 0.0 }; // Right eye outer
  landmarks[1] = { x: centerX + rand(), y: centerY + rand(), z: zDepth }; // Nose tip (forward in Z)
  landmarks[61] = { x: centerX - 0.08 + rand(), y: centerY + 0.1, z: 0.01 }; // Mouth left
  landmarks[291] = { x: centerX + 0.08 + rand(), y: centerY + 0.1, z: 0.01 }; // Mouth right
  landmarks[234] = { x: centerX - width / 2, y: centerY, z: -0.02 }; // Cheek left
  landmarks[454] = { x: centerX + width / 2, y: centerY, z: -0.02 }; // Cheek right

  return landmarks;
}

describe('Passive Anti-Spoof Detection (§4.1)', () => {
  let detector: PassiveAntiSpoofDetector;

  beforeEach(() => {
    detector = new PassiveAntiSpoofDetector({
      staticDurationMs: 1000,
      loopHistoryWindowSec: 6,
      loopAutocorrelationMinPeak: 0.85,
      badFramingDurationMs: 1000,
      darkDurationMs: 1000,
      faceMissingDurationMs: 1000,
      multipleFacesDurationMs: 1000,
      identityMismatchDurationMs: 2000,
    });
  });

  it('constant frame triggers static_feed after duration threshold', () => {
    const constantPixels = new Uint8ClampedArray(64 * 36).fill(128);
    const constantLandmarks = createSyntheticLandmarks({ jitter: 0 });

    let staticEventsCount = 0;
    const baseTime = 10000;

    // Simulate 12 frames at 100ms intervals (1.2 seconds total, threshold = 1000ms)
    for (let i = 0; i < 15; i++) {
      const now = baseTime + i * 100;
      const events = detector.processFrame({
        timestamp: now,
        faceCount: 1,
        landmarks: constantLandmarks,
        blendshapes: { eyeBlinkLeft: 0, eyeBlinkRight: 0 },
        headPose: { yaw: 0, pitch: 0, roll: 0 },
        downsampledPixels: constantPixels,
        meanLuminance: 128,
      });

      if (events.some((e) => e.flag === 'static_feed')) {
        staticEventsCount++;
      }
    }

    expect(staticEventsCount).toBeGreaterThan(0);
  });

  it('repeating periodic frame sequence triggers loop_suspected', () => {
    // Generate a repeating sinusoidal trace with period ~2.0 seconds
    const loopPeriodMs = 2000;
    const baseTime = 20000;
    let loopDetected = false;

    // Run for 8 seconds (4 repeating cycles)
    for (let i = 0; i < 80; i++) {
      const now = baseTime + i * 100;
      const phase = ((now % loopPeriodMs) / loopPeriodMs) * 2 * Math.PI;
      const periodicLuminance = 120 + 40 * Math.sin(phase);

      const events = detector.processFrame({
        timestamp: now,
        faceCount: 1,
        landmarks: createSyntheticLandmarks({ centerY: 0.5 + 0.05 * Math.sin(phase) }),
        blendshapes: {},
        headPose: { yaw: 5 * Math.sin(phase), pitch: 0, roll: 0 },
        meanLuminance: periodicLuminance,
      });

      if (events.some((e) => e.flag === 'loop_suspected')) {
        loopDetected = true;
      }
    }

    expect(loopDetected).toBe(true);
  });

  it('natural-motion fixture triggers zero fraud or spoofing flags', () => {
    const baseTime = 30000;
    let flaggedEvents: string[] = [];

    // Simulate 5 seconds of natural human sitting with micro-motion and blinks
    for (let i = 0; i < 50; i++) {
      const timingJitter = ((i * 13) % 7) - 3;
      const now = baseTime + i * 100 + timingJitter;
      // Natural micro-jitter + occasional blink around step 20
      const microYaw = Math.sin(i * 0.3) * 1.5;
      const microPitch = Math.cos(i * 0.25) * 1.2;
      const isBlinking = i >= 20 && i <= 22;

      // Realistic downsampled pixels with subtle camera sensor noise
      const noisyPixels = new Uint8ClampedArray(64 * 36);
      for (let p = 0; p < noisyPixels.length; p++) {
        noisyPixels[p] = 120 + Math.floor(Math.sin(p + i) * 6);
      }

      const events = detector.processFrame({
        timestamp: now,
        faceCount: 1,
        landmarks: createSyntheticLandmarks({ jitter: 0.002, zDepth: 0.08 }),
        blendshapes: {
          eyeBlinkLeft: isBlinking ? 0.8 : 0.05,
          eyeBlinkRight: isBlinking ? 0.8 : 0.05,
        },
        headPose: { yaw: microYaw, pitch: microPitch, roll: 0.2 },
        downsampledPixels: noisyPixels,
        meanLuminance: 120,
      });

      for (const e of events) {
        flaggedEvents.push(e.flag);
      }
    }

    // Natural motion with blinks and 3D depth should trigger zero flags
    expect(flaggedEvents).toEqual([]);
  });

  it('hysteresis prevents flapping on transient 1-frame spikes', () => {
    const baseTime = 40000;

    // Send 1 frame with face_missing, then restore face
    const spikeEvent = detector.processFrame({
      timestamp: baseTime,
      faceCount: 0,
      landmarks: null,
      blendshapes: {},
      headPose: { yaw: 0, pitch: 0, roll: 0 },
    });

    // 1 frame (< 1000ms duration) must NOT assert face_missing
    expect(spikeEvent.some((e) => e.flag === 'face_missing')).toBe(false);

    // Frame restored
    const restoredEvent = detector.processFrame({
      timestamp: baseTime + 100,
      faceCount: 1,
      landmarks: createSyntheticLandmarks(),
      blendshapes: {},
      headPose: { yaw: 0, pitch: 0, roll: 0 },
    });

    expect(restoredEvent.some((e) => e.flag === 'face_missing')).toBe(false);
  });
});

describe('Identity Continuity Checker (§4.3)', () => {
  it('detects candidate person swap mid-interview after threshold duration', () => {
    const detector = new PassiveAntiSpoofDetector({
      identityMismatchDurationMs: 1000,
      identityMismatchThreshold: 0.20,
    });

    // 1. Establish calibration baseline for Person A
    const personALandmarks = createSyntheticLandmarks({ width: 0.35, height: 0.45, foreheadChinRatio: 0.8 });
    const baseline = extractFaceGeometrySignature(personALandmarks);
    expect(baseline).not.toBeNull();
    detector.setBaselineGeometry(baseline!);

    // 2. Candidate swap: Person B has substantially different face geometry ratios
    const personBLandmarks = createSyntheticLandmarks({ width: 0.22, height: 0.55, foreheadChinRatio: 1.6 });

    let mismatchDetected = false;
    const baseTime = 50000;

    // Simulate Person B in frame for 1.5 seconds (threshold = 1000ms)
    for (let i = 0; i < 15; i++) {
      const now = baseTime + i * 100;
      const events = detector.processFrame({
        timestamp: now,
        faceCount: 1,
        landmarks: personBLandmarks,
        blendshapes: {},
        headPose: { yaw: 0, pitch: 0, roll: 0 },
      });

      if (events.some((e) => e.flag === 'identity_mismatch')) {
        mismatchDetected = true;
      }
    }

    expect(mismatchDetected).toBe(true);
  });

  it('keeps matching candidate identity verified without mismatch', () => {
    const personLandmarks = createSyntheticLandmarks({ width: 0.3, height: 0.4 });
    const baseline = extractFaceGeometrySignature(personLandmarks)!;

    // Same person with subtle posture/angle jitter
    const samePersonJittered = createSyntheticLandmarks({ width: 0.305, height: 0.405, jitter: 0.001 });
    const sameSig = extractFaceGeometrySignature(samePersonJittered)!;

    const deviation = computeGeometryDeviation(baseline, sameSig);
    expect(deviation).toBeLessThan(0.10); // Well below 0.22 threshold
  });
});

describe('Active Liveness Challenges (§4.2)', () => {
  it('generates random challenge sequences with nonces and timeouts', () => {
    const sequence = generateChallengeSequence(3);
    expect(sequence).toHaveLength(3);
    expect(sequence[0].nonce).toBeDefined();
    expect(sequence[0].prompt).toBeDefined();
    expect(sequence[0].timeoutMs).toBe(6000);
  });

  it('evaluates gestures accurately with ChallengeGestureEvaluator', () => {
    const evaluator = new ChallengeGestureEvaluator();

    // 1. Head turns
    expect(evaluator.evaluateFrame('turn_head_left', { yaw: -20, pitch: 0, roll: 0 }, {}).passed).toBe(true);
    expect(evaluator.evaluateFrame('turn_head_left', { yaw: 0, pitch: 0, roll: 0 }, {}).passed).toBe(false);

    expect(evaluator.evaluateFrame('turn_head_right', { yaw: 22, pitch: 0, roll: 0 }, {}).passed).toBe(true);
    expect(evaluator.evaluateFrame('look_up', { yaw: 0, pitch: -15, roll: 0 }, {}).passed).toBe(true);

    // 2. Facial expressions
    expect(evaluator.evaluateFrame('smile', { yaw: 0, pitch: 0, roll: 0 }, { mouthSmileLeft: 0.7 }).passed).toBe(true);
    expect(evaluator.evaluateFrame('smile', { yaw: 0, pitch: 0, roll: 0 }, { mouthSmileLeft: 0.1 }).passed).toBe(false);

    expect(evaluator.evaluateFrame('open_mouth', { yaw: 0, pitch: 0, roll: 0 }, { jawOpen: 0.65 }).passed).toBe(true);
    expect(evaluator.evaluateFrame('raise_eyebrows', { yaw: 0, pitch: 0, roll: 0 }, { browInnerUp: 0.55 }).passed).toBe(true);

    // 3. Blink twice state machine
    evaluator.reset();
    // Blink 1 down
    evaluator.evaluateFrame('blink_twice', { yaw: 0, pitch: 0, roll: 0 }, { eyeBlinkLeft: 0.8, eyeBlinkRight: 0.8 });
    // Blink 1 up
    evaluator.evaluateFrame('blink_twice', { yaw: 0, pitch: 0, roll: 0 }, { eyeBlinkLeft: 0.1, eyeBlinkRight: 0.1 });
    // Blink 2 down
    const blinkPassed = evaluator.evaluateFrame(
      'blink_twice',
      { yaw: 0, pitch: 0, roll: 0 },
      { eyeBlinkLeft: 0.8, eyeBlinkRight: 0.8 }
    );
    expect(blinkPassed.passed).toBe(true);
  });
});
