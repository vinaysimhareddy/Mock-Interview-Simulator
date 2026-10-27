import { describe, it, expect } from 'vitest';
import {
  setupDevicesReducer,
  initialSetupDevicesState,
  SetupDevicesState,
} from '../src/hooks/useSetupDevices';

describe('Pre-Interview Verification Gating (F4)', () => {
  it('strictly prevents starting interview when any step is unverified', () => {
    // 1. Initial: all unverified
    let state = initialSetupDevicesState;
    let isAllReady =
      state.camera.status === 'verified' &&
      state.mic.status === 'verified' &&
      state.speaker.status === 'verified' &&
      state.liveness.status === 'passed';
    expect(isAllReady).toBe(false);

    // 2. Camera verified only
    state = setupDevicesReducer(state, { type: 'CAMERA_VERIFY' });
    isAllReady =
      state.camera.status === 'verified' &&
      state.mic.status === 'verified' &&
      state.speaker.status === 'verified' &&
      state.liveness.status === 'passed';
    expect(isAllReady).toBe(false);

    // 3. Camera & mic verified
    state = setupDevicesReducer(state, { type: 'MIC_VERIFY', level: 50 });
    isAllReady =
      state.camera.status === 'verified' &&
      state.mic.status === 'verified' &&
      state.speaker.status === 'verified' &&
      state.liveness.status === 'passed';
    expect(isAllReady).toBe(false);

    // 4. Camera, mic, speaker verified (liveness still locked)
    state = setupDevicesReducer(state, { type: 'SPEAKER_PLAY_TEST', code: '123' });
    state = setupDevicesReducer(state, { type: 'SPEAKER_AWAIT_CONFIRMATION' });
    state = setupDevicesReducer(state, { type: 'SPEAKER_CONFIRM_CODE', enteredCode: '123' });
    expect(state.speaker.status).toBe('verified');
    isAllReady =
      state.camera.status === 'verified' &&
      state.mic.status === 'verified' &&
      state.speaker.status === 'verified' &&
      state.liveness.status === 'passed';
    expect(isAllReady).toBe(false);

    // 5. All 4 verified
    state = setupDevicesReducer(state, {
      type: 'LIVENESS_START',
      totalSteps: 3,
      prompt: 'Look up',
    });
    state = setupDevicesReducer(state, { type: 'LIVENESS_PASS' });
    expect(state.liveness.status).toBe('passed');

    isAllReady =
      state.camera.status === 'verified' &&
      state.mic.status === 'verified' &&
      state.speaker.status === 'verified' &&
      state.liveness.status === 'passed';
    expect(isAllReady).toBe(true);
  });

  it('speaker code confirmation fails on wrong code and requires matching 3 digits', () => {
    let state = setupDevicesReducer(initialSetupDevicesState, {
      type: 'SPEAKER_PLAY_TEST',
      code: '839',
    });
    state = setupDevicesReducer(state, { type: 'SPEAKER_AWAIT_CONFIRMATION' });

    // Invalid code
    state = setupDevicesReducer(state, {
      type: 'SPEAKER_CONFIRM_CODE',
      enteredCode: '123',
    });
    expect(state.speaker.status).toBe('failed');

    // Matching code
    state = setupDevicesReducer(
      { ...state, speaker: { status: 'awaiting_confirmation', expectedCode: '839' } },
      { type: 'SPEAKER_CONFIRM_CODE', enteredCode: '839' }
    );
    expect(state.speaker.status).toBe('verified');
  });

  it('disables liveness immediately if camera is disconnected or lost', () => {
    let state: SetupDevicesState = {
      camera: { status: 'verified' },
      mic: { status: 'verified', level: 50 },
      speaker: { status: 'verified' },
      liveness: { status: 'passed' },
    };

    // Camera track lost
    state = setupDevicesReducer(state, {
      type: 'CAMERA_LOST',
      reason: 'Webcam unplugged',
    });

    expect(state.camera.status).toBe('lost');
    // Liveness reverts to locked!
    expect(state.liveness.status).toBe('locked');

    const isAllReady =
      state.camera.status === 'verified' &&
      state.mic.status === 'verified' &&
      state.speaker.status === 'verified' &&
      state.liveness.status === 'passed';
    expect(isAllReady).toBe(false);
  });
});
