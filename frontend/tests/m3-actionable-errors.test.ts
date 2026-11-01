import { describe, it, expect, vi } from 'vitest';
import {
  setupDevicesReducer,
  initialSetupDevicesState,
  MicErrorCause,
} from '../src/hooks/useSetupDevices';
import {
  mapSpeechRecognitionError,
  SpeechErrorInfo,
} from '../src/services/speech/speechErrors';
import {
  generateMaskedDiagnostics,
  maskDeviceLabel,
  detectOS,
  detectBrowser,
} from '../src/lib/maskedDiagnostics';

describe('M3: Specific, Actionable Error Messages and Recovery (§M3)', () => {
  describe('Per-Cause Microphone Errors & UI Copy Invariants', () => {
    it('maps NotAllowedError to explicit permission instructions with lock/tune icon guidance', () => {
      const state = setupDevicesReducer(initialSetupDevicesState, {
        type: 'MIC_DENIED',
        error:
          'Microphone permission blocked. Click the lock/tune icon in your address bar, set Microphone to Allow, then click Try Again.',
        cause: 'not_allowed',
      });

      expect(state.mic.status).toBe('denied');
      if (state.mic.status === 'denied') {
        expect(state.mic.cause).toBe('not_allowed');
        expect(state.mic.error).toContain('Click the lock/tune icon in your address bar');
        expect(state.mic.error).toContain('set Microphone to Allow, then click Try Again');
      }
    });

    it('maps NotFoundError to headset/webcam guidance with Check Devices action', () => {
      const state = setupDevicesReducer(initialSetupDevicesState, {
        type: 'MIC_ERROR',
        error:
          'No microphone detected. Plug in a headset or webcam microphone, then click Check Devices.',
        cause: 'not_found',
      });

      expect(state.mic.status).toBe('error');
      if (state.mic.status === 'error') {
        expect(state.mic.cause).toBe('not_found');
        expect(state.mic.error).toContain('No microphone detected');
        expect(state.mic.error).toContain('click Check Devices');
      }
    });

    it('maps NotReadableError and AbortError to app conflict guidance (Zoom/Teams/exclusive mode)', () => {
      const state = setupDevicesReducer(initialSetupDevicesState, {
        type: 'MIC_ERROR',
        error:
          'Your microphone is in use by another app (e.g. Zoom, Teams, Meet) or exclusive mode is enabled. Close other apps and click Try Again.',
        cause: 'not_readable',
      });

      expect(state.mic.status).toBe('error');
      if (state.mic.status === 'error') {
        expect(state.mic.cause).toBe('not_readable');
        expect(state.mic.error).toContain('in use by another app (e.g. Zoom, Teams, Meet)');
        expect(state.mic.error).toContain('exclusive mode is enabled');
      }
    });

    it('maps OverconstrainedError to auto-retry and default settings guidance', () => {
      const state = setupDevicesReducer(initialSetupDevicesState, {
        type: 'MIC_ERROR',
        error:
          'Requested audio settings not supported by this microphone. Switching to default settings…',
        cause: 'overconstrained',
      });

      expect(state.mic.status).toBe('error');
      if (state.mic.status === 'error') {
        expect(state.mic.cause).toBe('overconstrained');
        expect(state.mic.error).toContain('Requested audio settings not supported');
        expect(state.mic.error).toContain('Switching to default settings');
      }
    });

    it('maps SecurityError to HTTPS or localhost requirement', () => {
      const state = setupDevicesReducer(initialSetupDevicesState, {
        type: 'MIC_ERROR',
        error: 'Microphone requires HTTPS or localhost.',
        cause: 'security',
      });

      expect(state.mic.status).toBe('error');
      if (state.mic.status === 'error') {
        expect(state.mic.cause).toBe('security');
        expect(state.mic.error).toBe('Microphone requires HTTPS or localhost.');
      }
    });
  });

  describe('SpeechRecognition Error Handling (Distinct from Microphone Connection)', () => {
    const errorCodes = [
      'not-allowed',
      'service-not-allowed',
      'audio-capture',
      'network',
      'no-speech',
    ] as const;

    it('provides clear explanation and recovery step for all 5 standard SpeechRecognition error codes', () => {
      for (const code of errorCodes) {
        const info = mapSpeechRecognitionError(code);
        expect(info.title).toBeTruthy();
        expect(info.explanation).toBeTruthy();
        expect(info.recoveryStep).toBeTruthy();
      }
    });

    it('identifies not-allowed as permission block with site settings guidance', () => {
      const info = mapSpeechRecognitionError('not-allowed');
      expect(info.title).toBe('Speech Recognition Denied');
      expect(info.explanation).toContain('permission was blocked');
      expect(info.recoveryStep).toContain('browser site settings');
    });

    it('identifies service-not-allowed as policy restriction', () => {
      const info = mapSpeechRecognitionError('service-not-allowed');
      expect(info.title).toBe('Speech Service Blocked');
      expect(info.explanation).toContain('disabled or restricted by policy');
      expect(info.recoveryStep).toContain('browser settings or consult your system administrator');
    });

    it('identifies audio-capture as conflicting capture without blaming user permission', () => {
      const info = mapSpeechRecognitionError('audio-capture');
      expect(info.title).toBe('Audio Capture Conflict');
      expect(info.explanation).toContain('could not open your microphone input');
      expect(info.recoveryStep).toContain('Switch to another microphone');
    });

    it('identifies network error as cloud STT internet requirement', () => {
      const info = mapSpeechRecognitionError('network');
      expect(info.title).toBe('Speech Recognition Network Error');
      expect(info.explanation).toContain('requires an active internet connection');
      expect(info.recoveryStep).toContain('Check your internet connection');
    });

    it('identifies no-speech as mic muted or distance issue', () => {
      const info = mapSpeechRecognitionError('no-speech');
      expect(info.title).toBe('No Speech Detected');
      expect(info.explanation).toContain('No voice input was heard');
      expect(info.recoveryStep).toContain('Check that your microphone is not muted');
    });
  });

  describe('Masked Diagnostics Generation for Customer Support', () => {
    it('detects OS and Browser accurately from userAgent string', () => {
      const winUA =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
      expect(detectOS(winUA)).toBe('Windows');
      expect(detectBrowser(winUA)).toBe('Google Chrome 130.0.0.0');

      const macUA =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
      expect(detectOS(macUA)).toBe('macOS');
      expect(detectBrowser(macUA)).toBe('Apple Safari 17.0');

      const edgeUA =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.56';
      expect(detectBrowser(edgeUA)).toBe('Microsoft Edge 130.0.2849.56');

      const ffUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0';
      expect(detectBrowser(ffUA)).toBe('Mozilla Firefox 132.0');
    });

    it('masks device labels and serial numbers cleanly without exposing PII', () => {
      const label = 'Realtek High Definition Audio (SST) SN-99882211';
      const masked = maskDeviceLabel(label, 0, 'audioinput');

      expect(masked).toBe('Realtek High [Masked Device 1]');
      expect(masked).not.toContain('SN-99882211');
    });

    it('generates a complete, secret-free diagnostic summary string ready to paste', () => {
      const mockDevices: any[] = [
        {
          deviceId: 'device-id-abcdef123456',
          kind: 'audioinput',
          label: 'Microphone (1080P Web Camera-Audio)',
        },
        {
          deviceId: 'device-id-9876543210ab',
          kind: 'videoinput',
          label: '1080P Web Camera',
        },
      ];

      const report = generateMaskedDiagnostics({
        errorName: 'NotReadableError',
        errorMessage: 'Device in use by Zoom',
        cause: 'not_readable',
        audioContextState: 'suspended',
        devices: mockDevices,
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        speechRecognitionSupported: true,
      });

      expect(report).toContain('=== Interview Diagnostic Report ===');
      expect(report).toContain('Error Name: NotReadableError');
      expect(report).toContain('Operating System: Windows');
      expect(report).toContain('Browser: Google Chrome 130.0.0.0');
      expect(report).toContain('AudioContext State: suspended');
      expect(report).toContain('SpeechRecognition Supported: YES');
      expect(report).toContain('Device Summary: 2 total (1 audio inputs, 1 cameras, 0 speakers)');
      expect(report).toContain('[audioinput] Microphone (1080P [Masked Device 1] (id: devi***)');
      // Invariant: MUST NOT leak raw full deviceId
      expect(report).not.toContain('device-id-abcdef123456');
    });
  });
});
