/**
 * faceQuality.ts
 *
 * Pure functions and hysteresis logic for live face quality checking (§2.1).
 * Evaluates: centering, size/distance, pose, eyes, mouth, lighting, sharpness, stability, and color sanity.
 */

import { FACE_QUALITY_CONFIG, FaceQualityConfig } from './faceQualityConfig';
import { HeadPose } from './types';

export interface LandmarkPoint {
  x: number;
  y: number;
  z?: number;
}

export interface BoundingBox {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export type CriterionId =
  | 'one_face'
  | 'centered'
  | 'distance'
  | 'in_frame'
  | 'facing_camera'
  | 'eyes_open'
  | 'neutral_mouth'
  | 'lighting'
  | 'sharpness'
  | 'stability'
  | 'color_cast';

export interface CriterionResult {
  id: CriterionId;
  name: string;
  passed: boolean;
  isWarningOnly?: boolean;
  hint: string;
  value?: number | string | HeadPose | Record<string, unknown>;
}

export interface PixelBuffer {
  data: Uint8ClampedArray | number[];
  width: number;
  height: number;
}

export interface FaceQualityEvaluationInput {
  faceCount: number;
  landmarks: LandmarkPoint[] | null;
  headPose?: HeadPose | null;
  blendshapes?: Record<string, number> | null;
  facePixels?: PixelBuffer | null;
  bboxHistory?: BoundingBox[] | null;
}

export interface FaceQualityReport {
  overallPassed: boolean;
  qualityScore: number; // 0..100
  firstFailingCriterion: CriterionResult | null;
  criteria: Record<CriterionId, CriterionResult>;
  criteriaList: CriterionResult[];
  bbox: BoundingBox | null;
}

/**
 * Computes 2D bounding box from normalized face mesh landmarks (0..1).
 */
export function computeFaceBoundingBox(landmarks: LandmarkPoint[] | null): BoundingBox | null {
  if (!landmarks || landmarks.length === 0) return null;

  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;

  for (let i = 0; i < landmarks.length; i++) {
    const p = landmarks[i];
    if (p.x < xMin) xMin = p.x;
    if (p.y < yMin) yMin = p.y;
    if (p.x > xMax) xMax = p.x;
    if (p.y > yMax) yMax = p.y;
  }

  const width = Math.max(0, xMax - xMin);
  const height = Math.max(0, yMax - yMin);

  return {
    xMin,
    yMin,
    xMax,
    yMax,
    width,
    height,
    centerX: xMin + width / 2,
    centerY: yMin + height / 2,
  };
}

/**
 * 1. Exactly one face check
 */
export function checkOneFace(faceCount: number): CriterionResult {
  const passed = faceCount === 1;
  let hint = '✓ Exactly one face detected';
  if (faceCount === 0) {
    hint = 'No face detected';
  } else if (faceCount > 1) {
    hint = 'Only you should be visible';
  }
  return {
    id: 'one_face',
    name: 'Single Face',
    passed,
    hint,
    value: faceCount,
  };
}

/**
 * 2. Centered in guide oval check with direction-specific hints.
 */
export function checkCentered(
  bbox: BoundingBox | null,
  config: FaceQualityConfig = FACE_QUALITY_CONFIG
): CriterionResult {
  if (!bbox) {
    return {
      id: 'centered',
      name: 'Centered in Frame',
      passed: false,
      hint: 'Position face in the guide oval',
    };
  }

  const dx = bbox.centerX - config.GUIDE_OVAL_CENTER.x;
  const dy = bbox.centerY - config.GUIDE_OVAL_CENTER.y;

  const xOk = Math.abs(dx) <= config.CENTERING_TOLERANCE_X;
  const yOk = Math.abs(dy) <= config.CENTERING_TOLERANCE_Y;
  const passed = xOk && yOk;

  let hint = '✓ Face is centered';
  if (!passed) {
    const directions: string[] = [];
    // If dy > tolerance, face is too low -> move up
    if (dy > config.CENTERING_TOLERANCE_Y) directions.push('up');
    else if (dy < -config.CENTERING_TOLERANCE_Y) directions.push('down');

    // If dx > tolerance, face is too far right -> move left
    if (dx > config.CENTERING_TOLERANCE_X) directions.push('left');
    else if (dx < -config.CENTERING_TOLERANCE_X) directions.push('right');

    hint = `Move ${directions.join(' and ')}`;
  }

  return {
    id: 'centered',
    name: 'Centered in Frame',
    passed,
    hint,
    value: { dx: Number(dx.toFixed(3)), dy: Number(dy.toFixed(3)) },
  };
}

/**
 * 3. Distance / Face Size (30% to 60% of frame height)
 */
export function checkDistance(
  bbox: BoundingBox | null,
  config: FaceQualityConfig = FACE_QUALITY_CONFIG
): CriterionResult {
  if (!bbox) {
    return {
      id: 'distance',
      name: 'Distance / Size',
      passed: false,
      hint: 'Move closer to the camera',
    };
  }

  const h = bbox.height;
  const passed = h >= config.DISTANCE_MIN_HEIGHT && h <= config.DISTANCE_MAX_HEIGHT;

  let hint = '✓ Good distance from camera';
  if (h < config.DISTANCE_MIN_HEIGHT) {
    hint = 'Move closer';
  } else if (h > config.DISTANCE_MAX_HEIGHT) {
    hint = 'Move back';
  }

  return {
    id: 'distance',
    name: 'Distance / Size',
    passed,
    hint,
    value: Number((h * 100).toFixed(1)),
  };
}

/**
 * 4. Fully in frame (no landmark within 3% of edge)
 */
export function checkFullyInFrame(
  landmarks: LandmarkPoint[] | null,
  config: FaceQualityConfig = FACE_QUALITY_CONFIG
): CriterionResult {
  if (!landmarks || landmarks.length === 0) {
    return {
      id: 'in_frame',
      name: 'Fully in Frame',
      passed: false,
      hint: 'Your face is cut off',
    };
  }

  const margin = config.EDGE_MARGIN_MIN;
  for (let i = 0; i < landmarks.length; i++) {
    const { x, y } = landmarks[i];
    if (x < margin || x > 1 - margin || y < margin || y > 1 - margin) {
      return {
        id: 'in_frame',
        name: 'Fully in Frame',
        passed: false,
        hint: 'Your face is cut off',
      };
    }
  }

  return {
    id: 'in_frame',
    name: 'Fully in Frame',
    passed: true,
    hint: '✓ Entire face is in frame',
  };
}

/**
 * 5. Facing camera (|yaw| <= 12°, |pitch| <= 12°, |roll| <= 10°)
 */
export function checkFacingCamera(
  headPose: HeadPose | null | undefined,
  config: FaceQualityConfig = FACE_QUALITY_CONFIG
): CriterionResult {
  if (!headPose) {
    return {
      id: 'facing_camera',
      name: 'Facing Camera',
      passed: false,
      hint: 'Look straight at the camera',
    };
  }

  const yawOk = Math.abs(headPose.yaw) <= config.POSE_MAX_YAW;
  const pitchOk = Math.abs(headPose.pitch) <= config.POSE_MAX_PITCH;
  const rollOk = Math.abs(headPose.roll) <= config.POSE_MAX_ROLL;
  const passed = yawOk && pitchOk && rollOk;

  return {
    id: 'facing_camera',
    name: 'Facing Camera',
    passed,
    hint: passed ? '✓ Looking directly at camera' : 'Look straight at the camera',
    value: headPose,
  };
}

/**
 * 6. Eyes open (eyeBlink < 0.4 for both eyes)
 */
export function checkEyesOpen(
  blendshapes: Record<string, number> | null | undefined,
  config: FaceQualityConfig = FACE_QUALITY_CONFIG
): CriterionResult {
  if (!blendshapes) {
    return {
      id: 'eyes_open',
      name: 'Eyes Open',
      passed: false,
      hint: 'Keep your eyes open',
    };
  }

  const leftBlink = blendshapes['eyeBlinkLeft'] ?? 0;
  const rightBlink = blendshapes['eyeBlinkRight'] ?? 0;
  const passed = leftBlink < config.EYE_BLINK_MAX && rightBlink < config.EYE_BLINK_MAX;

  return {
    id: 'eyes_open',
    name: 'Eyes Open',
    passed,
    hint: passed ? '✓ Eyes open' : 'Keep your eyes open',
    value: { left: Number(leftBlink.toFixed(2)), right: Number(rightBlink.toFixed(2)) },
  };
}

/**
 * 7. Neutral mouth (jawOpen < 0.25)
 */
export function checkNeutralMouth(
  blendshapes: Record<string, number> | null | undefined,
  config: FaceQualityConfig = FACE_QUALITY_CONFIG
): CriterionResult {
  if (!blendshapes) {
    return {
      id: 'neutral_mouth',
      name: 'Neutral Expression',
      passed: false,
      hint: 'Close your mouth slightly',
    };
  }

  const jawOpen = blendshapes['jawOpen'] ?? 0;
  const passed = jawOpen < config.JAW_OPEN_MAX;

  return {
    id: 'neutral_mouth',
    name: 'Neutral Expression',
    passed,
    hint: passed ? '✓ Neutral expression' : 'Close your mouth slightly',
    value: Number(jawOpen.toFixed(2)),
  };
}

/**
 * 8. Lighting OK (mean luminance 60..200, left/right luminance difference < 35%)
 */
export function checkLighting(
  pixelData: PixelBuffer | null | undefined,
  config: FaceQualityConfig = FACE_QUALITY_CONFIG
): CriterionResult {
  if (!pixelData || pixelData.data.length === 0 || pixelData.width < 2 || pixelData.height < 2) {
    return {
      id: 'lighting',
      name: 'Lighting Quality',
      passed: false,
      hint: 'Too dark: face a light or window',
    };
  }

  const { data, width, height } = pixelData;
  const isRGBA = data.length === width * height * 4;
  const stride = isRGBA ? 4 : 1;
  const midX = Math.floor(width / 2);

  let leftLumaSum = 0;
  let leftCount = 0;
  let rightLumaSum = 0;
  let rightCount = 0;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width * stride;
    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x * stride;
      const luma = isRGBA
        ? 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
        : data[idx];

      if (x < midX) {
        leftLumaSum += luma;
        leftCount++;
      } else {
        rightLumaSum += luma;
        rightCount++;
      }
    }
  }

  const leftMean = leftCount > 0 ? leftLumaSum / leftCount : 0;
  const rightMean = rightCount > 0 ? rightLumaSum / rightCount : 0;
  const totalMean = (leftLumaSum + rightLumaSum) / (leftCount + rightCount || 1);

  const denom = Math.max(1, (leftMean + rightMean) / 2);
  const unevenness = Math.abs(leftMean - rightMean) / denom;

  const lumaOk = totalMean >= config.LUMINANCE_MIN && totalMean <= config.LUMINANCE_MAX;
  const evenOk = unevenness < config.LUMINANCE_UNEVENNESS_MAX;
  const passed = lumaOk && evenOk;

  let hint = '✓ Lighting is balanced and clear';
  if (totalMean < config.LUMINANCE_MIN) {
    hint = 'Too dark: face a light or window';
  } else if (totalMean > config.LUMINANCE_MAX) {
    hint = 'Too bright';
  } else if (!evenOk) {
    hint = 'Uneven lighting';
  }

  return {
    id: 'lighting',
    name: 'Lighting Quality',
    passed,
    hint,
    value: {
      mean: Number(totalMean.toFixed(1)),
      unevennessPct: Number((unevenness * 100).toFixed(1)),
    },
  };
}

