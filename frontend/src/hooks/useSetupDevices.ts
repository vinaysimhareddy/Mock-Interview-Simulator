import { useReducer, useMemo, useCallback } from 'react';
import { FaceGeometrySignature } from '../lib/integrityTypes';

export type CameraLoadingStage =
  | 'requesting_camera'
  | 'starting_video'
  | 'loading_model'
  | 'detecting_face';

export type CameraState =
  | { status: 'idle' }
  | {
      status: 'requesting';
      stage?: CameraLoadingStage;
      progress?: number;
    }
  | { status: 'streaming'; deviceId?: string; label?: string }
  | { status: 'quality_checking'; deviceId?: string; label?: string }
  | { status: 'ready_to_capture'; deviceId?: string; label?: string }
  | {
      status: 'captured_pending_confirm';
      deviceId?: string;
      label?: string;
      previewDataUrl: string;
      faceSignature: FaceGeometrySignature;
    }
  | {
      status: 'verified';
      deviceId?: string;
      label?: string;
      previewDataUrl?: string;
      faceSignature?: FaceGeometrySignature;
    }
  | { status: 'denied'; error: string }
  | { status: 'in_use'; error: string }
  | { status: 'not_found'; error: string }
  | { status: 'timeout'; stage: CameraLoadingStage; error: string }
  | { status: 'lost'; reason: string }
  | { status: 'error'; error: string };

export type MicErrorCause =
  | 'not_allowed'
  | 'not_found'
  | 'not_readable'
  | 'overconstrained'
  | 'security'
  | 'speech_recognition'
  | 'generic';

export type MicState =
  | { status: 'idle' }
  | { status: 'requesting' }
  | { status: 'measuring_noise'; noiseFloorDb?: number }
  | {
      status: 'collecting_speech';
      voicedSeconds: number;
      targetSeconds: number;
      snrDb?: number;
      level: number;
      hint?: string;
    }
  | { status: 'streaming'; level: number; speechDetected: boolean }
  | {
      status: 'verified';
      level: number;
      snrDb?: number;
      noiseFloorDb?: number;
      voicedSeconds?: number;
    }
  | { status: 'denied'; error: string; cause?: MicErrorCause }
  | { status: 'error'; error: string; cause?: MicErrorCause; speechError?: string };

export type SpeakerState =
  | { status: 'idle' }
  | { status: 'playing_test'; expectedCode: string }
  | { status: 'awaiting_confirmation'; expectedCode: string }
  | { status: 'verified' }
  | { status: 'failed'; attempts: number };

export type LivenessState =
  | { status: 'locked' }
  | { status: 'idle' }
  | {
      status: 'in_progress';
      currentStep: number;
      totalSteps: number;
      prompt: string;
      targetMetric?: string;
    }
  | { status: 'passed' }
  | { status: 'failed'; retryCount: number; reason?: string };

export interface SetupDevicesState {
  camera: CameraState;
  mic: MicState;
  speaker: SpeakerState;
  liveness: LivenessState;
}

