/**
 * Real Camera Integrity & Anti-Spoof Detection Configuration (§4.1).
 *
 * All passive and active checks run client-side in the candidate's browser.
 * Raw video frames are never stored or transmitted to the backend.
 *
 * Tuning Guide:
 * - Increase hysteresis durations to reduce false positives in poor lighting.
 * - Decrease diff thresholds if users have high-grain low-light webcams.
 */

export interface IntegrityConfig {
  // Passive Check Thresholds (§4.1)
  faceMissingDurationMs: number;       // Trigger face_missing if no face for >= this duration (default: 2000 ms)
  multipleFacesDurationMs: number;     // Trigger multiple_faces if > 1 face for >= this duration (default: 2000 ms)
  
  // Static Feed Detection (frozen photo / paused video)
  staticDiffThreshold: number;         // Mean absolute pixel diff % below which frame is static (default: 0.004 = 0.4%)
  staticLandmarkJitterVariance: number;// Max landmark jitter variance to consider static (default: 0.000005)
  staticDurationMs: number;            // Duration static conditions must persist (default: 3000 ms)
  
  // Looped Video Detection
  loopHistoryWindowSec: number;        // Rolling history window length in seconds (default: 15 s)
  loopSampleRateHz: number;            // Sampling rate for loop analysis (default: 2 Hz)
  loopAutocorrelationMinPeak: number;  // Autocorrelation peak threshold to flag repeating loop (default: 0.88)
  loopMinPeriodSec: number;            // Minimum loop period to consider (default: 2.0 s)
  
  // Micro-motion & Natural Liveness
  microMotionWindowSec: number;        // Rolling window for micro-movement check (default: 10 s)
  microMotionMinPoseVariance: number;  // Minimum yaw/pitch/roll variance for live human (default: 0.00015)
  microMotionMinLandmarkVariance: number; // Minimum landmark jitter variance (default: 0.00002)
  
  // Blinking
  maxNoBlinkDurationMs: number;        // Max time without a blink before flagging no_blink (default: 25000 ms)
  blinkBlendshapeThreshold: number;    // eyeBlink score to register a blink (default: 0.50)
  blinkOpenBlendshapeThreshold: number;// eyeBlink score to register eye open (default: 0.20)
  
  // Environmental / Lighting
  darkLuminanceThreshold: number;      // Mean luminance (0-255) below which camera is covered/dark (default: 15)
  darkDurationMs: number;              // Duration darkness must persist (default: 2000 ms)
  
  // Framing & Boundary
  minFaceHeightRatio: number;          // Minimum bbox height relative to frame height (default: 0.12 = 12%)
  edgeMarginRatio: number;             // Margin to frame boundary before flagging bad_framing (default: 0.02 = 2%)
  badFramingDurationMs: number;        // Duration before emitting bad_framing (default: 2000 ms)
  
  // Screen Replay & 2D Photo Heuristic
  min3dDepthZRangeRatio: number;       // Ratio of Z-depth span to face width; flat screen/photo < 0.12 (default: 0.12)
  screenReplayDurationMs: number;      // Duration flat depth cue must persist (default: 4000 ms)
  
  // Identity Continuity (§4.3)
  identityMismatchThreshold: number;   // Normalized Euclidean distance ratio difference from baseline (default: 0.22)
  identityMismatchDurationMs: number;  // Duration mismatch must persist before flagging (default: 5000 ms)
  
  // Active Challenge (§4.2)
  startChallengeStepTimeoutMs: number; // Timeout per step in initial 3-step verification (default: 6000 ms)
  midInterviewChallengeTimeoutMs: number; // Timeout for mid-interview verification (default: 8000 ms)
  maxChallengeRetries: number;         // Retries allowed before failing (default: 2)
}

export const DEFAULT_INTEGRITY_CONFIG: IntegrityConfig = {
  faceMissingDurationMs: 2000,
  multipleFacesDurationMs: 2000,

  staticDiffThreshold: 0.004, // 0.4% mean absolute pixel difference
  staticLandmarkJitterVariance: 0.000005,
  staticDurationMs: 3000,

  loopHistoryWindowSec: 15,
  loopSampleRateHz: 2,
  loopAutocorrelationMinPeak: 0.88,
  loopMinPeriodSec: 2.0,

  microMotionWindowSec: 10,
  microMotionMinPoseVariance: 0.00015,
  microMotionMinLandmarkVariance: 0.00002,

  maxNoBlinkDurationMs: 25000, // 25 seconds
  blinkBlendshapeThreshold: 0.50,
  blinkOpenBlendshapeThreshold: 0.20,

  darkLuminanceThreshold: 15,
  darkDurationMs: 2000,

  minFaceHeightRatio: 0.12, // 12% of frame height
  edgeMarginRatio: 0.02,    // 2% from edge
  badFramingDurationMs: 2000,

  min3dDepthZRangeRatio: 0.12,
  screenReplayDurationMs: 4000,

  identityMismatchThreshold: 0.22,
  identityMismatchDurationMs: 5000,

  startChallengeStepTimeoutMs: 6000,
  midInterviewChallengeTimeoutMs: 8000,
  maxChallengeRetries: 2,
};
