/**
 * Continuous Passive Anti-Spoofing & Liveness Engine (§4.1).
 *
 * Runs locally on MediaPipe landmark and blendshape outputs.
 * Employs rolling statistical analysis, hysteresis, and autocorrelation
 * to detect static photos, looped videos, multi-person intrusions,
 * unnatural lack of micro-motion, and screen replays.
 */

import { DEFAULT_INTEGRITY_CONFIG, IntegrityConfig } from './integrityConfig';
import {
  IntegrityFlagEvent,
  IntegrityFlagType,
  FrameSampleForIntegrity,
  FaceGeometrySignature,
} from './integrityTypes';
import {
  computeGeometryDeviation,
  extractFaceGeometrySignature,
  Landmark3D,
} from './faceGeometry';

export interface IntegrityAccommodationSettings {
  motorImpairment?: boolean;
  speechImpairment?: boolean;
}

interface RollingSample {
  timestamp: number;
  value: number;
}

export class PassiveAntiSpoofDetector {
  private config: IntegrityConfig;

  // Baseline face geometry for identity continuity (§4.3)
  private baselineGeometry: FaceGeometrySignature | null = null;

  // Accessibility Accommodations (§6)
  private accommodations: IntegrityAccommodationSettings = {
    motorImpairment: false,
    speechImpairment: false,
  };

  // Downsampled pixel buffer for static diff and loop analysis
  private prevPixels: Uint8ClampedArray | null = null;
  private pixelTraceHistory: RollingSample[] = [];

  // Motion & jitter tracking
  private poseHistory: Array<{ timestamp: number; yaw: number; pitch: number; roll: number }> = [];
  private nosePositionHistory: Array<{ timestamp: number; x: number; y: number; z: number }> = [];

  // Frame timing history
  private frameTimestamps: number[] = [];

  // Blink tracking
  private lastBlinkTimestamp: number = 0;
  private isBlinkActive: boolean = false;

  // Hysteresis State: tracks when a potential flag condition started
  private conditionStartTimestamps: Partial<Record<IntegrityFlagType, number>> = {};
  private activeFlags: Set<IntegrityFlagType> = new Set();

  constructor(config: Partial<IntegrityConfig> = {}) {
    this.config = { ...DEFAULT_INTEGRITY_CONFIG, ...config };
    this.lastBlinkTimestamp = Date.now();
  }

  /**
   * Sets accessibility accommodations to suppress false positive flags (§6).
   */
  public setAccommodations(settings: Partial<IntegrityAccommodationSettings>): void {
    this.accommodations = { ...this.accommodations, ...settings };
  }

  public getAccommodations(): IntegrityAccommodationSettings {
    return { ...this.accommodations };
  }