/**
 * Computes Laplacian variance on grayscale/RGBA buffer using discrete 3x3 kernel.
 * Higher variance indicates sharper edges; lower indicates blur.
 */
export function computeLaplacianVariance(
  pixels: Uint8ClampedArray | number[],
  width: number,
  height: number
): number {
  if (width < 3 || height < 3) return 0;
  const isRGBA = pixels.length === width * height * 4;
  const stride = isRGBA ? 4 : 1;

  let count = 0;
  let mean = 0;
  let m2 = 0;

  for (let y = 1; y < height - 1; y++) {
    const rowPrev = (y - 1) * width * stride;
    const rowCurr = y * width * stride;
    const rowNext = (y + 1) * width * stride;

    for (let x = 1; x < width - 1; x++) {
      const idx = rowCurr + x * stride;

      const center = isRGBA
        ? 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2]
        : pixels[idx];
      const top = isRGBA
        ? 0.299 * pixels[rowPrev + x * stride] + 0.587 * pixels[rowPrev + x * stride + 1] + 0.114 * pixels[rowPrev + x * stride + 2]
        : pixels[rowPrev + x * stride];
      const bottom = isRGBA
        ? 0.299 * pixels[rowNext + x * stride] + 0.587 * pixels[rowNext + x * stride + 1] + 0.114 * pixels[rowNext + x * stride + 2]
        : pixels[rowNext + x * stride];
      const left = isRGBA
        ? 0.299 * pixels[rowCurr + (x - 1) * stride] + 0.587 * pixels[rowCurr + (x - 1) * stride + 1] + 0.114 * pixels[rowCurr + (x - 1) * stride + 2]
        : pixels[rowCurr + (x - 1) * stride];
      const right = isRGBA
        ? 0.299 * pixels[rowCurr + (x + 1) * stride] + 0.587 * pixels[rowCurr + (x + 1) * stride + 1] + 0.114 * pixels[rowCurr + (x + 1) * stride + 2]
        : pixels[rowCurr + (x + 1) * stride];

      // Standard Laplacian kernel: top + bottom + left + right - 4 * center
      const lap = top + bottom + left + right - 4 * center;

      // Online variance update (Welford's algorithm)
      count++;
      const delta = lap - mean;
      mean += delta / count;
      const delta2 = lap - mean;
      m2 += delta * delta2;
    }
  }

  return count > 1 ? m2 / count : 0;
}

