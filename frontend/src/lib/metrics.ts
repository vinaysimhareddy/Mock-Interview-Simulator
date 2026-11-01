import {
  CalibrationBaseline,
  DistractionFlag,
  ExpressionMetrics,
  FrameMetricSnapshot,
  HeadPose,
  TelemetrySample,
} from './types';

export interface LandmarkPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * Compute approximate head pose angles (yaw, pitch, roll in degrees) from 3D face landmarks.
 */
export function computeHeadPose(landmarks: LandmarkPoint[]): HeadPose {
  if (!landmarks || landmarks.length < 468) {
    return { yaw: 0, pitch: 0, roll: 0 };
  }

  // Key landmarks in MediaPipe Face Mesh:
  // 1: Nose tip, 152: Chin, 10: Forehead/top, 33: Left eye outer, 263: Right eye outer
  const nose = landmarks[1];
  const chin = landmarks[152];
  const forehead = landmarks[10];
  const leftEyeOuter = landmarks[33];
  const rightEyeOuter = landmarks[263];

  // 1. Roll: rotation around z-axis (tilt of eye line)
  const eyeDx = rightEyeOuter.x - leftEyeOuter.x;
  const eyeDy = rightEyeOuter.y - leftEyeOuter.y;
  const roll = Math.atan2(eyeDy, eyeDx) * (180 / Math.PI);

  // 2. Yaw: left-right rotation around y-axis
  // Horizontal symmetry: compare nose-to-leftEye distance with nose-to-rightEye distance
  const dLeft = Math.abs(nose.x - leftEyeOuter.x);
  const dRight = Math.abs(rightEyeOuter.x - nose.x);
  const yawRatio = (dLeft - dRight) / (dLeft + dRight + 1e-6);
  // Max yaw range ~45 degrees
  const yaw = Math.max(-45, Math.min(45, yawRatio * 60));

  // 3. Pitch: up-down rotation around x-axis
  // Vertical symmetry: distance from forehead to nose vs nose to chin
  const dUpper = Math.abs(nose.y - forehead.y);
  const dLower = Math.abs(chin.y - nose.y);
  const pitchRatio = (dUpper - dLower) / (dUpper + dLower + 1e-6);
  const pitch = Math.max(-45, Math.min(45, pitchRatio * 55));

  return {
    yaw: parseFloat(yaw.toFixed(1)),
    pitch: parseFloat(pitch.toFixed(1)),
    roll: parseFloat(roll.toFixed(1)),
  };
}

/**
 * Determine if a single frame is classified as "on camera" per §4.3:
 * Supports natural downward screen viewing angle, applies baseline offsets when present.
 */
export function isLookingAtCamera(
  blendshapes: Record<string, number>,
  headPose: HeadPose,
  baseline: CalibrationBaseline | null = null
): boolean {
  const yaw = baseline ? headPose.yaw - baseline.neutralYaw : headPose.yaw;
  const pitch = baseline ? headPose.pitch - baseline.neutralPitch : headPose.pitch;

  // Lateral & upward gaze (looking away to sides or ceiling)
  let maxLateralGaze = 0;
  const lateralBlendshapes = [
    'eyeLookOutLeft',
    'eyeLookOutRight',
    'eyeLookInLeft',
    'eyeLookInRight',
    'eyeLookUpLeft',
    'eyeLookUpRight',
  ];
  for (const name of lateralBlendshapes) {
    const val = blendshapes[name] || 0;
    if (val > maxLateralGaze) {
      maxLateralGaze = val;
    }
  }

  // Downward gaze: looking down at laptop screen is natural, allow up to 0.50
  const downGaze = Math.max(
    blendshapes['eyeLookDownLeft'] || 0,
    blendshapes['eyeLookDownRight'] || 0
  );

  const gazeOk = maxLateralGaze < 0.35 && downGaze < 0.50;
  const yawOk = Math.abs(yaw) < 15.0;
  const pitchOk = Math.abs(pitch) < 15.0;

  return gazeOk && yawOk && pitchOk;
}

/**
 * Compute posture score (0..1) from PoseLandmarker shoulders (11, 12) and nose (0).
 * Combines shoulder tilt penalty (> 8°), head-forward offset, and shoulder width stability.
 * Smoothed with Exponential Moving Average (EMA, α = 0.3).
 */
