/**
 * Face Geometry Consistency Checker (§4.3).
 *
 * Computes a normalized, scale-invariant geometric signature from MediaPipe face mesh landmarks.
 *
 * PRIVACY & ETHICS NOTE:
 * This is a transient, in-memory geometric consistency check during an active session to detect
 * mid-interview person swaps. It is NOT biometric identification, and NO biometric templates,
 * images, or identifiable signatures are ever persisted or transmitted to any server.
 */

import { FaceGeometrySignature } from './integrityTypes';

export interface Landmark3D {
  x: number;
  y: number;
  z: number;
}

// Key MediaPipe 468/478 Landmark Indices
const FOREHEAD_TOP = 10;
const CHIN_BOTTOM = 152;
const EYE_OUTER_LEFT = 33;
const EYE_OUTER_RIGHT = 263;
const NOSE_TIP = 1;
const MOUTH_LEFT = 61;
const MOUTH_RIGHT = 291;
const CHEEK_LEFT = 234;
const CHEEK_RIGHT = 454;

function distance2D(p1: Landmark3D, p2: Landmark3D): number {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

/**
 * Extracts a normalized, scale-invariant geometry signature from face mesh landmarks.
 * Returns null if landmarks are missing or malformed.
 */
export function extractFaceGeometrySignature(
  landmarks: Landmark3D[]
): FaceGeometrySignature | null {
  if (!landmarks || landmarks.length < 468) {
    return null;
  }

  const forehead = landmarks[FOREHEAD_TOP];
  const chin = landmarks[CHIN_BOTTOM];
  const eyeLeft = landmarks[EYE_OUTER_LEFT];
  const eyeRight = landmarks[EYE_OUTER_RIGHT];
  const nose = landmarks[NOSE_TIP];
  const mouthL = landmarks[MOUTH_LEFT];
  const mouthR = landmarks[MOUTH_RIGHT];
  const cheekL = landmarks[CHEEK_LEFT];
  const cheekR = landmarks[CHEEK_RIGHT];

  const faceHeight = distance2D(forehead, chin);
  const faceWidth = distance2D(cheekL, cheekR);

  // Guard against near-zero height or width
  if (faceHeight < 0.001 || faceWidth < 0.001) {
    return null;
  }

  const interOcular = distance2D(eyeLeft, eyeRight);
  const noseToChin = distance2D(nose, chin);
  
  // Midpoint between eyes to nose tip
  const eyeMidX = (eyeLeft.x + eyeRight.x) / 2;
  const eyeMidY = (eyeLeft.y + eyeRight.y) / 2;
  const eyeToNose = Math.hypot(nose.x - eyeMidX, nose.y - eyeMidY);

  const mouthWidth = distance2D(mouthL, mouthR);

  return {
    interOcularToHeight: interOcular / faceHeight,
    noseToChinToHeight: noseToChin / faceHeight,
    eyeToNoseToHeight: eyeToNose / faceHeight,
    mouthWidthToWidth: mouthWidth / faceWidth,
  };
}

/**
 * Computes normalized geometric difference between two face signatures (0.0 to 1.0+).
 */
export function computeGeometryDeviation(
  sig1: FaceGeometrySignature,
  sig2: FaceGeometrySignature
): number {
  const dInterOcular = Math.abs(sig1.interOcularToHeight - sig2.interOcularToHeight);
  const dNoseChin = Math.abs(sig1.noseToChinToHeight - sig2.noseToChinToHeight);
  const dEyeNose = Math.abs(sig1.eyeToNoseToHeight - sig2.eyeToNoseToHeight);
  const dMouth = Math.abs(sig1.mouthWidthToWidth - sig2.mouthWidthToWidth);

  // Weighted normalized L1 deviation
  return (
    dInterOcular * 0.35 +
    dNoseChin * 0.25 +
    dEyeNose * 0.25 +
    dMouth * 0.15
  );
}