/**
 * 9. Sharp (not blurry) check
 */
export function checkSharpness(
  pixelData: PixelBuffer | null | undefined,
  config: FaceQualityConfig = FACE_QUALITY_CONFIG
): CriterionResult {
  if (!pixelData || pixelData.data.length === 0 || pixelData.width < 3 || pixelData.height < 3) {
    return {
      id: 'sharpness',
      name: 'Image Sharpness',
      passed: false,
      hint: 'Image is blurry: clean the lens or hold still',
    };
  }

  const variance = computeLaplacianVariance(pixelData.data, pixelData.width, pixelData.height);
  const passed = variance >= config.SHARPNESS_LAPLACIAN_MIN;

  return {
    id: 'sharpness',
    name: 'Image Sharpness',
    passed,
    hint: passed ? '✓ Image is sharp and focused' : 'Image is blurry: clean the lens or hold still',
    value: Number(variance.toFixed(1)),
  };
}

/**
 * 10. Color sanity (warn only) - detects green cast or single-channel dominance
 */
export function checkColorSanity(
  pixelData: PixelBuffer | null | undefined,
  config: FaceQualityConfig = FACE_QUALITY_CONFIG
): CriterionResult {
  if (!pixelData || pixelData.data.length === 0) {
    return {
      id: 'color_cast',
      name: 'Color Balance',
      passed: true,
      isWarningOnly: true,
      hint: 'Color balance normal',
    };
  }

  const { data, width, height } = pixelData;
  if (data.length !== width * height * 4) {
    return {
      id: 'color_cast',
      name: 'Color Balance',
      passed: true,
      isWarningOnly: true,
      hint: 'Color balance normal',
    };
  }

  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  const count = width * height;

  for (let i = 0; i < data.length; i += 4) {
    rSum += data[i];
    gSum += data[i + 1];
    bSum += data[i + 2];
  }

  const rMean = rSum / count;
  const gMean = gSum / count;
  const bMean = bSum / count;
  const total = rMean + gMean + bMean;

  let hasHeavyTint = false;
  if (total > 20) {
    const avgOther = (rMean + bMean) / 2;
    // Green dominance check (e.g. green cast)
    if (gMean > config.COLOR_GREEN_DOMINANCE_RATIO * Math.max(1, avgOther) && gMean > 35) {
      hasHeavyTint = true;
    }
    // Single channel dominance check
    const maxFrac = Math.max(rMean, gMean, bMean) / total;
    if (maxFrac > config.COLOR_SINGLE_CHANNEL_MAX_FRACTION) {
      hasHeavyTint = true;
    }
  }

  const passed = !hasHeavyTint;
  return {
    id: 'color_cast',
    name: 'Color Balance',
    passed,
    isWarningOnly: true,
    hint: passed
      ? '✓ Color balance normal'
      : 'Strong color tint detected: check lighting or camera settings',
    value: { r: Math.round(rMean), g: Math.round(gMean), b: Math.round(bMean) },
  };
}

