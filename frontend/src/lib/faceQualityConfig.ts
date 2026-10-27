/**
 * faceQualityConfig.ts
 *
 * Configurable thresholds and tuning constants for live face quality checking (§2.1).
 */

export const FACE_QUALITY_CONFIG = {
  // 1. Face Count
  EXACT_FACE_COUNT: 1,

  // 2. Centering (normalized coordinates 0..1)
  GUIDE_OVAL_CENTER: { x: 0.5, y: 0.5 },
  CENTERING_TOLERANCE_X: 0.12, // ±12% from guide oval center
  CENTERING_TOLERANCE_Y: 0.12, // ±12% from guide oval center

  // 3. Distance / Face Size (relative to frame height)
  DISTANCE_MIN_HEIGHT: 0.30, // Face height must be 30% to 60% of frame height
  DISTANCE_MAX_HEIGHT: 0.60,

  // 4. Fully in Frame (normalized boundary margins)
  EDGE_MARGIN_MIN: 0.03, // No landmark within 3% of any frame edge

  // 5. Facing Camera (degrees)
  POSE_MAX_YAW: 12.0,   // |yaw| <= 12°
  POSE_MAX_PITCH: 12.0, // |pitch| <= 12°
  POSE_MAX_ROLL: 10.0,  // |roll| <= 10°

  // 6. Eyes Open (MediaPipe eyeBlink blendshape values 0..1)
  EYE_BLINK_MAX: 0.40, // < 0.4 for both eyes

  // 7. Neutral Mouth (jawOpen blendshape value 0..1)
  JAW_OPEN_MAX: 0.25,

  // 8. Lighting (Luminance 0..255)
  LUMINANCE_MIN: 60.0,
  LUMINANCE_MAX: 200.0,
  LUMINANCE_UNEVENNESS_MAX: 0.35, // Left vs right difference < 35%

  // 9. Sharpness (Laplacian variance on face crop)
  SHARPNESS_LAPLACIAN_MIN: 80.0,

  // 10. Color Sanity (Warning only, non-blocking)
  // Strong single-channel dominance or excessive tint ratio
  COLOR_GREEN_DOMINANCE_RATIO: 1.4,
  COLOR_SINGLE_CHANNEL_MAX_FRACTION: 0.65,

  // 11. Stability (Movement across consecutive frames)
  STABILITY_MAX_MOVEMENT: 0.02, // < 2% bbox movement
  STABILITY_HISTORY_FRAMES: 10,

  // 12. Hysteresis Timings
  HYSTERESIS_PASS_DURATION_MS: 1500, // 1.5s continuous pass required to enable capture
  HYSTERESIS_FAIL_DURATION_MS: 500,  // 0.5s fail required before disabling capture
} as const;

export type FaceQualityConfig = typeof FACE_QUALITY_CONFIG;