export type SetupDevicesAction =
  // Camera Actions
  | { type: 'CAMERA_REQUEST'; stage?: CameraLoadingStage }
  | { type: 'CAMERA_SET_STAGE'; stage: CameraLoadingStage; progress?: number }
  | { type: 'CAMERA_STREAMING'; deviceId?: string; label?: string }
  | { type: 'CAMERA_QUALITY_CHECKING'; deviceId?: string; label?: string }
  | { type: 'CAMERA_READY_TO_CAPTURE'; deviceId?: string; label?: string }
  | {
      type: 'CAMERA_FRAME_CAPTURED';
      deviceId?: string;
      label?: string;
      previewDataUrl: string;
      faceSignature: FaceGeometrySignature;
    }
  | { type: 'CAMERA_CONFIRM_CAPTURE' }
  | { type: 'CAMERA_RETAKE' }
  | { type: 'CAMERA_TIMEOUT'; stage: CameraLoadingStage; error: string }
  | {
      type: 'CAMERA_VERIFY';
      deviceId?: string;
      label?: string;
      previewDataUrl?: string;
      faceSignature?: FaceGeometrySignature;
    }
  | { type: 'CAMERA_DENIED'; error: string }
  | { type: 'CAMERA_IN_USE'; error: string }
  | { type: 'CAMERA_NOT_FOUND'; error: string }
  | { type: 'CAMERA_LOST'; reason: string }
  | { type: 'CAMERA_ERROR'; error: string }
  | { type: 'CAMERA_RESET' }

  // Mic Actions
  | { type: 'MIC_REQUEST' }
  | { type: 'MIC_MEASURING_NOISE'; noiseFloorDb?: number }
  | {
      type: 'MIC_COLLECTING_SPEECH';
      voicedSeconds: number;
      targetSeconds: number;
      snrDb?: number;
      level: number;
      hint?: string;
    }
  | { type: 'MIC_STREAMING'; level: number; speechDetected: boolean }
  | {
      type: 'MIC_VERIFY';
      level: number;
      snrDb?: number;
      noiseFloorDb?: number;
      voicedSeconds?: number;
    }
  | { type: 'MIC_DENIED'; error: string; cause?: MicErrorCause }
  | { type: 'MIC_ERROR'; error: string; cause?: MicErrorCause; speechError?: string }
  | { type: 'MIC_LOST'; reason: string }
  | { type: 'MIC_RESET' }

  // Speaker Actions
  | { type: 'SPEAKER_PLAY_TEST'; code: string }
  | { type: 'SPEAKER_AWAIT_CONFIRMATION' }
  | { type: 'SPEAKER_CONFIRM_CODE'; enteredCode: string }
  | { type: 'SPEAKER_FAIL' }
  | { type: 'SPEAKER_RESET' }

  // Liveness Actions
  | { type: 'LIVENESS_LOCK' }
  | {
      type: 'LIVENESS_START';
      totalSteps: number;
      prompt: string;
      targetMetric?: string;
    }
  | {
      type: 'LIVENESS_PROGRESS';
      currentStep: number;
      totalSteps: number;
      prompt: string;
      targetMetric?: string;
    }
  | { type: 'LIVENESS_PASS' }
  | { type: 'LIVENESS_FAIL'; reason?: string }
  | { type: 'LIVENESS_RESET' };

export const initialSetupDevicesState: SetupDevicesState = {
  camera: { status: 'idle' },
  mic: { status: 'idle' },
  speaker: { status: 'idle' },
  liveness: { status: 'locked' },
};

