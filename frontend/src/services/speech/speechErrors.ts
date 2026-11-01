/**
 * speechErrors.ts
 *
 * Distinct error mapping and recovery guidance for Web Speech API SpeechRecognition (§M3).
 * Maps: not-allowed, service-not-allowed, audio-capture, network, no-speech.
 */

export interface SpeechErrorInfo {
  title: string;
  explanation: string;
  recoveryStep: string;
}

export function mapSpeechRecognitionError(errorName: string): SpeechErrorInfo {
  switch (errorName) {
    case 'not-allowed':
      return {
        title: 'Speech Recognition Denied',
        explanation: 'Speech recognition permission was blocked by the browser or operating system.',
        recoveryStep: 'Allow speech recognition in browser site settings and click Try Again.',
      };
    case 'service-not-allowed':
      return {
        title: 'Speech Service Blocked',
        explanation: 'The browser speech service is disabled or restricted by policy.',
        recoveryStep: 'Enable speech services in browser settings or consult your system administrator.',
      };
    case 'audio-capture':
      return {
        title: 'Audio Capture Conflict',
        explanation: 'The speech recognition engine could not open your microphone input.',
        recoveryStep: 'Switch to another microphone in the dropdown or close conflicting apps, then click Try Again.',
      };
    case 'network':
      return {
        title: 'Speech Recognition Network Error',
        explanation: 'Browser speech recognition requires an active internet connection to process speech.',
        recoveryStep: 'Check your internet connection and click Try Again.',
      };
    case 'no-speech':
      return {
        title: 'No Speech Detected',
        explanation: 'No voice input was heard before timeout.',
        recoveryStep: 'Check that your microphone is not muted and speak clearly into your microphone.',
      };
    default:
      return {
        title: 'Speech Recognition Notice',
        explanation: `Speech recognition reported: ${errorName}`,
        recoveryStep: 'Click Try Again to restart speech recognition.',
      };
  }
}

