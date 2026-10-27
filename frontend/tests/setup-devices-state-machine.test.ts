import { describe, it, expect } from 'vitest';
import {
  setupDevicesReducer,
  initialSetupDevicesState,
  mapCameraErrorToAction,
  SetupDevicesState,
} from '../src/hooks/useSetupDevices';

describe('useSetupDevices State Machine', () => {
  it('initial state has all devices idle and liveness locked', () => {
    expect(initialSetupDevicesState.camera.status).toBe('idle');
    expect(initialSetupDevicesState.mic.status).toBe('idle');
    expect(initialSetupDevicesState.speaker.status).toBe('idle');
    expect(initialSetupDevicesState.liveness.status).toBe('locked');
  });

  describe('Camera Transitions', () => {
    it('handles happy path: idle -> requesting -> streaming -> verified', () => {
      let state = setupDevicesReducer(initialSetupDevicesState, { type: 'CAMERA_REQUEST' });
      expect(state.camera.status).toBe('requesting');

      state = setupDevicesReducer(state, {
        type: 'CAMERA_STREAMING',
        deviceId: 'cam-1',
        label: 'HD Webcam',
      });
      expect(state.camera.status).toBe('streaming');
      if (state.camera.status === 'streaming') {
        expect(state.camera.deviceId).toBe('cam-1');
        expect(state.camera.label).toBe('HD Webcam');
      }

      state = setupDevicesReducer(state, {
        type: 'CAMERA_VERIFY',
        deviceId: 'cam-1',
        label: 'HD Webcam',
      });
      expect(state.camera.status).toBe('verified');
    });

    it('handles camera failure states: denied, in_use, not_found, error', () => {
      let state = setupDevicesReducer(initialSetupDevicesState, {
        type: 'CAMERA_DENIED',
        error: 'Permission denied',
      });
      expect(state.camera.status).toBe('denied');

      state = setupDevicesReducer(initialSetupDevicesState, {
        type: 'CAMERA_IN_USE',
        error: 'Device busy',
      });
      expect(state.camera.status).toBe('in_use');

      state = setupDevicesReducer(initialSetupDevicesState, {
        type: 'CAMERA_NOT_FOUND',
        error: 'No camera',
      });
      expect(state.camera.status).toBe('not_found');

      state = setupDevicesReducer(initialSetupDevicesState, {
        type: 'CAMERA_ERROR',
        error: 'Unexpected error',
      });
      expect(state.camera.status).toBe('error');
    });

    it('handles camera lost and locks liveness if previously in progress', () => {
      // Setup verified camera & in_progress liveness
      let state: SetupDevicesState = {
        ...initialSetupDevicesState,
        camera: { status: 'verified', deviceId: 'cam-1' },
      };

      state = setupDevicesReducer(state, {
        type: 'LIVENESS_START',
        totalSteps: 3,
        prompt: 'Look up',
      });
      expect(state.liveness.status).toBe('in_progress');

      // Camera track ended/lost
      state = setupDevicesReducer(state, {
        type: 'CAMERA_LOST',
        reason: 'Camera disconnected',
      });

      expect(state.camera.status).toBe('lost');
      if (state.camera.status === 'lost') {
        expect(state.camera.reason).toBe('Camera disconnected');
      }
      // Invariant: liveness MUST lock when camera is lost
      expect(state.liveness.status).toBe('locked');
    });

    it('allows retry after camera lost', () => {
      let state: SetupDevicesState = {
        ...initialSetupDevicesState,
        camera: { status: 'lost', reason: 'disconnected' },
      };

      state = setupDevicesReducer(state, { type: 'CAMERA_REQUEST' });
      expect(state.camera.status).toBe('requesting');
    });
  });

  describe('Microphone Transitions', () => {
    it('handles idle -> requesting -> streaming -> verified', () => {
      let state = setupDevicesReducer(initialSetupDevicesState, { type: 'MIC_REQUEST' });
      expect(state.mic.status).toBe('requesting');

      state = setupDevicesReducer(state, {
        type: 'MIC_STREAMING',
        level: 45,
        speechDetected: true,
      });
      expect(state.mic.status).toBe('streaming');
      if (state.mic.status === 'streaming') {
        expect(state.mic.level).toBe(45);
        expect(state.mic.speechDetected).toBe(true);
      }

      state = setupDevicesReducer(state, { type: 'MIC_VERIFY', level: 50 });
      expect(state.mic.status).toBe('verified');
      if (state.mic.status === 'verified') {
        expect(state.mic.level).toBe(50);
      }
    });

    it('handles mic denied and error', () => {
      let state = setupDevicesReducer(initialSetupDevicesState, {
        type: 'MIC_DENIED',
        error: 'Mic blocked',
      });
      expect(state.mic.status).toBe('denied');

      state = setupDevicesReducer(initialSetupDevicesState, {
        type: 'MIC_ERROR',
        error: 'Audio hardware error',
      });
      expect(state.mic.status).toBe('error');
    });

    it('latches verified state: level drop to silence does not revert verified status', () => {
      let state = setupDevicesReducer(initialSetupDevicesState, { type: 'MIC_REQUEST' });
      state = setupDevicesReducer(state, {
        type: 'MIC_VERIFY',
        level: 60,
        snrDb: 22,
        noiseFloorDb: -42,
        voicedSeconds: 1.8,
      });
      expect(state.mic.status).toBe('verified');

      // Candidate stops speaking -> level drops to zero
      state = setupDevicesReducer(state, {
        type: 'MIC_STREAMING',
        level: 0,
        speechDetected: false,
      });

      // LATCH CHECK: Must stay verified!
      expect(state.mic.status).toBe('verified');
      if (state.mic.status === 'verified') {
        expect(state.mic.level).toBe(0);
      }

      // Neither noise measurement nor speech collection can knock it out of verified
      state = setupDevicesReducer(state, {
        type: 'MIC_MEASURING_NOISE',
        noiseFloorDb: -50,
      });
      expect(state.mic.status).toBe('verified');

      state = setupDevicesReducer(state, {
        type: 'MIC_COLLECTING_SPEECH',
        voicedSeconds: 0,
        targetSeconds: 1.5,
        level: 0,
      });
      expect(state.mic.status).toBe('verified');
    });

    it('reverts verified mic when track is lost or reset', () => {
      let state = setupDevicesReducer(initialSetupDevicesState, {
        type: 'MIC_VERIFY',
        level: 50,
      });
      expect(state.mic.status).toBe('verified');

      // MIC_LOST
      const lostState = setupDevicesReducer(state, {
        type: 'MIC_LOST',
        reason: 'Audio device disconnected',
      });
      expect(lostState.mic.status).toBe('error');
      if (lostState.mic.status === 'error') {
        expect(lostState.mic.error).toBe('Audio device disconnected');
      }

      // MIC_RESET
      const resetState = setupDevicesReducer(state, { type: 'MIC_RESET' });
      expect(resetState.mic.status).toBe('idle');
    });
  });

  describe('Speaker Transitions', () => {
    it('requires entering the spoken code to verify', () => {
      let state = setupDevicesReducer(initialSetupDevicesState, {
        type: 'SPEAKER_PLAY_TEST',
        code: '482',
      });
      expect(state.speaker.status).toBe('playing_test');

      state = setupDevicesReducer(state, { type: 'SPEAKER_AWAIT_CONFIRMATION' });
      expect(state.speaker.status).toBe('awaiting_confirmation');

      // Wrong code -> fail
      const failedState = setupDevicesReducer(state, {
        type: 'SPEAKER_CONFIRM_CODE',
        enteredCode: '999',
      });
      expect(failedState.speaker.status).toBe('failed');

      // Correct code -> verify
      const verifiedState = setupDevicesReducer(state, {
        type: 'SPEAKER_CONFIRM_CODE',
        enteredCode: '482',
      });
      expect(verifiedState.speaker.status).toBe('verified');
    });
  });

  describe('Liveness Gating', () => {
    it('refuses to start liveness if camera is not verified', () => {
      // Camera is idle
      let state = setupDevicesReducer(initialSetupDevicesState, {
        type: 'LIVENESS_START',
        totalSteps: 3,
        prompt: 'Look up',
      });
      expect(state.liveness.status).toBe('locked');

      // Camera is streaming but not yet verified
      state = setupDevicesReducer(initialSetupDevicesState, {
        type: 'CAMERA_STREAMING',
        deviceId: 'cam-1',
      });
      state = setupDevicesReducer(state, {
        type: 'LIVENESS_START',
        totalSteps: 3,
        prompt: 'Look up',
      });
      expect(state.liveness.status).toBe('locked');
    });

    it('starts, progresses, and passes liveness when camera is verified', () => {
      let state: SetupDevicesState = {
        ...initialSetupDevicesState,
        camera: { status: 'verified', deviceId: 'cam-1' },
      };

      state = setupDevicesReducer(state, {
        type: 'LIVENESS_START',
        totalSteps: 3,
        prompt: 'Step 1: Look up',
      });
      expect(state.liveness.status).toBe('in_progress');

      state = setupDevicesReducer(state, {
        type: 'LIVENESS_PROGRESS',
        currentStep: 2,
        totalSteps: 3,
        prompt: 'Step 2: Turn right',
      });
      expect(state.liveness.status).toBe('in_progress');
      if (state.liveness.status === 'in_progress') {
        expect(state.liveness.currentStep).toBe(2);
      }

      state = setupDevicesReducer(state, { type: 'LIVENESS_PASS' });
      expect(state.liveness.status).toBe('passed');
    });
  });

  describe('Error Mapping Helper', () => {
    it('maps DOMException errors to correct actions', () => {
      const notAllowed = new Error('Permission denied');
      notAllowed.name = 'NotAllowedError';
      expect(mapCameraErrorToAction(notAllowed).type).toBe('CAMERA_DENIED');

      const notFound = new Error('No device');
      notFound.name = 'NotFoundError';
      expect(mapCameraErrorToAction(notFound).type).toBe('CAMERA_NOT_FOUND');

      const notReadable = new Error('In use');
      notReadable.name = 'NotReadableError';
      expect(mapCameraErrorToAction(notReadable).type).toBe('CAMERA_IN_USE');

      const overconstrained = new Error('Constraint fail');
      overconstrained.name = 'OverconstrainedError';
      expect(mapCameraErrorToAction(overconstrained).type).toBe('CAMERA_ERROR');
    });
  });

  describe('S3 Guided Face Capture Transitions', () => {
    it('transitions through staged loading: requesting -> starting_video -> loading_model -> detecting_face', () => {
      let state = setupDevicesReducer(initialSetupDevicesState, {
        type: 'CAMERA_REQUEST',
        stage: 'requesting_camera',
      });
      expect(state.camera.status).toBe('requesting');
      if (state.camera.status === 'requesting') {
        expect(state.camera.stage).toBe('requesting_camera');
      }

      state = setupDevicesReducer(state, {
        type: 'CAMERA_SET_STAGE',
        stage: 'starting_video',
        progress: 25,
      });
      if (state.camera.status === 'requesting') {
        expect(state.camera.stage).toBe('starting_video');
        expect(state.camera.progress).toBe(25);
      }

      state = setupDevicesReducer(state, {
        type: 'CAMERA_SET_STAGE',
        stage: 'loading_model',
        progress: 50,
      });
      if (state.camera.status === 'requesting') {
        expect(state.camera.stage).toBe('loading_model');
      }

      state = setupDevicesReducer(state, {
        type: 'CAMERA_SET_STAGE',
        stage: 'detecting_face',
        progress: 75,
      });
      if (state.camera.status === 'requesting') {
        expect(state.camera.stage).toBe('detecting_face');
      }
    });

    it('handles capture -> confirm flow unlocking liveness', () => {
      let state = setupDevicesReducer(initialSetupDevicesState, {
        type: 'CAMERA_STREAMING',
        deviceId: 'cam-1',
        label: 'Integrated Webcam',
      });
      expect(state.camera.status).toBe('streaming');

      state = setupDevicesReducer(state, {
        type: 'CAMERA_QUALITY_CHECKING',
        deviceId: 'cam-1',
        label: 'Integrated Webcam',
      });
      expect(state.camera.status).toBe('quality_checking');

      state = setupDevicesReducer(state, {
        type: 'CAMERA_READY_TO_CAPTURE',
        deviceId: 'cam-1',
        label: 'Integrated Webcam',
      });
      expect(state.camera.status).toBe('ready_to_capture');

      // User captures frame
      const dummySignature = {
        interOcularToHeight: 0.35,
        noseToChinToHeight: 0.40,
        eyeToNoseToHeight: 0.22,
        mouthWidthToWidth: 0.45,
      };
      state = setupDevicesReducer(state, {
        type: 'CAMERA_FRAME_CAPTURED',
        deviceId: 'cam-1',
        label: 'Integrated Webcam',
        previewDataUrl: 'data:image/jpeg;base64,dummy',
        faceSignature: dummySignature,
      });
      expect(state.camera.status).toBe('captured_pending_confirm');
      // Liveness must remain locked until confirmed!
      expect(state.liveness.status).toBe('locked');

      // User confirms capture
      state = setupDevicesReducer(state, { type: 'CAMERA_CONFIRM_CAPTURE' });
      expect(state.camera.status).toBe('verified');
      if (state.camera.status === 'verified') {
        expect(state.camera.previewDataUrl).toBe('data:image/jpeg;base64,dummy');
        expect(state.camera.faceSignature).toEqual(dummySignature);
      }

      // Now liveness can be started!
      state = setupDevicesReducer(state, {
        type: 'LIVENESS_START',
        totalSteps: 3,
        prompt: 'Look up',
      });
      expect(state.liveness.status).toBe('in_progress');
    });

    it('handles Retake: reverts to quality_checking and re-locks liveness', () => {
      let state: SetupDevicesState = {
        ...initialSetupDevicesState,
        camera: {
          status: 'captured_pending_confirm',
          deviceId: 'cam-1',
          label: 'Webcam',
          previewDataUrl: 'data:image/jpeg;base64,dummy',
          faceSignature: {
            interOcularToHeight: 0.35,
            noseToChinToHeight: 0.4,
            eyeToNoseToHeight: 0.2,
            mouthWidthToWidth: 0.4,
          },
        },
      };

      state = setupDevicesReducer(state, { type: 'CAMERA_RETAKE' });
      expect(state.camera.status).toBe('quality_checking');
      expect(state.liveness.status).toBe('locked');
    });

    it('handles timeout transition and locks liveness', () => {
      let state = setupDevicesReducer(initialSetupDevicesState, {
        type: 'CAMERA_TIMEOUT',
        stage: 'loading_model',
        error: 'Vision model took too long to load (timeout after 20s).',
      });
      expect(state.camera.status).toBe('timeout');
      if (state.camera.status === 'timeout') {
        expect(state.camera.stage).toBe('loading_model');
        expect(state.camera.error).toContain('timeout');
      }
      expect(state.liveness.status).toBe('locked');
    });
  });
});