export function setupDevicesReducer(
  state: SetupDevicesState,
  action: SetupDevicesAction
): SetupDevicesState {
  switch (action.type) {
    // --- CAMERA ACTIONS ---
    case 'CAMERA_REQUEST':
      return {
        ...state,
        camera: { status: 'requesting', stage: action.stage ?? 'requesting_camera' },
        liveness: { status: 'locked' },
      };

    case 'CAMERA_SET_STAGE':
      return {
        ...state,
        camera: { status: 'requesting', stage: action.stage, progress: action.progress },
        liveness: { status: 'locked' },
      };

    case 'CAMERA_STREAMING':
      return {
        ...state,
        camera: { status: 'streaming', deviceId: action.deviceId, label: action.label },
        liveness: { status: 'locked' },
      };

    case 'CAMERA_QUALITY_CHECKING':
      if (
        state.camera.status === 'captured_pending_confirm' ||
        state.camera.status === 'verified'
      ) {
        return state;
      }
      return {
        ...state,
        camera: { status: 'quality_checking', deviceId: action.deviceId, label: action.label },
        liveness: { status: 'locked' },
      };

    case 'CAMERA_READY_TO_CAPTURE':
      if (
        state.camera.status === 'captured_pending_confirm' ||
        state.camera.status === 'verified'
      ) {
        return state;
      }
      return {
        ...state,
        camera: { status: 'ready_to_capture', deviceId: action.deviceId, label: action.label },
        liveness: { status: 'locked' },
      };

    case 'CAMERA_FRAME_CAPTURED':
      return {
        ...state,
        camera: {
          status: 'captured_pending_confirm',
          deviceId: action.deviceId,
          label: action.label,
          previewDataUrl: action.previewDataUrl,
          faceSignature: action.faceSignature,
        },
        liveness: { status: 'locked' },
      };

    case 'CAMERA_CONFIRM_CAPTURE':
      if (state.camera.status === 'captured_pending_confirm') {
        return {
          ...state,
          camera: {
            status: 'verified',
            deviceId: state.camera.deviceId,
            label: state.camera.label,
            previewDataUrl: state.camera.previewDataUrl,
            faceSignature: state.camera.faceSignature,
          },
          liveness: state.liveness.status === 'passed' ? state.liveness : { status: 'idle' },
        };
      }
      return state;

    case 'CAMERA_RETAKE':
      if (
        state.camera.status === 'captured_pending_confirm' ||
        state.camera.status === 'verified'
      ) {
        return {
          ...state,
          camera: {
            status: 'quality_checking',
            deviceId: state.camera.deviceId,
            label: state.camera.label,
          },
          liveness: { status: 'locked' },
        };
      }
      return state;

    case 'CAMERA_TIMEOUT':
      return {
        ...state,
        camera: { status: 'timeout', stage: action.stage, error: action.error },
        liveness: { status: 'locked' },
      };

    case 'CAMERA_VERIFY':
      return {
        ...state,
        camera: {
          status: 'verified',
          deviceId: action.deviceId,
          label: action.label,
          previewDataUrl: action.previewDataUrl,
          faceSignature: action.faceSignature,
        },
        liveness: state.liveness.status === 'passed' ? state.liveness : { status: 'idle' },
      };

    case 'CAMERA_DENIED':
      return {
        ...state,
        camera: { status: 'denied', error: action.error },
        liveness: { status: 'locked' },
      };

    case 'CAMERA_IN_USE':
      return {
        ...state,
        camera: { status: 'in_use', error: action.error },
        liveness: { status: 'locked' },
      };

    case 'CAMERA_NOT_FOUND':
      return {
        ...state,
        camera: { status: 'not_found', error: action.error },
        liveness: { status: 'locked' },
      };

    case 'CAMERA_LOST':
      return {
        ...state,
        camera: { status: 'lost', reason: action.reason },
        liveness: { status: 'locked' },
      };

    case 'CAMERA_ERROR':
      return {
        ...state,
        camera: { status: 'error', error: action.error },
        liveness: { status: 'locked' },
      };

    case 'CAMERA_RESET':
      return {
        ...state,
        camera: { status: 'idle' },
        liveness: { status: 'locked' },
      };

    // --- MIC ACTIONS ---
    case 'MIC_REQUEST':
      return {
        ...state,
        mic: { status: 'requesting' },
      };

    case 'MIC_MEASURING_NOISE':
      // LATCH GUARD: If mic is already verified, do NOT revert status back to measuring_noise!
      if (state.mic.status === 'verified') {
        return state;
      }
      return {
        ...state,
        mic: { status: 'measuring_noise', noiseFloorDb: action.noiseFloorDb },
      };

    case 'MIC_COLLECTING_SPEECH':
      // If mic is already verified, latch and do not revert back to collecting
      if (state.mic.status === 'verified') {
        return state;
      }
      return {
        ...state,
        mic: {
          status: 'collecting_speech',
          voicedSeconds: action.voicedSeconds,
          targetSeconds: action.targetSeconds,
          snrDb: action.snrDb,
          level: action.level,
          hint: action.hint,
        },
      };

    case 'MIC_STREAMING':
      // LATCH GUARD: If mic is already verified, do NOT revert status back to streaming!
      if (state.mic.status === 'verified') {
        return {
          ...state,
          mic: {
            ...state.mic,
            level: action.level,
          },
        };
      }
      return {
        ...state,
        mic: {
          status: 'streaming',
          level: action.level,
          speechDetected: action.speechDetected,
        },
      };

    case 'MIC_VERIFY':
      return {
        ...state,
        mic: {
          status: 'verified',
          level: action.level,
          snrDb: action.snrDb,
          noiseFloorDb: action.noiseFloorDb,
          voicedSeconds: action.voicedSeconds,
        },
      };

    case 'MIC_DENIED':
      return {
        ...state,
        mic: {
          status: 'denied',
          error: action.error,
          cause: action.cause || 'not_allowed',
        },
      };

    case 'MIC_ERROR':
      return {
        ...state,
        mic: {
          status: 'error',
          error: action.error,
          cause: action.cause || 'generic',
          speechError: action.speechError,
        },
      };

    case 'MIC_LOST':
      return {
        ...state,
        mic: {
          status: 'error',
          error: action.reason,
          cause: 'not_readable',
        },
      };

    case 'MIC_RESET':
      return {
        ...state,
        mic: { status: 'idle' },
      };

    // --- SPEAKER ACTIONS ---
    case 'SPEAKER_PLAY_TEST':
      return {
        ...state,
        speaker: { status: 'playing_test', expectedCode: action.code },
      };

    case 'SPEAKER_AWAIT_CONFIRMATION':
      if (state.speaker.status === 'playing_test') {
        return {
          ...state,
          speaker: {
            status: 'awaiting_confirmation',
            expectedCode: state.speaker.expectedCode,
          },
        };
      }
      return state;

    case 'SPEAKER_CONFIRM_CODE':
      if (
        (state.speaker.status === 'awaiting_confirmation' ||
          state.speaker.status === 'playing_test') &&
        action.enteredCode.trim() === state.speaker.expectedCode.trim()
      ) {
        return {
          ...state,
          speaker: { status: 'verified' },
        };
      }
      return {
        ...state,
        speaker: {
          status: 'failed',
          attempts: state.speaker.status === 'failed' ? state.speaker.attempts + 1 : 1,
        },
      };

    case 'SPEAKER_FAIL':
      return {
        ...state,
        speaker: {
          status: 'failed',
          attempts: state.speaker.status === 'failed' ? state.speaker.attempts + 1 : 1,
        },
      };

    case 'SPEAKER_RESET':
      return {
        ...state,
        speaker: { status: 'idle' },
      };

    // --- LIVENESS ACTIONS ---
    case 'LIVENESS_LOCK':
      return {
        ...state,
        liveness: { status: 'locked' },
      };

    case 'LIVENESS_START':
      // Gated: only start if camera is verified
      if (state.camera.status !== 'verified') {
        return {
          ...state,
          liveness: { status: 'locked' },
        };
      }
      return {
        ...state,
        liveness: {
          status: 'in_progress',
          currentStep: 1,
          totalSteps: action.totalSteps,
          prompt: action.prompt,
          targetMetric: action.targetMetric,
        },
      };

    case 'LIVENESS_PROGRESS':
      if (state.camera.status !== 'verified') {
        return {
          ...state,
          liveness: { status: 'locked' },
        };
      }
      return {
        ...state,
        liveness: {
          status: 'in_progress',
          currentStep: action.currentStep,
          totalSteps: action.totalSteps,
          prompt: action.prompt,
          targetMetric: action.targetMetric,
        },
      };

    case 'LIVENESS_PASS':
      if (state.camera.status !== 'verified') {
        return {
          ...state,
          liveness: { status: 'locked' },
        };
      }
      return {
        ...state,
        liveness: { status: 'passed' },
      };

    case 'LIVENESS_FAIL':
      return {
        ...state,
        liveness: {
          status: 'failed',
          retryCount: state.liveness.status === 'failed' ? state.liveness.retryCount + 1 : 1,
          reason: action.reason,
        },
      };

    case 'LIVENESS_RESET':
      return {
        ...state,
        liveness: state.camera.status === 'verified' ? { status: 'idle' } : { status: 'locked' },
      };

    default:
      return state;
  }
}

