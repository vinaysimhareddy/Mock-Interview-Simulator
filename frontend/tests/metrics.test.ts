import { describe, expect, it } from 'vitest';
import {
  computeHeadPose,
  computePostureScore,
  detectDistractionFlags,
  isLookingAtCamera,
  LandmarkPoint,
  MetricAggregator,
} from '../src/lib/metrics';
import { CalibrationBaseline, FrameMetricSnapshot } from '../src/lib/types';

describe('Computer Vision Metrics Unit Tests (§4.3)', () => {
  describe('isLookingAtCamera', () => {
    it('returns true when gaze blendshapes and head yaw/pitch are within bounds', () => {
      const blendshapes = {
        eyeLookOutLeft: 0.12,
        eyeLookOutRight: 0.15,
        eyeLookInLeft: 0.08,
        eyeLookInRight: 0.05,
        eyeLookUpLeft: 0.02,
        eyeLookUpRight: 0.03,
        eyeLookDownLeft: 0.10,
        eyeLookDownRight: 0.09,
      };
      const headPose = { yaw: -4.2, pitch: 3.1, roll: 0.8 };
      expect(isLookingAtCamera(blendshapes, headPose)).toBe(true);
    });

    it('returns false when max gaze blendshape exceeds 0.35', () => {
      const blendshapes = {
        eyeLookOutLeft: 0.48, // Looking away to left
        eyeLookInRight: 0.42,
      };
      const headPose = { yaw: 2.0, pitch: 1.0, roll: 0.0 };
      expect(isLookingAtCamera(blendshapes, headPose)).toBe(false);
    });

    it('returns false when head yaw exceeds 15 degrees', () => {
      const blendshapes = { eyeLookOutLeft: 0.05 };
      const headPose = { yaw: 18.5, pitch: 2.0, roll: 0.0 };
      expect(isLookingAtCamera(blendshapes, headPose)).toBe(false);
    });

    it('returns false when head pitch exceeds 15 degrees', () => {
      const blendshapes = { eyeLookOutLeft: 0.05 };
      const headPose = { yaw: -3.0, pitch: -16.2, roll: 0.0 };
      expect(isLookingAtCamera(blendshapes, headPose)).toBe(false);
    });

    it('returns true for natural downward screen viewing angle (downGaze = 0.42)', () => {
      const blendshapes = {
        eyeLookOutLeft: 0.08,
        eyeLookOutRight: 0.07,
        eyeLookInLeft: 0.05,
        eyeLookInRight: 0.06,
        eyeLookDownLeft: 0.42, // Looking down at interview stage on screen
        eyeLookDownRight: 0.41,
      };
      const headPose = { yaw: -2.0, pitch: 4.0, roll: 0.0 };
      expect(isLookingAtCamera(blendshapes, headPose)).toBe(true);
    });

    it('cancels out neutral tilt using baseline calibration', () => {
      const blendshapes = { eyeLookOutLeft: 0.05 };
      // Pitch is 18.0 uncalibrated, but baseline is 16.0 -> effective pitch is 2.0
      const headPose = { yaw: 2.0, pitch: 18.0, roll: 0.0 };
      const baseline: CalibrationBaseline = {
        neutralShoulderWidth: 0.3,
        neutralShoulderSlope: 0,
        neutralNoseY: 0.25,
        neutralYaw: 0,
        neutralPitch: 16.0,
      };
      expect(isLookingAtCamera(blendshapes, headPose, baseline)).toBe(true);
    });
  });

  describe('computeHeadPose', () => {
    it('computes near-zero angles for a centered neutral face mesh', () => {
      const neutralMesh: LandmarkPoint[] = Array(468).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0 }));
      // 1: Nose tip, 152: Chin, 10: Forehead, 33: Left eye outer, 263: Right eye outer
      neutralMesh[1] = { x: 0.5, y: 0.5, z: 0 };
      neutralMesh[10] = { x: 0.5, y: 0.3, z: 0 };
      neutralMesh[152] = { x: 0.5, y: 0.7, z: 0 };
      neutralMesh[33] = { x: 0.4, y: 0.45, z: 0 };
      neutralMesh[263] = { x: 0.6, y: 0.45, z: 0 };

      const pose = computeHeadPose(neutralMesh);
      expect(Math.abs(pose.yaw)).toBeLessThan(5);
      expect(Math.abs(pose.pitch)).toBeLessThan(5);
      expect(Math.abs(pose.roll)).toBeLessThan(5);
    });

    it('detects head roll when eye line is tilted', () => {
      const tiltedMesh: LandmarkPoint[] = Array(468).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0 }));
      tiltedMesh[1] = { x: 0.5, y: 0.5, z: 0 };
      tiltedMesh[10] = { x: 0.5, y: 0.3, z: 0 };
      tiltedMesh[152] = { x: 0.5, y: 0.7, z: 0 };
      tiltedMesh[33] = { x: 0.4, y: 0.4, z: 0 };
      tiltedMesh[263] = { x: 0.6, y: 0.5, z: 0 }; // Right eye lower

      const pose = computeHeadPose(tiltedMesh);
      expect(pose.roll).toBeGreaterThan(15);
    });
  });

  describe('computePostureScore', () => {
    it('outputs high posture score for level shoulders and upright nose', () => {
      const uprightPose: LandmarkPoint[] = Array(33).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0 }));
      uprightPose[0] = { x: 0.5, y: 0.25, z: 0 }; // Nose
      uprightPose[11] = { x: 0.35, y: 0.5, z: 0 }; // Left shoulder
      uprightPose[12] = { x: 0.65, y: 0.5, z: 0 }; // Right shoulder (level)

      const baseline: CalibrationBaseline = {
        neutralShoulderWidth: 0.3,
        neutralShoulderSlope: 0,
        neutralNoseY: 0.25,
        neutralYaw: 0,
        neutralPitch: 0,
      };

      const score = computePostureScore(uprightPose, baseline, null);
      expect(score).toBeGreaterThanOrEqual(0.9);
    });

    it('penalizes severe shoulder tilt exceeding 8 degrees', () => {
      const tiltedPose: LandmarkPoint[] = Array(33).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0 }));
      tiltedPose[0] = { x: 0.5, y: 0.25, z: 0 };
      tiltedPose[11] = { x: 0.35, y: 0.45, z: 0 };
      tiltedPose[12] = { x: 0.65, y: 0.6, z: 0 }; // Significant tilt > 15 deg

      const score = computePostureScore(tiltedPose, null, null);
      expect(score).toBeLessThan(0.8);
    });

    it('smooths posture score with EMA (alpha = 0.3)', () => {
      const prevSmoothed = 0.8;
      const uprightPose: LandmarkPoint[] = Array(33).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0 }));
      uprightPose[0] = { x: 0.5, y: 0.25, z: 0 };
      uprightPose[11] = { x: 0.35, y: 0.5, z: 0 };
      uprightPose[12] = { x: 0.65, y: 0.5, z: 0 };

      const smoothed = computePostureScore(uprightPose, null, prevSmoothed);
      // EMA formula: 0.3 * raw + 0.7 * prev
      expect(smoothed).toBeGreaterThan(0.75);
      expect(smoothed).toBeLessThanOrEqual(1.0);
    });
  });

  describe('detectDistractionFlags', () => {
    it('detects face_missing flag when no face is present for >= 2.0s', () => {
      const now = 5000;
      const history: FrameMetricSnapshot[] = [];
      // 10 frames over past 2 seconds all with face_present: false
      for (let i = 0; i < 10; i++) {
        history.push({
          timestamp: now - 1800 + i * 150,
          face_present: false,
          looking_at_camera: false,
          raw_posture_score: 0.8,
          head_pose: { yaw: 0, pitch: 0, roll: 0 },
          expression: { smile: 0, brow_furrow: 0, mouth_open: 0 },
          pose_keypoint_variance: 0.001,
        });
      }

      const flags = detectDistractionFlags(history, now);
      expect(flags).toContain('face_missing');
    });

    it('detects looked_away flag when looking_at_camera ratio < 0.4 for >= 3.0s', () => {
      const now = 5000;
      const history: FrameMetricSnapshot[] = [];
      // 12 frames over past 3s where candidate looked away on 10 of them
      for (let i = 0; i < 12; i++) {
        history.push({
          timestamp: now - 2800 + i * 200,
          face_present: true,
          looking_at_camera: i < 2, // only 2 of 12 are looking (< 0.4)
          raw_posture_score: 0.8,
          head_pose: { yaw: 22, pitch: 0, roll: 0 },
          expression: { smile: 0, brow_furrow: 0, mouth_open: 0 },
          pose_keypoint_variance: 0.001,
        });
      }

      const flags = detectDistractionFlags(history, now);
      expect(flags).toContain('looked_away');
    });

    it('detects slouching flag when average posture < 0.5 for >= 5.0s', () => {
      const now = 7000;
      const history: FrameMetricSnapshot[] = [];
      for (let i = 0; i < 15; i++) {
        history.push({
          timestamp: now - 4800 + i * 300,
          face_present: true,
          looking_at_camera: true,
          raw_posture_score: 0.35, // Slouching posture
          head_pose: { yaw: 0, pitch: 0, roll: 0 },
          expression: { smile: 0, brow_furrow: 0, mouth_open: 0 },
          pose_keypoint_variance: 0.001,
        });
      }

      const flags = detectDistractionFlags(history, now);
      expect(flags).toContain('slouching');
    });
  });

  describe('MetricAggregator', () => {
    it('buffers frames and produces valid 1 Hz telemetry sample (§4.1)', () => {
      const aggregator = new MetricAggregator();
      const now = performance.now();

      // Simulate 30 frames over 1 second
      for (let i = 0; i < 30; i++) {
        aggregator.addFrame({
          timestamp: now - 950 + i * 32,
          face_present: true,
          looking_at_camera: i % 4 !== 0, // ~75% looking
          raw_posture_score: 0.82,
          head_pose: { yaw: -2.5, pitch: 1.8, roll: 0.5 },
          expression: { smile: 0.3, brow_furrow: 0.1, mouth_open: 0.05 },
          pose_keypoint_variance: 0.002,
        });
      }

      const packet = aggregator.emitPacket(12, 30);
      expect(packet.type).toBe('telemetry');
      expect(packet.t).toBe(12);
      expect(packet.eye_contact_ratio).toBeGreaterThan(0.6);
      expect(packet.eye_contact_ratio).toBeLessThanOrEqual(1.0);
      expect(packet.posture_score).toBeGreaterThan(0.6);
      expect(packet.face_present).toBe(true);
      expect(packet.expression?.smile).toBeCloseTo(0.3, 1);
    });

    it('emits eye_contact_ratio as null when no face is present (never 0% or stale)', () => {
      const aggregator = new MetricAggregator();
      const now = performance.now();

      // Simulate 15 frames with no face detected
      for (let i = 0; i < 15; i++) {
        aggregator.addFrame({
          timestamp: now - 900 + i * 60,
          face_present: false,
          looking_at_camera: false,
          raw_posture_score: 0.5,
          head_pose: { yaw: 0, pitch: 0, roll: 0 },
          expression: { smile: 0, brow_furrow: 0, mouth_open: 0 },
          pose_keypoint_variance: 0.001,
        });
      }

      const packet = aggregator.emitPacket(15, 30);
      expect(packet.face_present).toBe(false);
      expect(packet.eye_contact_ratio).toBeNull();
      expect(packet.posture_score).toBeNull();
      expect(packet.head_pose).toBeNull();
      expect(packet.expression).toBeNull();
    });

    it('emits plausible non-zero eye_contact_ratio when face is present even if glanced away (never 0%)', () => {
      const aggregator = new MetricAggregator();
      const now = performance.now();

      // Simulate 15 frames where face is present but candidate glanced away
      for (let i = 0; i < 15; i++) {
        aggregator.addFrame({
          timestamp: now - 900 + i * 60,
          face_present: true,
          looking_at_camera: false,
          raw_posture_score: 0.8,
          head_pose: { yaw: 20, pitch: 5, roll: 0 },
          expression: { smile: 0, brow_furrow: 0, mouth_open: 0 },
          pose_keypoint_variance: 0.001,
        });
      }

      const packet = aggregator.emitPacket(16, 30);
      expect(packet.face_present).toBe(true);
      expect(packet.eye_contact_ratio).not.toBeNull();
      expect(packet.eye_contact_ratio).toBeGreaterThan(0.0);
      expect(packet.eye_contact_ratio).toBe(0.10); // Floor ensures no 0% contradiction
    });
  });
});