/**
 * 11. Stable (face bbox movement < 2% between frames over last 10 frames)
 */
export function checkStability(
  history: BoundingBox[] | null | undefined,
  config: FaceQualityConfig = FACE_QUALITY_CONFIG
): CriterionResult {
  if (!history || history.length < 2) {
    return {
      id: 'stability',
      name: 'Camera Stability',
      passed: true, // Not enough frames to consider unstable yet
      hint: '✓ Camera is steady',
    };
  }

  const frames = history.slice(-config.STABILITY_HISTORY_FRAMES);
  let maxMovement = 0;

  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1];
    const curr = frames[i];
    const dx = curr.centerX - prev.centerX;
    const dy = curr.centerY - prev.centerY;
    const dist = Math.hypot(dx, dy);
    if (dist > maxMovement) {
      maxMovement = dist;
    }
  }

  const passed = maxMovement < config.STABILITY_MAX_MOVEMENT;

  return {
    id: 'stability',
    name: 'Camera Stability',
    passed,
    hint: passed ? '✓ Camera is steady' : 'Hold still',
    value: Number((maxMovement * 100).toFixed(2)),
  };
}

/**
 * Evaluates all 11 face quality criteria.
 */
export function evaluateFaceQuality(
  input: FaceQualityEvaluationInput,
  config: FaceQualityConfig = FACE_QUALITY_CONFIG
): FaceQualityReport {
  const bbox = computeFaceBoundingBox(input.landmarks);

  const criteriaList: CriterionResult[] = [
    checkOneFace(input.faceCount),
    checkCentered(bbox, config),
    checkDistance(bbox, config),
    checkFullyInFrame(input.landmarks, config),
    checkFacingCamera(input.headPose, config),
    checkEyesOpen(input.blendshapes, config),
    checkNeutralMouth(input.blendshapes, config),
    checkLighting(input.facePixels, config),
    checkSharpness(input.facePixels, config),
    checkStability(input.bboxHistory, config),
    checkColorSanity(input.facePixels, config), // Warning only
  ];

  const criteria = {} as Record<CriterionId, CriterionResult>;
  let blockingCount = 0;
  let blockingPassedCount = 0;
  let firstFailing: CriterionResult | null = null;

  for (const c of criteriaList) {
    criteria[c.id] = c;
    if (!c.isWarningOnly) {
      blockingCount++;
      if (c.passed) {
        blockingPassedCount++;
      } else if (!firstFailing) {
        firstFailing = c;
      }
    }
  }

  const overallPassed = blockingPassedCount === blockingCount;
  const qualityScore = Math.round((blockingPassedCount / (blockingCount || 1)) * 100);

  return {
    overallPassed,
    qualityScore,
    firstFailingCriterion: firstFailing,
    criteria,
    criteriaList,
    bbox,
  };
}

