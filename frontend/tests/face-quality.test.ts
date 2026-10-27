import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeFaceBoundingBox,
  checkOneFace,
  checkCentered,
  checkDistance,
  checkFullyInFrame,
  checkFacingCamera,
  checkEyesOpen,
  checkNeutralMouth,
  checkLighting,
  computeLaplacianVariance,
  checkSharpness,
  checkColorSanity,
  checkStability,
  evaluateFaceQuality,
  FaceQualityHysteresis,
  BoundingBox,
  PixelBuffer,
} from '../src/lib/faceQuality';
import { FACE_QUALITY_CONFIG } from '../src/lib/faceQualityConfig';

// Helper to create synthetic RGBA pixel buffer
function createSyntheticPixels(
  width: number,
  height: number,
  fillFn: (x: number, y: number) => [number, number, number, number]
): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const [r, g, b, a] = fillFn(x, y);
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }
  return { data, width, height };
}

describe('Face Quality Engine - Pure Functions', () => {
  describe('computeFaceBoundingBox', () => {
    it('returns null for empty or null landmarks', () => {
      expect(computeFaceBoundingBox(null)).toBeNull();
      expect(computeFaceBoundingBox([])).toBeNull();
    });

    it('computes correct min/max and center coordinates', () => {
      const landmarks = [
        { x: 0.2, y: 0.1 },
        { x: 0.6, y: 0.7 },
        { x: 0.4, y: 0.5 },
      ];
      const bbox = computeFaceBoundingBox(landmarks);
      expect(bbox).not.toBeNull();
      expect(bbox?.xMin).toBe(0.2);
      expect(bbox?.xMax).toBe(0.6);
      expect(bbox?.yMin).toBe(0.1);
      expect(bbox?.yMax).toBe(0.7);
      expect(bbox?.width).toBeCloseTo(0.4);
      expect(bbox?.height).toBeCloseTo(0.6);
      expect(bbox?.centerX).toBeCloseTo(0.4);
      expect(bbox?.centerY).toBeCloseTo(0.4);
    });
  });

  describe('checkOneFace', () => {
    it('passes when exactly 1 face is present', () => {
      const res = checkOneFace(1);
      expect(res.passed).toBe(true);
      expect(res.hint).toContain('one face');
    });

    it('fails with "No face detected" when faceCount is 0', () => {
      const res = checkOneFace(0);
      expect(res.passed).toBe(false);
      expect(res.hint).toBe('No face detected');
    });

    it('fails with "Only you should be visible" when faceCount > 1', () => {
      const res = checkOneFace(2);
      expect(res.passed).toBe(false);
      expect(res.hint).toBe('Only you should be visible');
    });
  });

  describe('checkCentered', () => {
    it('passes when center is within ±12% of guide oval (0.5, 0.5)', () => {
      const bbox: BoundingBox = {
        xMin: 0.3,
        xMax: 0.7,
        yMin: 0.3,
        yMax: 0.7,
        width: 0.4,
        height: 0.4,
        centerX: 0.52,
        centerY: 0.48,
      };
      const res = checkCentered(bbox);
      expect(res.passed).toBe(true);
    });

    it('suggests "Move up" when face is too low (centerY > 0.62)', () => {
      const bbox: BoundingBox = {
        xMin: 0.3,
        xMax: 0.7,
        yMin: 0.5,
        yMax: 0.9,
        width: 0.4,
        height: 0.4,
        centerX: 0.5,
        centerY: 0.70, // 0.20 below center
      };
      const res = checkCentered(bbox);
      expect(res.passed).toBe(false);
      expect(res.hint).toBe('Move up');
    });

    it('suggests "Move down" when face is too high (centerY < 0.38)', () => {
      const bbox: BoundingBox = {
        xMin: 0.3,
        xMax: 0.7,
        yMin: 0.1,
        yMax: 0.5,
        width: 0.4,
        height: 0.4,
        centerX: 0.5,
        centerY: 0.30,
      };
      const res = checkCentered(bbox);
      expect(res.passed).toBe(false);
      expect(res.hint).toBe('Move down');
    });

    it('suggests combined direction like "Move up and left" when both axes fail', () => {
      const bbox: BoundingBox = {
        xMin: 0.5,
        xMax: 0.9,
        yMin: 0.5,
        yMax: 0.9,
        width: 0.4,
        height: 0.4,
        centerX: 0.70, // Too far right -> move left
        centerY: 0.70, // Too far down -> move up
      };
      const res = checkCentered(bbox);
      expect(res.passed).toBe(false);
      expect(res.hint).toBe('Move up and left');
    });
  });

  describe('checkDistance', () => {
    it('passes when face height is between 30% and 60% of frame', () => {
      const bbox: BoundingBox = {
        xMin: 0.3,
        xMax: 0.7,
        yMin: 0.3,
        yMax: 0.75,
        width: 0.4,
        height: 0.45,
        centerX: 0.5,
        centerY: 0.5,
      };
      const res = checkDistance(bbox);
      expect(res.passed).toBe(true);
    });

    it('fails with "Move closer" when face height is < 30%', () => {
      const bbox: BoundingBox = {
        xMin: 0.4,
        xMax: 0.6,
        yMin: 0.4,
        yMax: 0.6,
        width: 0.2,
        height: 0.20,
        centerX: 0.5,
        centerY: 0.5,
      };
      const res = checkDistance(bbox);
      expect(res.passed).toBe(false);
      expect(res.hint).toBe('Move closer');
    });

    it('fails with "Move back" when face height is > 60%', () => {
      const bbox: BoundingBox = {
        xMin: 0.15,
        xMax: 0.85,
        yMin: 0.15,
        yMax: 0.85,
        width: 0.7,
        height: 0.70,
        centerX: 0.5,
        centerY: 0.5,
      };
      const res = checkDistance(bbox);
      expect(res.passed).toBe(false);
      expect(res.hint).toBe('Move back');
    });
  });

  describe('checkFullyInFrame', () => {
    it('passes when all landmarks are within the safe margin (3%..97%)', () => {
      const landmarks = [
        { x: 0.05, y: 0.05 },
        { x: 0.5, y: 0.5 },
        { x: 0.95, y: 0.95 },
      ];
      const res = checkFullyInFrame(landmarks);
      expect(res.passed).toBe(true);
    });

    it('fails when any landmark is within 3% of the edge', () => {
      const landmarks = [
        { x: 0.01, y: 0.5 }, // off left edge
        { x: 0.5, y: 0.5 },
      ];
      const res = checkFullyInFrame(landmarks);
      expect(res.passed).toBe(false);
      expect(res.hint).toBe('Your face is cut off');
    });
  });

  describe('checkFacingCamera', () => {
    it('passes when yaw, pitch, roll are within limits', () => {
      const res = checkFacingCamera({ yaw: 5, pitch: -6, roll: 3 });
      expect(res.passed).toBe(true);
    });

    it('fails when yaw exceeds 12°', () => {
      const res = checkFacingCamera({ yaw: 18, pitch: 0, roll: 0 });
      expect(res.passed).toBe(false);
      expect(res.hint).toBe('Look straight at the camera');
    });

    it('fails when pitch exceeds 12°', () => {
      const res = checkFacingCamera({ yaw: 0, pitch: -16, roll: 0 });
      expect(res.passed).toBe(false);
    });

    it('fails when roll exceeds 10°', () => {
      const res = checkFacingCamera({ yaw: 0, pitch: 0, roll: 14 });
      expect(res.passed).toBe(false);
    });
  });

  describe('checkEyesOpen', () => {
    it('passes when both eye blinks are < 0.4', () => {
      const res = checkEyesOpen({ eyeBlinkLeft: 0.1, eyeBlinkRight: 0.15 });
      expect(res.passed).toBe(true);
    });

    it('fails when either eye is closed (>= 0.4)', () => {
      const res = checkEyesOpen({ eyeBlinkLeft: 0.75, eyeBlinkRight: 0.1 });
      expect(res.passed).toBe(false);
      expect(res.hint).toBe('Keep your eyes open');
    });
  });

  describe('checkNeutralMouth', () => {
    it('passes when jawOpen is < 0.25', () => {
      const res = checkNeutralMouth({ jawOpen: 0.05 });
      expect(res.passed).toBe(true);
    });

    it('fails when jawOpen is >= 0.25', () => {
      const res = checkNeutralMouth({ jawOpen: 0.45 });
      expect(res.passed).toBe(false);
      expect(res.hint).toBe('Close your mouth slightly');
    });
  });

  describe('checkLighting', () => {
    it('passes on clear, evenly lit face (luma 120, evenness < 35%)', () => {
      const pixels = createSyntheticPixels(64, 64, () => [120, 120, 120, 255]);
      const res = checkLighting(pixels);
      expect(res.passed).toBe(true);
    });

    it('fails with "Too dark" when mean luma < 60', () => {
      const pixels = createSyntheticPixels(64, 64, () => [30, 30, 30, 255]);
      const res = checkLighting(pixels);
      expect(res.passed).toBe(false);
      expect(res.hint).toBe('Too dark: face a light or window');
    });

    it('fails with "Too bright" when mean luma > 200', () => {
      const pixels = createSyntheticPixels(64, 64, () => [230, 230, 230, 255]);
      const res = checkLighting(pixels);
      expect(res.passed).toBe(false);
      expect(res.hint).toBe('Too bright');
    });

    it('fails with "Uneven lighting" when left/right difference >= 35%', () => {
      // Left side bright (160), right side dark (60)
      const pixels = createSyntheticPixels(64, 64, (x) =>
        x < 32 ? [160, 160, 160, 255] : [60, 60, 60, 255]
      );
      const res = checkLighting(pixels);
      expect(res.passed).toBe(false);
      expect(res.hint).toBe('Uneven lighting');
    });
  });

  describe('checkSharpness and computeLaplacianVariance', () => {
    it('detects blurry or uniform image (low variance < 80)', () => {
      const flat = createSyntheticPixels(64, 64, () => [128, 128, 128, 255]);
      const variance = computeLaplacianVariance(flat.data, flat.width, flat.height);
      expect(variance).toBeLessThan(5);

      const res = checkSharpness(flat);
      expect(res.passed).toBe(false);
      expect(res.hint).toBe('Image is blurry: clean the lens or hold still');
    });

    it('detects sharp image with high-frequency edges (variance >= 80)', () => {
      // Checkerboard with high contrast transitions
      const sharp = createSyntheticPixels(64, 64, (x, y) =>
        (x % 4 < 2) !== (y % 4 < 2) ? [240, 240, 240, 255] : [20, 20, 20, 255]
      );
      const variance = computeLaplacianVariance(sharp.data, sharp.width, sharp.height);
      expect(variance).toBeGreaterThan(100);

      const res = checkSharpness(sharp);
      expect(res.passed).toBe(true);
    });
  });

  describe('checkColorSanity', () => {
    it('passes for balanced neutral skin-tone lighting', () => {
      const natural = createSyntheticPixels(32, 32, () => [150, 130, 120, 255]);
      const res = checkColorSanity(natural);
      expect(res.passed).toBe(true);
      expect(res.isWarningOnly).toBe(true);
    });

    it('flags warning for strong green color cast', () => {
      const greenCast = createSyntheticPixels(32, 32, () => [40, 190, 40, 255]);
      const res = checkColorSanity(greenCast);
      expect(res.passed).toBe(false);
      expect(res.isWarningOnly).toBe(true);
      expect(res.hint).toContain('Strong color tint detected');
    });

    it('flags warning for extreme single-channel dominance', () => {
      const redDominant = createSyntheticPixels(32, 32, () => [220, 15, 15, 255]);
      const res = checkColorSanity(redDominant);
      expect(res.passed).toBe(false);
      expect(res.hint).toContain('Strong color tint detected');
    });
  });

  describe('checkStability', () => {
    it('passes when movement is < 2% over consecutive frames', () => {
      const history: BoundingBox[] = [];
      for (let i = 0; i < 10; i++) {
        history.push({
          xMin: 0.3 + i * 0.001,
          xMax: 0.7 + i * 0.001,
          yMin: 0.3,
          yMax: 0.7,
          width: 0.4,
          height: 0.4,
          centerX: 0.5 + i * 0.001,
          centerY: 0.5,
        });
      }
      const res = checkStability(history);
      expect(res.passed).toBe(true);
    });

    it('fails with "Hold still" when movement is >= 2% between frames', () => {
      const history: BoundingBox[] = [
        { xMin: 0.3, xMax: 0.7, yMin: 0.3, yMax: 0.7, width: 0.4, height: 0.4, centerX: 0.5, centerY: 0.5 },
        { xMin: 0.35, xMax: 0.75, yMin: 0.3, yMax: 0.7, width: 0.4, height: 0.4, centerX: 0.55, centerY: 0.5 }, // 5% jump
      ];
      const res = checkStability(history);
      expect(res.passed).toBe(false);
      expect(res.hint).toBe('Hold still');
    });
  });

  describe('evaluateFaceQuality', () => {
    it('returns overallPassed: true and qualityScore: 100 when all criteria pass', () => {
      const sharpPixels = createSyntheticPixels(64, 64, (x, y) =>
        (x % 4 < 2) !== (y % 4 < 2) ? [180, 180, 180, 255] : [70, 70, 70, 255]
      );
      const landmarks = [
        { x: 0.3, y: 0.3 },
        { x: 0.7, y: 0.7 },
      ];
      const report = evaluateFaceQuality({
        faceCount: 1,
        landmarks,
        headPose: { yaw: 0, pitch: 0, roll: 0 },
        blendshapes: { eyeBlinkLeft: 0.1, eyeBlinkRight: 0.1, jawOpen: 0.05 },
        facePixels: sharpPixels,
        bboxHistory: [],
      });

      expect(report.overallPassed).toBe(true);
      expect(report.qualityScore).toBe(100);
      expect(report.firstFailingCriterion).toBeNull();
    });

    it('identifies first failing blocking criterion and highlights its hint', () => {
      const sharpPixels = createSyntheticPixels(64, 64, (x, y) =>
        (x % 4 < 2) !== (y % 4 < 2) ? [180, 180, 180, 255] : [70, 70, 70, 255]
      );
      // Face is too low (centerY = 0.75)
      const landmarks = [
        { x: 0.3, y: 0.55 },
        { x: 0.7, y: 0.95 },
      ];
      const report = evaluateFaceQuality({
        faceCount: 1,
        landmarks,
        headPose: { yaw: 0, pitch: 0, roll: 0 },
        blendshapes: { eyeBlinkLeft: 0.1, eyeBlinkRight: 0.1, jawOpen: 0.05 },
        facePixels: sharpPixels,
        bboxHistory: [],
      });

      expect(report.overallPassed).toBe(false);
      expect(report.firstFailingCriterion?.id).toBe('centered');
      expect(report.firstFailingCriterion?.hint).toBe('Move up');
      expect(report.qualityScore).toBeLessThan(100);
    });

    it('does not let warning-only color cast block overallPassed if all others pass', () => {
      // Green cast, but sharp and within luminance range
      const greenSharp = createSyntheticPixels(64, 64, (x, y) =>
        (x % 4 < 2) !== (y % 4 < 2) ? [50, 190, 50, 255] : [20, 110, 20, 255]
      );
      const landmarks = [
        { x: 0.3, y: 0.3 },
        { x: 0.7, y: 0.7 },
      ];
      const report = evaluateFaceQuality({
        faceCount: 1,
        landmarks,
        headPose: { yaw: 0, pitch: 0, roll: 0 },
        blendshapes: { eyeBlinkLeft: 0.1, eyeBlinkRight: 0.1, jawOpen: 0.05 },
        facePixels: greenSharp,
        bboxHistory: [],
      });

      expect(report.criteria.color_cast.passed).toBe(false);
      // Because color_cast is warning only, overallPassed is still true!
      expect(report.overallPassed).toBe(true);
    });
  });
});

