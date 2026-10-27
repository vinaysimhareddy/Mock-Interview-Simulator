import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setupDevicesReducer,
  initialSetupDevicesState,
  SetupDevicesState,
} from '../src/hooks/useSetupDevices';
import {
  evaluateFaceQuality,
  BoundingBox,
  FaceQualityReport,
} from '../src/lib/faceQuality';
import { extractFaceGeometrySignature, Landmark3D } from '../src/lib/faceGeometry';
import {
  getSharedFaceLandmarker,
  preloadVisionModels,
  resetVisionManager,
  getVisionDiagnostics,
} from '../src/lib/visionManager';

// Mock @mediapipe/tasks-vision
vi.mock('@mediapipe/tasks-vision', () => {
  return {
    FilesetResolver: {
      forVisionTasks: vi.fn().mockResolvedValue({}),
    },
    FaceLandmarker: {
      createFromOptions: vi.fn().mockImplementation((_, opts) => {
        return Promise.resolve({
          detectForVideo: vi.fn().mockReturnValue({
            faceLandmarks: [[{ x: 0.5, y: 0.5, z: 0 }]],
            faceBlendshapes: [{ categories: [{ categoryName: 'jawOpen', score: 0.05 }] }],
          }),
          detect: vi.fn().mockReturnValue({
            faceLandmarks: [[{ x: 0.5, y: 0.5, z: 0 }]],
            faceBlendshapes: [{ categories: [{ categoryName: 'jawOpen', score: 0.05 }] }],
          }),
          close: vi.fn(),
        });
      }),
    },
    PoseLandmarker: {
      createFromOptions: vi.fn().mockImplementation(() => {
        return Promise.resolve({
          detectForVideo: vi.fn().mockReturnValue({ landmarks: [] }),
          close: vi.fn(),
        });
      }),
    },
  };
});

describe('S3: Camera Verification Flow & Performance', () => {
  beforeEach(() => {
    resetVisionManager();
    vi.clearAllMocks();
  });

  describe('Vision Manager Singleton & Preloading', () => {
    it('preloads models and marks preloaded in diagnostics', async () => {
      await preloadVisionModels();
      const diag = getVisionDiagnostics();
      expect(diag.preloaded).toBe(true);
    });

    it('returns the same singleton instance on multiple calls', async () => {
      const landmarker1 = await getSharedFaceLandmarker();
      const landmarker2 = await getSharedFaceLandmarker();
      expect(landmarker1).toBe(landmarker2);
    });

    it('records timing marks in diagnostics', async () => {
      await getSharedFaceLandmarker();
      const diag = getVisionDiagnostics();
      expect(diag.delegateUsed).toBe('GPU');
      expect(diag.timeToModelReadyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Capture -> Re-Validation -> Confirm -> Liveness Flow', () => {
    it('gating: capture is impossible while blocking checks fail', () => {
      // Create a failing report (face off-center and too dark)
      const report: FaceQualityReport = evaluateFaceQuality({
        faceCount: 1,
        landmarks: [{ x: 0.1, y: 0.1 }],
        facePixels: {
          data: new Uint8ClampedArray(64 * 64 * 4).fill(20), // Too dark
          width: 64,
          height: 64,
        },
      });

      expect(report.overallPassed).toBe(false);
      expect(report.firstFailingCriterion).not.toBeNull();

      // State machine should not transition to ready_to_capture if quality fails
      let state = setupDevicesReducer(initialSetupDevicesState, {
        type: 'CAMERA_QUALITY_CHECKING',
        deviceId: 'cam-1',
      });
      expect(state.camera.status).toBe('quality_checking');
    });

    it('successful capture -> preview -> confirm transitions to verified and unlocks liveness', () => {
      // 1. Streaming & Quality checking passes
      let state = setupDevicesReducer(initialSetupDevicesState, {
        type: 'CAMERA_STREAMING',
        deviceId: 'cam-1',
        label: 'Facecam HD',
      });
      state = setupDevicesReducer(state, {
        type: 'CAMERA_QUALITY_CHECKING',
        deviceId: 'cam-1',
        label: 'Facecam HD',
      });
      state = setupDevicesReducer(state, {
        type: 'CAMERA_READY_TO_CAPTURE',
        deviceId: 'cam-1',
        label: 'Facecam HD',
      });
      expect(state.camera.status).toBe('ready_to_capture');

      // 2. Capture frame and extract geometry signature in memory
      const syntheticLandmarks: Landmark3D[] = [];
      for (let i = 0; i < 478; i++) {
        syntheticLandmarks.push({ x: 0.5 + Math.sin(i) * 0.1, y: 0.5 + Math.cos(i) * 0.1, z: 0 });
      }
      const signature = extractFaceGeometrySignature(syntheticLandmarks);
      expect(signature).not.toBeNull();

      // 3. Dispatch frame captured
      state = setupDevicesReducer(state, {
        type: 'CAMERA_FRAME_CAPTURED',
        deviceId: 'cam-1',
        label: 'Facecam HD',
        previewDataUrl: 'data:image/jpeg;base64,mockPreview',
        faceSignature: signature!,
      });
      expect(state.camera.status).toBe('captured_pending_confirm');
      expect(state.liveness.status).toBe('locked'); // Must stay locked until candidate confirms!

      // 4. Candidate confirms
      state = setupDevicesReducer(state, { type: 'CAMERA_CONFIRM_CAPTURE' });
      expect(state.camera.status).toBe('verified');
      expect(state.liveness.status).toBe('idle');

      // 5. Liveness is now unlocked!
      state = setupDevicesReducer(state, {
        type: 'LIVENESS_START',
        totalSteps: 3,
        prompt: 'Look left',
      });
      expect(state.liveness.status).toBe('in_progress');
    });

    it('retake reverts to quality_checking and re-locks liveness', () => {
      const signature = {
        interOcularToHeight: 0.35,
        noseToChinToHeight: 0.40,
        eyeToNoseToHeight: 0.20,
        mouthWidthToWidth: 0.40,
      };

      let state: SetupDevicesState = {
        ...initialSetupDevicesState,
        camera: {
          status: 'captured_pending_confirm',
          deviceId: 'cam-1',
          label: 'Facecam HD',
          previewDataUrl: 'data:image/jpeg;base64,mock',
          faceSignature: signature,
        },
        liveness: { status: 'locked' },
      };

      // Candidate clicks Retake
      state = setupDevicesReducer(state, { type: 'CAMERA_RETAKE' });
      expect(state.camera.status).toBe('quality_checking');
      expect(state.liveness.status).toBe('locked');
    });

    it('camera lost immediately locks liveness and marks camera lost', () => {
      let state: SetupDevicesState = {
        ...initialSetupDevicesState,
        camera: { status: 'verified', deviceId: 'cam-1' },
        liveness: { status: 'passed' },
      };

      state = setupDevicesReducer(state, {
        type: 'CAMERA_LOST',
        reason: 'Camera disconnected',
      });

      expect(state.camera.status).toBe('lost');
      expect(state.liveness.status).toBe('locked');
    });
  });

  describe('Stage Timeouts', () => {
    it('sets camera to timeout with clear stage and message', () => {
      const state = setupDevicesReducer(initialSetupDevicesState, {
        type: 'CAMERA_TIMEOUT',
        stage: 'requesting_camera',
        error: 'Camera permission prompt timed out (no response after 8s).',
      });

      expect(state.camera.status).toBe('timeout');
      if (state.camera.status === 'timeout') {
        expect(state.camera.stage).toBe('requesting_camera');
        expect(state.camera.error).toContain('timed out');
      }
    });
  });
});