/**
 * Stateful Hysteresis tracker for enabling/disabling Capture Face.
 * Enters ready state after 1.5s continuous pass.
 * Leaves ready state only after 0.5s continuous fail.
 */
export class FaceQualityHysteresis {
  private isReady: boolean = false;
  private passStartTime: number | null = null;
  private failStartTime: number | null = null;
  private passDurationMs: number;
  private failDurationMs: number;

  constructor(
    passDurationMs: number = FACE_QUALITY_CONFIG.HYSTERESIS_PASS_DURATION_MS,
    failDurationMs: number = FACE_QUALITY_CONFIG.HYSTERESIS_FAIL_DURATION_MS
  ) {
    this.passDurationMs = passDurationMs;
    this.failDurationMs = failDurationMs;
  }

  public update(
    currentlyPassing: boolean,
    now: number = performance.now()
  ): { isReady: boolean; progress: number } {
    if (currentlyPassing) {
      this.failStartTime = null;

      if (!this.isReady) {
        if (this.passStartTime === null) {
          this.passStartTime = now;
        }

        const elapsed = now - this.passStartTime;
        if (elapsed >= this.passDurationMs) {
          this.isReady = true;
          return { isReady: true, progress: 1.0 };
        }

        return { isReady: false, progress: Math.min(1.0, elapsed / this.passDurationMs) };
      }

      return { isReady: true, progress: 1.0 };
    }

    // Currently failing
    this.passStartTime = null;

    if (this.isReady) {
      if (this.failStartTime === null) {
        this.failStartTime = now;
      }

      const elapsed = now - this.failStartTime;
      if (elapsed >= this.failDurationMs) {
        this.isReady = false;
        return { isReady: false, progress: 0.0 };
      }

      // Still in hysteresis grace period before dropping ready state
      return { isReady: true, progress: 1.0 };
    }

    return { isReady: false, progress: 0.0 };
  }

  public reset(): void {
    this.isReady = false;
    this.passStartTime = null;
    this.failStartTime = null;
  }

  public getReadyStatus(): boolean {
    return this.isReady;
  }
}
