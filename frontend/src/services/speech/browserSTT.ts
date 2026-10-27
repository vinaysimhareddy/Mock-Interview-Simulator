/**
 * Browser-native SpeechToText implementation using Web Speech API.
 * Features auto-restarting to combat Chrome's 60-second cutoff and seamless transcript stitching.
 */

import { SpeechToText, TranscriptEvent, SpeechError, STTState } from './types';
import { TranscriptStitcher } from './transcriptStitcher';

declare global {
  interface Window {
    SpeechRecognition?: any;
    webkitSpeechRecognition?: any;
  }
}

export class BrowserSpeechToText implements SpeechToText {
  private recognition: any = null;
  private stitcher: TranscriptStitcher = new TranscriptStitcher();
  private state: STTState = 'idle';
  private desiredListening: boolean = false;
  private restartTimeout: number | null = null;
  private restartCount: number = 0;

  private transcriptListeners: Array<(event: TranscriptEvent) => void> = [];
  private errorListeners: Array<(err: SpeechError) => void> = [];
  private stateListeners: Array<(state: STTState) => void> = [];

  constructor() {
    this.initRecognition();
  }

  public get isSupported(): boolean {
    return typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  public get isListening(): boolean {
    return this.state === 'listening';
  }

  private initRecognition(): void {
    if (!this.isSupported) return;

    const SpeechRecClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SpeechRecClass();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';
    this.recognition.maxAlternatives = 1;

    this.recognition.onstart = () => {
      this.setState('listening');
      this.restartCount = 0;
    };

    this.recognition.onresult = (event: any) => {
      let interimChunk = '';
      let finalChunk = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const item = event.results[i];
        const text = item[0]?.transcript || '';
        if (item.isFinal) {
          finalChunk += text;
        } else {
          interimChunk += text;
        }
      }

      if (finalChunk) {
        const { fullTranscript } = this.stitcher.append(finalChunk, true);
        this.emitTranscript({
          text: finalChunk.trim(),
          isFinal: true,
          timestamp: Date.now(),
          fullTranscript,
        });
      } else if (interimChunk) {
        const { fullTranscript } = this.stitcher.append(interimChunk, false);
        this.emitTranscript({
          text: interimChunk.trim(),
          isFinal: false,
          timestamp: Date.now(),
          fullTranscript,
        });
      }
    };

    this.recognition.onerror = (event: any) => {
      const errName = event.error || 'unknown';

      // Ignore benign errors like no-speech or aborted during graceful turn changes
      if (errName === 'no-speech' || errName === 'aborted') {
        return;
      }

      const isFatal = errName === 'not-allowed' || errName === 'audio-capture';
      if (isFatal) {
        this.desiredListening = false;
        this.setState('error');
      }

      this.emitError({
        error: errName,
        message: event.message,
        isFatal,
      });
    };

    this.recognition.onend = () => {
      // If we still want to be listening (e.g. Chrome 60s timeout occurred), auto-restart seamlessly
      if (this.desiredListening && this.isSupported) {
        this.scheduleRestart();
      } else {
        this.setState('idle');
      }
    };
  }

  private scheduleRestart(): void {
    if (this.restartTimeout) {
      window.clearTimeout(this.restartTimeout);
    }

    this.restartCount++;
    const delay = Math.min(100 * this.restartCount, 500);

    this.restartTimeout = window.setTimeout(() => {
      if (this.desiredListening && this.recognition) {
        try {
          this.recognition.start();
        } catch {
          // If already started or browser throws, retry gently
          this.scheduleRestart();
        }
      }
    }, delay);
  }

  public start(): void {
    if (!this.isSupported) {
      this.emitError({
        error: 'unsupported',
        message: 'SpeechRecognition API is not supported in this browser.',
        isFatal: true,
      });
      return;
    }

    this.desiredListening = true;
    if (this.restartTimeout) {
      window.clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }

    try {
      this.recognition.start();
    } catch {
      // If already started, do nothing
    }
  }

  public stop(): void {
    this.desiredListening = false;
    if (this.restartTimeout) {
      window.clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // ignore
      }
    }
    this.setState('idle');
  }

  public abort(): void {
    this.desiredListening = false;
    if (this.restartTimeout) {
      window.clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }

    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        // ignore
      }
    }
    this.setState('idle');
  }

  public resetTranscript(): void {
    this.stitcher.reset();
  }

  public getFullTranscript(): string {
    return this.stitcher.getFullTranscript();
  }

  public onTranscript(callback: (event: TranscriptEvent) => void): () => void {
    this.transcriptListeners.push(callback);
    return () => {
      this.transcriptListeners = this.transcriptListeners.filter((cb) => cb !== callback);
    };
  }

  public onError(callback: (err: SpeechError) => void): () => void {
    this.errorListeners.push(callback);
    return () => {
      this.errorListeners = this.errorListeners.filter((cb) => cb !== callback);
    };
  }

  public onStateChange(callback: (state: STTState) => void): () => void {
    this.stateListeners.push(callback);
    callback(this.state);
    return () => {
      this.stateListeners = this.stateListeners.filter((cb) => cb !== callback);
    };
  }

  private setState(state: STTState): void {
    this.state = state;
    this.stateListeners.forEach((cb) => cb(state));
  }

  private emitTranscript(event: TranscriptEvent): void {
    this.transcriptListeners.forEach((cb) => cb(event));
  }

  private emitError(err: SpeechError): void {
    this.errorListeners.forEach((cb) => cb(err));
  }
}
