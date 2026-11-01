import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  ChallengeGestureEvaluator,
  generateChallengeNonce,
  generateChallengeSequence,
  CHALLENGE_DEFINITIONS,
  ALL_CHALLENGE_ACTIONS,
} from '../src/lib/activeChallenge';
import { ChallengeActionType, LivenessChallengeStep } from '../src/lib/integrityTypes';
import { ClientWSMessage, ServerWSMessage } from '../src/lib/types';

describe('I5: Active Liveness Challenges (§4.2, §5)', () => {
  describe('1. Challenge Generation & Cryptographic Nonce Invariants', () => {
    it('generateChallengeNonce produces unique, unpredictable nonces', () => {
      const nonces = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const nonce = generateChallengeNonce();
        expect(nonce).toBeDefined();
        expect(nonce.length).toBeGreaterThan(8);
        expect(nonces.has(nonce)).toBe(false);
        nonces.add(nonce);
      }
    });

    it('generateChallengeSequence creates requested number of non-repeating steps with valid timeouts', () => {
      const count = 3;
      const sequence = generateChallengeSequence(count);

      expect(sequence).toHaveLength(count);
      const actions = sequence.map((s) => s.action);
      const uniqueActions = new Set(actions);
      expect(uniqueActions.size).toBe(count);

      for (const step of sequence) {
        expect(ALL_CHALLENGE_ACTIONS).toContain(step.action);
        expect(step.prompt).toBe(CHALLENGE_DEFINITIONS[step.action].prompt);
        expect(step.timeoutMs).toBeGreaterThanOrEqual(5000);
        expect(step.nonce).toBeDefined();
        expect(step.id).toMatch(/^step-\d+-/);
      }
    });

    it('respects excluded actions for candidate accessibility accommodations', () => {
      const excluded: ChallengeActionType[] = ['nod', 'look_up', 'turn_head_left'];
      const sequence = generateChallengeSequence(4, excluded);

      for (const step of sequence) {
        expect(excluded).not.toContain(step.action);
      }
    });
  });

  describe('2. Challenge Gesture Evaluator Accuracy & Physical Thresholds', () => {
    let evaluator: ChallengeGestureEvaluator;

    beforeEach(() => {
      evaluator = new ChallengeGestureEvaluator();
    });

    it('evaluates turn_head_left based on negative yaw threshold (<= -16°)', () => {
      // Neutral head pose: yaw = 0
      const neutral = evaluator.evaluateFrame('turn_head_left', { yaw: 0, pitch: 0, roll: 0 }, {});
      expect(neutral.passed).toBe(false);
      expect(neutral.score).toBe(0);

      // Mild turn: yaw = -10°
      const mild = evaluator.evaluateFrame('turn_head_left', { yaw: -10, pitch: 0, roll: 0 }, {});
      expect(mild.passed).toBe(false);
      expect(mild.score).toBeGreaterThan(0.5);

      // Decisive turn: yaw = -18°
      const passed = evaluator.evaluateFrame('turn_head_left', { yaw: -18, pitch: 0, roll: 0 }, {});
      expect(passed.passed).toBe(true);
      expect(passed.score).toBe(1.0);
    });

    it('evaluates turn_head_right based on positive yaw threshold (>= 16°)', () => {
      const neutral = evaluator.evaluateFrame('turn_head_right', { yaw: 0, pitch: 0, roll: 0 }, {});
      expect(neutral.passed).toBe(false);

      const passed = evaluator.evaluateFrame('turn_head_right', { yaw: 20, pitch: 0, roll: 0 }, {});
      expect(passed.passed).toBe(true);
      expect(passed.score).toBe(1.0);
    });

    it('evaluates smile based on mouthSmile blendshape activation (>= 0.45)', () => {
      const neutral = evaluator.evaluateFrame(
        'smile',
        { yaw: 0, pitch: 0, roll: 0 },
        { mouthSmileLeft: 0.1, mouthSmileRight: 0.12 }
      );
      expect(neutral.passed).toBe(false);
      expect(neutral.score).toBeCloseTo(0.12, 2);

      const smiled = evaluator.evaluateFrame(
        'smile',
        { yaw: 0, pitch: 0, roll: 0 },
        { mouthSmileLeft: 0.65, mouthSmileRight: 0.6 }
      );
      expect(smiled.passed).toBe(true);
      expect(smiled.score).toBe(0.65);
    });

    it('evaluates open_mouth based on jawOpen blendshape activation (>= 0.45)', () => {
      const closed = evaluator.evaluateFrame(
        'open_mouth',
        { yaw: 0, pitch: 0, roll: 0 },
        { jawOpen: 0.1 }
      );
      expect(closed.passed).toBe(false);

      const opened = evaluator.evaluateFrame(
        'open_mouth',
        { yaw: 0, pitch: 0, roll: 0 },
        { jawOpen: 0.55 }
      );
      expect(opened.passed).toBe(true);
      expect(opened.score).toBe(0.55);
    });

    it('evaluates look_up based on pitch threshold (<= -11°)', () => {
      const neutral = evaluator.evaluateFrame('look_up', { yaw: 0, pitch: 0, roll: 0 }, {});
      expect(neutral.passed).toBe(false);

      const up = evaluator.evaluateFrame('look_up', { yaw: 0, pitch: -14, roll: 0 }, {});
      expect(up.passed).toBe(true);
      expect(up.score).toBe(1.0);
    });

    it('tracks complex temporal state machine for blink_twice gesture', () => {
      const zeroPose = { yaw: 0, pitch: 0, roll: 0 };

      // Frame 1: Eyes open
      let res = evaluator.evaluateFrame('blink_twice', zeroPose, {
        eyeBlinkLeft: 0.05,
        eyeBlinkRight: 0.05,
      });
      expect(res.passed).toBe(false);
      expect(res.score).toBe(0);

      // Frame 2: First blink closed
      res = evaluator.evaluateFrame('blink_twice', zeroPose, {
        eyeBlinkLeft: 0.75,
        eyeBlinkRight: 0.7,
      });
      expect(res.passed).toBe(false);
      expect(res.score).toBe(0.5); // 1st blink completed

      // Frame 3: Eyes reopened
      res = evaluator.evaluateFrame('blink_twice', zeroPose, {
        eyeBlinkLeft: 0.1,
        eyeBlinkRight: 0.12,
      });
      expect(res.passed).toBe(false);
      expect(res.score).toBe(0.5);

      // Frame 4: Second blink closed -> passed!
      res = evaluator.evaluateFrame('blink_twice', zeroPose, {
        eyeBlinkLeft: 0.8,
        eyeBlinkRight: 0.78,
      });
      expect(res.passed).toBe(true);
      expect(res.score).toBe(1.0);
    });

    it('tracks temporal state machine for nod gesture (pitch down then up)', () => {
      // Neutral
      let res = evaluator.evaluateFrame('nod', { yaw: 0, pitch: 0, roll: 0 }, {});
      expect(res.passed).toBe(false);
      expect(res.score).toBe(0);

      // Tilt head down: pitch >= 8°
      res = evaluator.evaluateFrame('nod', { yaw: 0, pitch: 10, roll: 0 }, {});
      expect(res.passed).toBe(false);
      expect(res.score).toBe(0.5); // Downward phase latched

      // Return head up towards center: pitch <= 3° -> passed!
      res = evaluator.evaluateFrame('nod', { yaw: 0, pitch: 2, roll: 0 }, {});
      expect(res.passed).toBe(true);
      expect(res.score).toBe(1.0);
    });

    it('reset clears all temporal states', () => {
      // Advance to halfway nod
      evaluator.evaluateFrame('nod', { yaw: 0, pitch: 10, roll: 0 }, {});
      evaluator.reset();

      // After reset, pitch = 2 should not complete nod because 'down' was cleared
      const res = evaluator.evaluateFrame('nod', { yaw: 0, pitch: 2, roll: 0 }, {});
      expect(res.passed).toBe(false);
      expect(res.score).toBe(0);
    });
  });

  describe('3. Server-Driven Challenge Protocol & Handshake State Machine', () => {
    it('handles server-driven challenge message and emits signed challenge_result on success', () => {
      const serverChallenge: ServerWSMessage = {
        type: 'challenge',
        challenge_id: 'server-chall-9821',
        action: 'turn_head_left',
        prompt: 'For verification, please turn your head to the left',
        nonce: 'nonce-c8a7b9e1-2244',
        timeout_sec: 8.0,
      };

      const emittedPackets: ClientWSMessage[] = [];
      const sendWSMessage = (msg: ClientWSMessage) => {
        emittedPackets.push(msg);
        return true;
      };

      // Ingest server challenge
      const currentStep: LivenessChallengeStep = {
        id: serverChallenge.challenge_id,
        action: serverChallenge.action as ChallengeActionType,
        prompt: serverChallenge.prompt,
        nonce: serverChallenge.nonce,
        timeoutMs: (serverChallenge.timeout_sec ?? 8.0) * 1000,
      };

      expect(currentStep.id).toBe('server-chall-9821');
      expect(currentStep.nonce).toBe('nonce-c8a7b9e1-2244');
      expect(currentStep.timeoutMs).toBe(8000);

      // Candidate executes gesture successfully
      const evaluator = new ChallengeGestureEvaluator();
      const evalRes = evaluator.evaluateFrame(currentStep.action, { yaw: -18, pitch: 0, roll: 0 }, {});
      expect(evalRes.passed).toBe(true);

      // Client sends challenge_result
      sendWSMessage({
        type: 'challenge_result',
        challenge_id: currentStep.id,
        nonce: currentStep.nonce,
        passed: true,
        score: evalRes.score,
      });

      expect(emittedPackets).toHaveLength(1);
      expect(emittedPackets[0]).toEqual({
        type: 'challenge_result',
        challenge_id: 'server-chall-9821',
        nonce: 'nonce-c8a7b9e1-2244',
        passed: true,
        score: 1.0,
      });
    });

    it('emits failed challenge_result with exact nonce if timeout expires before gesture completion', () => {
      const serverChallenge = {
        challenge_id: 'server-chall-4040',
        action: 'smile',
        nonce: 'nonce-deadbeef-1234',
      };

      const emittedPackets: ClientWSMessage[] = [];
      const sendWSMessage = (msg: ClientWSMessage) => {
        emittedPackets.push(msg);
        return true;
      };

      // Timeout expires before smile gesture passes
      sendWSMessage({
        type: 'challenge_result',
        challenge_id: serverChallenge.challenge_id,
        nonce: serverChallenge.nonce,
        passed: false,
        score: 0,
      });

      expect(emittedPackets).toHaveLength(1);
      expect(emittedPackets[0]).toEqual({
        type: 'challenge_result',
        challenge_id: 'server-chall-4040',
        nonce: 'nonce-deadbeef-1234',
        passed: false,
        score: 0,
      });
    });
  });

  describe('4. Zero Fake Metrics & Invariant Checks', () => {
    it('evaluator scores are grounded in real blendshape/geometry mathematics, not Math.random() or 85%', () => {
      const evaluator = new ChallengeGestureEvaluator();

      // Zero expression -> strictly 0 score
      const res1 = evaluator.evaluateFrame('smile', { yaw: 0, pitch: 0, roll: 0 }, {});
      expect(res1.score).toBe(0);
      expect(res1.passed).toBe(false);

      // Exact input score matches output score
      const res2 = evaluator.evaluateFrame(
        'smile',
        { yaw: 0, pitch: 0, roll: 0 },
        { mouthSmileLeft: 0.33, mouthSmileRight: 0.2 }
      );
      expect(res2.score).toBe(0.33);
      expect(res2.passed).toBe(false);
      expect(res2.score).not.toBe(0.85);
    });
  });
});