export function computePostureScore(
  poseLandmarks: LandmarkPoint[] | null,
  baseline: CalibrationBaseline | null = null,
  previousSmoothedScore: number | null = null
): number {
  if (!poseLandmarks || poseLandmarks.length < 13) {
    return previousSmoothedScore !== null ? previousSmoothedScore : 0.7;
  }

  const leftShoulder = poseLandmarks[11];
  const rightShoulder = poseLandmarks[12];
  const nose = poseLandmarks[0];

  // 1. Shoulder Tilt: penalize tilt > 8 degrees
  const dx = rightShoulder.x - leftShoulder.x;
  const dy = rightShoulder.y - leftShoulder.y;
  const shoulderTiltDeg = Math.abs(Math.atan2(dy, dx) * (180 / Math.PI));

  let tiltScore = 1.0;
  if (shoulderTiltDeg > 8.0) {
    tiltScore = Math.max(0.1, 1.0 - (shoulderTiltDeg - 8.0) / 25.0);
  }

  // 2. Shoulder Width & Head Height against baseline
  let stabilityScore = 1.0;
  const currentWidth = Math.sqrt(dx * dx + dy * dy);

  if (baseline && baseline.neutralShoulderWidth > 0.01) {
    const widthRatio = currentWidth / baseline.neutralShoulderWidth;
    // Deviation from calibrated width penalizes slouching forward or leaning back
    const widthDev = Math.abs(1.0 - widthRatio);
    const widthPenalty = Math.max(0.0, 1.0 - widthDev * 2.0);

    // Nose drop check (slouching downwards)
    const noseDrop = nose.y - baseline.neutralNoseY;
    const dropPenalty = noseDrop > 0.05 ? Math.max(0.2, 1.0 - (noseDrop - 0.05) * 5.0) : 1.0;

    stabilityScore = 0.5 * widthPenalty + 0.5 * dropPenalty;
  }

  const rawScore = Math.max(0.0, Math.min(1.0, 0.5 * tiltScore + 0.5 * stabilityScore));

  // Smooth with EMA (alpha = 0.3 per §4.3)
  const alpha = 0.3;
  if (previousSmoothedScore !== null) {
    return parseFloat((alpha * rawScore + (1 - alpha) * previousSmoothedScore).toFixed(2));
  }
  return parseFloat(rawScore.toFixed(2));
}

/**
 * Detect active distraction flags per §4.3:
 * - looked_away: eye contact < 0.4 for 3 s
 * - face_missing: no face for 2 s
 * - slouching: posture < 0.5 for 5 s
 * - fidgeting: high pose-keypoint variance
 */
export function detectDistractionFlags(
  history: FrameMetricSnapshot[],
  nowMs: number
): DistractionFlag[] {
  const flags: DistractionFlag[] = [];
  if (history.length === 0) return flags;

  // 1. face_missing check: no face for past 2.0 seconds
  const window2s = history.filter((f) => nowMs - f.timestamp <= 2000);
  if (window2s.length >= 5 && window2s.every((f) => !f.face_present)) {
    flags.push('face_missing');
  }

  // 2. looked_away check: eye contact < 0.4 for past 3.0 seconds (if face present)
  const window3s = history.filter((f) => nowMs - f.timestamp <= 3000);
  const faceFrames3s = window3s.filter((f) => f.face_present);
  if (faceFrames3s.length >= 8) {
    const lookingCount = faceFrames3s.filter((f) => f.looking_at_camera).length;
    const ratio3s = lookingCount / faceFrames3s.length;
    if (ratio3s < 0.4) {
      flags.push('looked_away');
    }
  }

  // 3. slouching check: posture < 0.5 for past 5.0 seconds
  const window5s = history.filter((f) => nowMs - f.timestamp <= 5000);
  if (window5s.length >= 10) {
    const avgPosture =
      window5s.reduce((acc, f) => acc + f.raw_posture_score, 0) / window5s.length;
    if (avgPosture < 0.5) {
      flags.push('slouching');
    }
  }

  // 4. fidgeting check: high pose-keypoint variance across recent 2.5s window
  const windowFidget = history.filter((f) => nowMs - f.timestamp <= 2500);
  if (windowFidget.length >= 8) {
    const variances = windowFidget.map((f) => f.pose_keypoint_variance);
    const avgVariance = variances.reduce((a, b) => a + b, 0) / variances.length;
    if (avgVariance > 0.008) {
      flags.push('fidgeting');
    }
  }

  return flags;
}

