/**
 * Integrity & Anti-Spoofing Type Definitions (§4).
 */

export type IntegrityFlagType =
  | 'face_missing'
  | 'multiple_faces'
  | 'static_feed'
  | 'loop_suspected'
  | 'no_micro_motion'
  | 'no_blink'
  | 'camera_covered'
  | 'screen_replay_suspected'
  | 'bad_framing'
  | 'timing_anomaly'
  | 'identity_mismatch';

export interface IntegrityFlagEvent {
  flag: IntegrityFlagType;
  confidence: number; // 0.0 to 1.0
  t: number;          // Timestamp (ms)
  details?: Record<string, unknown>;
}

export type ChallengeActionType =
  | 'turn_head_left'
  | 'turn_head_right'
  | 'look_up'
  | 'blink_twice'
  | 'smile'
  | 'open_mouth'
  | 'raise_eyebrows'
  | 'nod';

export interface LivenessChallengeStep {
  id: string;
  action: ChallengeActionType;
  prompt: string;
  nonce: string;
  timeoutMs: number;
}

export interface ChallengeVerificationResult {
  stepId: string;
  action: ChallengeActionType;
  nonce: string;
  passed: boolean;
  score: number;
  timestamp: number;
}

export interface FaceGeometrySignature {
  interOcularToHeight: number;
  noseToChinToHeight: number;
  eyeToNoseToHeight: number;
  mouthWidthToWidth: number;
}

export interface FrameSampleForIntegrity {
  timestamp: number;
  faceCount: number;
  landmarks: Array<{ x: number; y: number; z: number }> | null;
  blendshapes: Record<string, number>;
  headPose: { yaw: number; pitch: number; roll: number };
  downsampledPixels?: Uint8ClampedArray; // Grayscale 64x36
  meanLuminance?: number;
}