/**
 * Maps error objects from getUserMedia into typed actions for the state machine
 */
export function mapCameraErrorToAction(err: unknown): SetupDevicesAction {
  if (err instanceof Error) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      return {
        type: 'CAMERA_DENIED',
        error: 'Camera permission blocked. Click the lock icon in the address bar → allow Camera → reload.',
      };
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      return {
        type: 'CAMERA_NOT_FOUND',
        error: 'No camera found. Plug in a webcam.',
      };
    }
    if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      return {
        type: 'CAMERA_IN_USE',
        error: 'Camera is being used by another app (Zoom, Teams, OBS, Windows Camera). Close it and click Retry.',
      };
    }
    if (err.name === 'OverconstrainedError' || err.name === 'ConstraintNotSatisfiedError') {
      return {
        type: 'CAMERA_ERROR',
        error: 'Selected camera does not satisfy resolution/framerate constraints. Retrying with default settings.',
      };
    }
    if (err.name === 'SecurityError') {
      return {
        type: 'CAMERA_ERROR',
        error: 'Camera requires a secure HTTPS context or localhost.',
      };
    }
    return {
      type: 'CAMERA_ERROR',
      error: err.message || 'Unable to access webcam.',
    };
  }
  return {
    type: 'CAMERA_ERROR',
    error: 'Unknown error occurred while accessing camera.',
  };
}

export function useSetupDevices() {
  const [state, dispatch] = useReducer(setupDevicesReducer, initialSetupDevicesState);

  const isAllReady = useMemo(() => {
    return (
      state.camera.status === 'verified' &&
      state.mic.status === 'verified' &&
      state.speaker.status === 'verified' &&
      state.liveness.status === 'passed'
    );
  }, [state]);

  const canStartLiveness = useMemo(() => {
    return state.camera.status === 'verified';
  }, [state.camera.status]);

  const resetAll = useCallback(() => {
    dispatch({ type: 'CAMERA_RESET' });
    dispatch({ type: 'MIC_RESET' });
    dispatch({ type: 'SPEAKER_RESET' });
    dispatch({ type: 'LIVENESS_LOCK' });
  }, []);

  return {
    state,
    dispatch,
    isAllReady,
    canStartLiveness,
    resetAll,
  };
}