describe('FaceQualityHysteresis', () => {
  let hysteresis: FaceQualityHysteresis;

  beforeEach(() => {
    hysteresis = new FaceQualityHysteresis(1500, 500);
  });

  it('starts not ready with 0 progress', () => {
    expect(hysteresis.getReadyStatus()).toBe(false);
  });

  it('requires 1.5s continuous pass before entering ready state', () => {
    // At t = 0
    let res = hysteresis.update(true, 1000);
    expect(res.isReady).toBe(false);
    expect(res.progress).toBe(0);

    // At t = 750ms
    res = hysteresis.update(true, 1750);
    expect(res.isReady).toBe(false);
    expect(res.progress).toBeCloseTo(0.5);

    // At t = 1499ms
    res = hysteresis.update(true, 2499);
    expect(res.isReady).toBe(false);

    // At t = 1500ms -> Ready!
    res = hysteresis.update(true, 2500);
    expect(res.isReady).toBe(true);
    expect(res.progress).toBe(1.0);
    expect(hysteresis.getReadyStatus()).toBe(true);
  });

  it('resets progress if passing is interrupted before 1.5s', () => {
    hysteresis.update(true, 1000);
    hysteresis.update(true, 1800); // 800ms

    // Drop for 1 frame
    const res = hysteresis.update(false, 1900);
    expect(res.isReady).toBe(false);
    expect(res.progress).toBe(0);

    // Start again at t = 2000
    hysteresis.update(true, 2000);
    const mid = hysteresis.update(true, 3000); // Only 1000ms from restart
    expect(mid.isReady).toBe(false);
  });

  it('stays ready during brief failure (< 500ms) due to hysteresis', () => {
    // Attain ready status
    hysteresis.update(true, 1000);
    hysteresis.update(true, 2500); // Ready!
    expect(hysteresis.getReadyStatus()).toBe(true);

    // Brief glitch of 250ms
    let res = hysteresis.update(false, 2600);
    expect(res.isReady).toBe(true); // Still ready (in grace period)

    res = hysteresis.update(false, 2800);
    expect(res.isReady).toBe(true); // Still ready (300ms fail < 500ms)

    // Recovers before 500ms expires
    res = hysteresis.update(true, 2900);
    expect(res.isReady).toBe(true);
  });

  it('drops ready status when failing continuously for >= 500ms', () => {
    // Attain ready status
    hysteresis.update(true, 1000);
    hysteresis.update(true, 2500);
    expect(hysteresis.getReadyStatus()).toBe(true);

    // Fail starts at t = 3000
    hysteresis.update(false, 3000);
    hysteresis.update(false, 3400); // 400ms -> still ready
    expect(hysteresis.getReadyStatus()).toBe(true);

    // At t = 3500 (500ms sustained fail) -> Drops ready!
    const res = hysteresis.update(false, 3500);
    expect(res.isReady).toBe(false);
    expect(hysteresis.getReadyStatus()).toBe(false);
  });

  it('reset() immediately clears state and timers', () => {
    hysteresis.update(true, 1000);
    hysteresis.update(true, 2500);
    expect(hysteresis.getReadyStatus()).toBe(true);

    hysteresis.reset();
    expect(hysteresis.getReadyStatus()).toBe(false);
  });
});