  /**
   * Checks whether a flag is suppressed by active candidate accommodations (§6).
   */
  public isFlagSuppressed(flag: string): boolean {
    if (this.accommodations.motorImpairment) {
      if (
        flag === 'fidgeting' ||
        flag === 'micro_movement_anomaly' ||
        flag === 'posture_variance' ||
        flag === 'posture_score'
      ) {
        return true;
      }
    }
    if (this.accommodations.speechImpairment) {
      if (
        flag === 'lip_audio_mismatch' ||
        flag === 'mouth_open_frozen' ||
        flag === 'speech_atypical'
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Sets the calibrated face geometry baseline for identity continuity (§4.3).
   */
  public setBaselineGeometry(signature: FaceGeometrySignature): void {
    this.baselineGeometry = signature;
  }

  public getBaselineGeometry(): FaceGeometrySignature | null {
    return this.baselineGeometry;
  }

  /**
   * Evaluates an incoming frame sample and returns any active integrity flags.
   */
  public processFrame(sample: FrameSampleForIntegrity): IntegrityFlagEvent[] {
    const now = sample.timestamp || Date.now();
    const emittedEvents: IntegrityFlagEvent[] = [];

    // Helper: update hysteresis condition
    const updateCondition = (
      flag: IntegrityFlagType,
      isConditionMet: boolean,
      durationThresholdMs: number,
      confidence: number,
      details?: Record<string, unknown>
    ) => {
      if (isConditionMet) {
        if (!this.conditionStartTimestamps[flag]) {
          this.conditionStartTimestamps[flag] = now;
        }

        const elapsed = now - (this.conditionStartTimestamps[flag] || now);
        if (elapsed >= durationThresholdMs) {
          if (!this.isFlagSuppressed(flag)) {
            this.activeFlags.add(flag);
            emittedEvents.push({
              flag,
              confidence: Math.min(1.0, confidence),
              t: now,
              details,
            });
          }
        }
      } else {
        delete this.conditionStartTimestamps[flag];
        this.activeFlags.delete(flag);
      }
    };

    // --------------------------------------------------------------------------
    // 1. Face Presence & Multi-Person (§4.1)
    // --------------------------------------------------------------------------
    const faceCount = sample.faceCount;
    updateCondition('face_missing', faceCount === 0, this.config.faceMissingDurationMs, 1.0, {
      faceCount,
    });
    updateCondition('multiple_faces', faceCount > 1, this.config.multipleFacesDurationMs, 0.95, {
      faceCount,
    });

    // --------------------------------------------------------------------------
    // 1b. Camera Covered / Extreme Low Light (§4.1) - runs even if no face is visible
    // --------------------------------------------------------------------------
    const luminance = sample.meanLuminance ?? 120;
    const isCovered = luminance < this.config.darkLuminanceThreshold;
    updateCondition('camera_covered', isCovered, this.config.darkDurationMs, 0.95, {
      luminance,
      threshold: this.config.darkLuminanceThreshold,
    });

    if (faceCount === 0 || !sample.landmarks) {
      // If face is absent, reset motion and blink timers to avoid false alarms
      this.lastBlinkTimestamp = now;
      return emittedEvents;
    }

    const landmarks = sample.landmarks as Landmark3D[];
    const blendshapes = sample.blendshapes;
    const headPose = sample.headPose;

    // --------------------------------------------------------------------------
    // 2. Blink Tracking (§4.1: no_blink > 25 s)
    // --------------------------------------------------------------------------
    const eyeBlinkLeft = blendshapes['eyeBlinkLeft'] || 0;
    const eyeBlinkRight = blendshapes['eyeBlinkRight'] || 0;
    const maxBlink = Math.max(eyeBlinkLeft, eyeBlinkRight);

    if (maxBlink >= this.config.blinkBlendshapeThreshold) {
      if (!this.isBlinkActive) {
        this.isBlinkActive = true;
        this.lastBlinkTimestamp = now;
      }
    } else if (maxBlink <= this.config.blinkOpenBlendshapeThreshold) {
      this.isBlinkActive = false;
    }

    const noBlinkElapsed = now - this.lastBlinkTimestamp;
    updateCondition('no_blink', noBlinkElapsed > this.config.maxNoBlinkDurationMs, 1000, 0.85, {
      noBlinkElapsedMs: noBlinkElapsed,
      thresholdMs: this.config.maxNoBlinkDurationMs,
    });

    // --------------------------------------------------------------------------
    // 3. Static Feed / Frozen Image (§4.1)
    // --------------------------------------------------------------------------
    let pixelDiff = 1.0;
    if (sample.downsampledPixels && this.prevPixels) {
      let diffSum = 0;
      const len = Math.min(sample.downsampledPixels.length, this.prevPixels.length);
      for (let i = 0; i < len; i++) {
        diffSum += Math.abs(sample.downsampledPixels[i] - this.prevPixels[i]);
      }
      pixelDiff = diffSum / (255 * len);
    }
    if (sample.downsampledPixels) {
      this.prevPixels = new Uint8ClampedArray(sample.downsampledPixels);
    }

    // Maintain 3s nose position history for landmark jitter
    const nose = landmarks[1];
    this.nosePositionHistory.push({ timestamp: now, ...nose });
    this.pruneHistory(this.nosePositionHistory, now, 3000);

    const landmarkJitterVariance = this.calculatePositionVariance(this.nosePositionHistory);
    const isStatic =
      pixelDiff < this.config.staticDiffThreshold &&
      landmarkJitterVariance <= this.config.staticLandmarkJitterVariance;

    updateCondition('static_feed', isStatic, this.config.staticDurationMs, 0.95, {
      pixelDiff,
      landmarkJitterVariance,
    });

    // --------------------------------------------------------------------------
    // 4. Looped Video Detection via Autocorrelation (§4.1)
    // --------------------------------------------------------------------------
    // Track 1D signature sample (mean luminance or pixel mean)
    const traceValue = sample.meanLuminance ?? (nose ? nose.y : 0);
    this.pixelTraceHistory.push({ timestamp: now, value: traceValue });
    this.pruneHistory(this.pixelTraceHistory, now, this.config.loopHistoryWindowSec * 1000);

    const isLooping = this.checkAutocorrelationPeriodicity();
    updateCondition('loop_suspected', isLooping, 2000, 0.9, {
      windowSec: this.config.loopHistoryWindowSec,
    });

    // --------------------------------------------------------------------------
    // 5. Micro-Movement Variance (§4.1: across 10 s)
    // --------------------------------------------------------------------------
    this.poseHistory.push({ timestamp: now, ...headPose });
    this.pruneHistory(this.poseHistory, now, this.config.microMotionWindowSec * 1000);

    let isLackOfMotion = false;
    if (this.poseHistory.length >= 15) {
      const poseVariance = this.calculatePoseVariance(this.poseHistory);
      if (
        poseVariance < this.config.microMotionMinPoseVariance &&
        landmarkJitterVariance < this.config.microMotionMinLandmarkVariance
      ) {
        isLackOfMotion = true;
      }
    }
    updateCondition('no_micro_motion', isLackOfMotion, 3000, 0.8, {
      historySamples: this.poseHistory.length,
    });

    // --------------------------------------------------------------------------
    // 7. Framing & Bounding Box Check (§4.1)
    // --------------------------------------------------------------------------
    let minX = 1.0, maxX = 0.0, minY = 1.0, maxY = 0.0;
    for (const pt of landmarks) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
    const faceHeight = maxY - minY;
    const touchesEdge =
      minX < this.config.edgeMarginRatio ||
      maxX > 1.0 - this.config.edgeMarginRatio ||
      minY < this.config.edgeMarginRatio ||
      maxY > 1.0 - this.config.edgeMarginRatio;

    const isBadFraming = faceHeight < this.config.minFaceHeightRatio || touchesEdge;
    updateCondition('bad_framing', isBadFraming, this.config.badFramingDurationMs, 0.75, {
      faceHeight,
      touchesEdge,
    });

    // --------------------------------------------------------------------------
    // 8. Screen Replay / Flat 2D Depth Check (§4.1)
    // --------------------------------------------------------------------------
    let minZ = 100, maxZ = -100;
    for (const pt of landmarks) {
      if (pt.z < minZ) minZ = pt.z;
      if (pt.z > maxZ) maxZ = pt.z;
    }
    const zRange = maxZ - minZ;
    const faceWidth = maxX - minX;
    const zRatio = faceWidth > 0 ? zRange / faceWidth : 1.0;
    const isScreenReplay = zRatio < this.config.min3dDepthZRangeRatio;
    updateCondition('screen_replay_suspected', isScreenReplay, this.config.screenReplayDurationMs, 0.85, {
      zRatio,
      threshold: this.config.min3dDepthZRangeRatio,
    });

    // --------------------------------------------------------------------------
    // 9. Frame Timing Anomaly (§4.1)
    // --------------------------------------------------------------------------
    this.frameTimestamps.push(now);
    if (this.frameTimestamps.length > 30) {
      this.frameTimestamps.shift();
    }
    if (this.frameTimestamps.length >= 20) {
      const intervals: number[] = [];
      for (let i = 1; i < this.frameTimestamps.length; i++) {
        intervals.push(this.frameTimestamps[i] - this.frameTimestamps[i - 1]);
      }
      const intervalVariance = this.calculateVariance(intervals);
      // Perfectly constant interval (zero variance) suggests synthetic loop or generator
      const isTimingAnomaly = intervalVariance < 0.005;
      updateCondition('timing_anomaly', isTimingAnomaly, 3000, 0.8, { intervalVariance });
    }

    // --------------------------------------------------------------------------
    // 10. Identity Continuity (§4.3)
    // --------------------------------------------------------------------------
    if (this.baselineGeometry) {
      const currentSignature = extractFaceGeometrySignature(landmarks);
      if (currentSignature) {
        const deviation = computeGeometryDeviation(this.baselineGeometry, currentSignature);
        const isMismatch = deviation > this.config.identityMismatchThreshold;
        updateCondition('identity_mismatch', isMismatch, this.config.identityMismatchDurationMs, 0.9, {
          deviation,
          threshold: this.config.identityMismatchThreshold,
        });
      }
    }

    return emittedEvents;
  }

  // ----------------------------------------------------------------------------
  // Statistical & Autocorrelation Helper Methods
  // ----------------------------------------------------------------------------

  private checkAutocorrelationPeriodicity(): boolean {
    const N = this.pixelTraceHistory.length;
    if (N < 20) return false;

    const values = this.pixelTraceHistory.map((s) => s.value);
    const mean = values.reduce((a, b) => a + b, 0) / N;

    // Variance
    let varSum = 0;
    for (let i = 0; i < N; i++) {
      varSum += (values[i] - mean) ** 2;
    }
    if (varSum < 0.0001) return false; // Constant value handled by static_feed

    // Test lags corresponding to 2.0s up to N/2
    const minLag = 4;
    const maxLag = Math.floor(N / 2);
    let maxCorrelation = 0;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let crossSum = 0;
      let sumSq1 = 0;
      let sumSq2 = 0;
      for (let i = 0; i < N - lag; i++) {
        const v1 = values[i] - mean;
        const v2 = values[i + lag] - mean;
        crossSum += v1 * v2;
        sumSq1 += v1 * v1;
        sumSq2 += v2 * v2;
      }
      const denom = Math.sqrt(sumSq1 * sumSq2);
      if (denom > 0.0001) {
        const r = crossSum / denom;
        if (r > maxCorrelation) {
          maxCorrelation = r;
        }
      }
    }

    return maxCorrelation >= this.config.loopAutocorrelationMinPeak;
  }

  private calculatePositionVariance(points: Array<{ x: number; y: number; z: number }>): number {
    if (points.length < 2) return 0;
    const meanX = points.reduce((acc, p) => acc + p.x, 0) / points.length;
    const meanY = points.reduce((acc, p) => acc + p.y, 0) / points.length;
    let sumSq = 0;
    for (const p of points) {
      sumSq += (p.x - meanX) ** 2 + (p.y - meanY) ** 2;
    }
    return sumSq / points.length;
  }

  private calculatePoseVariance(poses: Array<{ yaw: number; pitch: number; roll: number }>): number {
    if (poses.length < 2) return 0;
    const meanYaw = poses.reduce((acc, p) => acc + p.yaw, 0) / poses.length;
    const meanPitch = poses.reduce((acc, p) => acc + p.pitch, 0) / poses.length;
    const meanRoll = poses.reduce((acc, p) => acc + p.roll, 0) / poses.length;
    let sumSq = 0;
    for (const p of poses) {
      sumSq += (p.yaw - meanYaw) ** 2 + (p.pitch - meanPitch) ** 2 + (p.roll - meanRoll) ** 2;
    }
    return sumSq / poses.length;
  }

  private calculateVariance(numbers: number[]): number {
    if (numbers.length < 2) return 0;
    const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
    let sumSq = 0;
    for (const n of numbers) {
      sumSq += (n - mean) ** 2;
    }
    return sumSq / numbers.length;
  }

  private pruneHistory<T extends { timestamp: number }>(
    list: T[],
    currentTimestamp: number,
    windowMs: number
  ): void {
    const cutoff = currentTimestamp - windowMs;
    while (list.length > 0 && list[0].timestamp < cutoff) {
      list.shift();
    }
  }

  public reset(): void {
    this.prevPixels = null;
    this.pixelTraceHistory = [];
    this.poseHistory = [];
    this.nosePositionHistory = [];
    this.frameTimestamps = [];
    this.lastBlinkTimestamp = Date.now();
    this.isBlinkActive = false;
    this.conditionStartTimestamps = {};
    this.activeFlags.clear();
  }
}