/**
 * MetricAggregator buffers per-frame video inference results (~30 FPS)
 * and emits one aggregated 1 Hz telemetry packet (§4.1).
 */
export class MetricAggregator {
  private frameBuffer: FrameMetricSnapshot[] = [];
  private lastEmitTime: number = 0;
  private smoothedPosture: number = 0.8;
  private baseline: CalibrationBaseline | null = null;

  public setBaseline(baseline: CalibrationBaseline | null): void {
    this.baseline = baseline;
  }

  public getBaseline(): CalibrationBaseline | null {
    return this.baseline;
  }

  public addFrame(snapshot: FrameMetricSnapshot): void {
    this.frameBuffer.push(snapshot);
    // Keep max 7 seconds of buffer for distraction calculations
    const cutoff = snapshot.timestamp - 7000;
    while (this.frameBuffer.length > 0 && this.frameBuffer[0].timestamp < cutoff) {
      this.frameBuffer.shift();
    }
  }

  public shouldEmit(currentTimeSeconds: number): boolean {
    return currentTimeSeconds - this.lastEmitTime >= 1.0;
  }

  /**
   * Produce 1 Hz telemetry sample according to contract §4.1.
   */
  public emitPacket(elapsedSeconds: number, measuredFps: number): TelemetrySample {
    this.lastEmitTime = elapsedSeconds;
    const now = performance.now();

    // 1-second window for ratio computation
    const oneSecCutoff = now - 1000;
    const recentFrames = this.frameBuffer.filter((f) => f.timestamp >= oneSecCutoff);

    const faceFrames = recentFrames.filter((f) => f.face_present);
    const hasFace = faceFrames.length > 0;

    let eyeContactRatio: number | null = null;
    let postureScore: number | null = null;
    let headPose: HeadPose | null = null;
    let expression: ExpressionMetrics | null = null;

    if (hasFace) {
      const lookingFrames = faceFrames.filter((f) => f.looking_at_camera);
      const rawRatio = faceFrames.length > 0 ? lookingFrames.length / faceFrames.length : 0;
      // With a detected face, eye contact is plausible and never 0% (minimum plausible floor of 0.10 when face is detected)
      eyeContactRatio = parseFloat(Math.max(0.10, rawRatio).toFixed(2));

      // Posture score from latest valid face frame
      const latestValid = recentFrames.slice().reverse().find((f) => f.face_present);
      if (latestValid) {
        this.smoothedPosture = parseFloat(
          (0.3 * latestValid.raw_posture_score + 0.7 * this.smoothedPosture).toFixed(2)
        );
        postureScore = this.smoothedPosture;
        headPose = latestValid.head_pose;
      }

      // Average expressions across frames with detected face
      const smile = faceFrames.reduce((acc, f) => acc + f.expression.smile, 0) / faceFrames.length;
      const browFurrow = faceFrames.reduce((acc, f) => acc + f.expression.brow_furrow, 0) / faceFrames.length;
      const mouthOpen = faceFrames.reduce((acc, f) => acc + f.expression.mouth_open, 0) / faceFrames.length;

      expression = {
        smile: parseFloat(smile.toFixed(2)),
        brow_furrow: parseFloat(browFurrow.toFixed(2)),
        mouth_open: parseFloat(mouthOpen.toFixed(2)),
      };
    }

    const flags = detectDistractionFlags(this.frameBuffer, now);

    return {
      type: 'telemetry',
      t: elapsedSeconds,
      eye_contact_ratio: eyeContactRatio,
      posture_score: postureScore,
      head_pose: headPose,
      expression,
      distraction_flags: flags,
      face_present: hasFace,
      fps: measuredFps > 0 ? measuredFps : 30,
    };
  }

  public reset(): void {
    this.frameBuffer = [];
    this.lastEmitTime = 0;
    this.smoothedPosture = 0.8;
  }
}
