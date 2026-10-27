/**
 * Active Liveness Challenge Engine (§4.2).
 *
 * Randomly generates and validates challenge gestures (head turns, smiles, blinks, etc.)
 * using blendshapes and head pose. Challenges use unpredictable nonces to prevent
 * replay of pre-recorded video sequences.
 */

import {
  ChallengeActionType,
  LivenessChallengeStep,
} from './integrityTypes';
import { HeadPose } from './types';

export interface ChallengeDefinition {
  action: ChallengeActionType;
  prompt: string;
  defaultTimeoutMs: number;
}

export const CHALLENGE_DEFINITIONS: Record<ChallengeActionType, ChallengeDefinition> = {
  turn_head_left: {
    action: 'turn_head_left',
    prompt: 'Please turn your head to the left',
    defaultTimeoutMs: 6000,
  },
  turn_head_right: {
    action: 'turn_head_right',
    prompt: 'Please turn your head to the right',
    defaultTimeoutMs: 6000,
  },
  look_up: {
    action: 'look_up',
    prompt: 'Please look up towards the top of your screen',
    defaultTimeoutMs: 6000,
  },
  blink_twice: {
    action: 'blink_twice',
    prompt: 'Please blink your eyes twice',
    defaultTimeoutMs: 6000,
  },
  smile: {
    action: 'smile',
    prompt: 'Please smile at the camera',
    defaultTimeoutMs: 6000,
  },
  open_mouth: {
    action: 'open_mouth',
    prompt: 'Please open your mouth slightly',
    defaultTimeoutMs: 6000,
  },
  raise_eyebrows: {
    action: 'raise_eyebrows',
    prompt: 'Please raise your eyebrows',
    defaultTimeoutMs: 6000,
  },
  nod: {
    action: 'nod',
    prompt: 'Please nod your head',
    defaultTimeoutMs: 6000,
  },
};

export const ALL_CHALLENGE_ACTIONS: ChallengeActionType[] = [
  'turn_head_left',
  'turn_head_right',
  'look_up',
  'blink_twice',
  'smile',
  'open_mouth',
  'raise_eyebrows',
  'nod',
];

/**
 * Generates an unpredictable cryptographic nonce.
 */
export function generateChallengeNonce(): string {
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return `nonce-${Date.now()}-${buf[0]}-${buf[1]}`;
  }
  return `nonce-${Date.now()}`;
}

/**
 * Creates a sequence of randomized challenge steps.
 *
 * @param count - Number of distinct challenges to pick (default: 3)
 * @param excludedActions - Optional list of excluded actions for candidate accessibility accommodations
 */
export function generateChallengeSequence(
  count: number = 3,
  excludedActions: ChallengeActionType[] = []
): LivenessChallengeStep[] {
  const allowed = ALL_CHALLENGE_ACTIONS.filter(
    (action) => !excludedActions.includes(action)
  );

  // Cryptographically secure Fisher-Yates shuffle
  const pool = [...allowed];
  const randomBuf = new Uint32Array(pool.length);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(randomBuf);
  }

  for (let i = pool.length - 1; i > 0; i--) {
    const randVal = randomBuf[i] || 0;
    const j = randVal % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const selected = pool.slice(0, Math.min(count, pool.length));

  return selected.map((action, idx) => {
    const def = CHALLENGE_DEFINITIONS[action];
    return {
      id: `step-${idx + 1}-${action}`,
      action,
      prompt: def.prompt,
      nonce: generateChallengeNonce(),
      timeoutMs: def.defaultTimeoutMs,
    };
  });
}

/**
 * State tracker for complex gesture transitions (e.g. blink twice, head nod).
 */
export class ChallengeGestureEvaluator {
  private blinkState: 'open' | 'closed1' | 'opened1' | 'closed2' = 'open';
  private blinkCount: number = 0;
  private nodState: 'neutral' | 'down' | 'up' = 'neutral';

  public reset(): void {
    this.blinkState = 'open';
    this.blinkCount = 0;
    this.nodState = 'neutral';
  }

  /**
   * Evaluates if the current frame satisfies the requested challenge.
   *
   * @param action - The challenge action to evaluate
   * @param headPose - Head rotation in degrees (yaw, pitch, roll)
   * @param blendshapes - MediaPipe blendshape coefficients (0..1)
   * @returns score (0..1) and whether the challenge has been completed
   */
  public evaluateFrame(
    action: ChallengeActionType,
    headPose: HeadPose,
    blendshapes: Record<string, number>
  ): { passed: boolean; score: number } {
    switch (action) {
      case 'turn_head_left': {
        // Yaw < -16 degrees represents candidate turning head to their left
        const rawScore = Math.min(1.0, Math.max(0, -headPose.yaw / 18));
        return { passed: headPose.yaw <= -16, score: rawScore };
      }

      case 'turn_head_right': {
        // Yaw > 16 degrees represents candidate turning head to their right
        const rawScore = Math.min(1.0, Math.max(0, headPose.yaw / 18));
        return { passed: headPose.yaw >= 16, score: rawScore };
      }

      case 'look_up': {
        // Pitch < -11 degrees represents looking upward
        const rawScore = Math.min(1.0, Math.max(0, -headPose.pitch / 14));
        return { passed: headPose.pitch <= -11, score: rawScore };
      }

      case 'smile': {
        const smileLeft = blendshapes['mouthSmileLeft'] || 0;
        const smileRight = blendshapes['mouthSmileRight'] || 0;
        const smileScore = Math.max(smileLeft, smileRight);
        return { passed: smileScore >= 0.45, score: smileScore };
      }

      case 'open_mouth': {
        const jawOpen = blendshapes['jawOpen'] || 0;
        return { passed: jawOpen >= 0.45, score: jawOpen };
      }

      case 'raise_eyebrows': {
        const browInner = blendshapes['browInnerUp'] || 0;
        const browOuterL = blendshapes['browOuterUpLeft'] || 0;
        const browOuterR = blendshapes['browOuterUpRight'] || 0;
        const score = Math.max(browInner, (browOuterL + browOuterR) / 2);
        return { passed: score >= 0.42, score };
      }

      case 'blink_twice': {
        const blinkL = blendshapes['eyeBlinkLeft'] || 0;
        const blinkR = blendshapes['eyeBlinkRight'] || 0;
        const currentBlink = Math.max(blinkL, blinkR);

        if (this.blinkState === 'open') {
          if (currentBlink >= 0.5) {
            this.blinkState = 'closed1';
            this.blinkCount = 1;
          }
        } else if (this.blinkState === 'closed1') {
          if (currentBlink <= 0.2) {
            this.blinkState = 'opened1';
          }
        } else if (this.blinkState === 'opened1') {
          if (currentBlink >= 0.5) {
            this.blinkState = 'closed2';
            this.blinkCount = 2;
          }
        }

        const passed = this.blinkCount >= 2;
        return { passed, score: this.blinkCount / 2 };
      }

      case 'nod': {
        // Nod transition: pitch tilts down >= 8°, then returns towards center <= 3°
        if (this.nodState === 'neutral') {
          if (headPose.pitch >= 8) {
            this.nodState = 'down';
          }
        } else if (this.nodState === 'down') {
          if (headPose.pitch <= 3) {
            this.nodState = 'up';
          }
        }

        const passed = this.nodState === 'up';
        return { passed, score: passed ? 1.0 : this.nodState === 'down' ? 0.5 : 0.0 };
      }

      default:
        return { passed: false, score: 0 };
    }
  }
}
