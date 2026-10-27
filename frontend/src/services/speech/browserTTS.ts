/**
 * Browser-native TextToSpeech implementation using Web Speech Synthesis API.
 * Provides voice selection, natural pacing, and promise-based speech completion.
 */

import { TextToSpeech, TTSOptions, TTSState } from './types';

export class BrowserTextToSpeech implements TextToSpeech {
  private state: TTSState = 'idle';
  private selectedVoiceURI: string | null = null;
  private defaultRate: number = 1.0;
  private voices: SpeechSynthesisVoice[] = [];
  private stateListeners: Array<(state: TTSState) => void> = [];

  constructor() {
    this.initVoices();
  }

  public get isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  public get isSpeaking(): boolean {
    return this.state === 'speaking';
  }

  private initVoices(): void {
    if (!this.isSupported) return;

    const loadVoices = () => {
      this.voices = window.speechSynthesis.getVoices();
      if (!this.selectedVoiceURI && this.voices.length > 0) {
        // Prefer natural / high-quality English voices
        const preferred = this.voices.find(
          (v) =>
            v.lang.startsWith('en') &&
            (v.name.includes('Natural') ||
              v.name.includes('Google') ||
              v.name.includes('Samantha') ||
              v.name.includes('Daniel') ||
              v.name.includes('Karen'))
        );
        const fallback = this.voices.find((v) => v.lang.startsWith('en')) || this.voices[0];
        this.selectedVoiceURI = (preferred || fallback)?.voiceURI || null;
      }
    };

    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }

  public getVoices(): SpeechSynthesisVoice[] {
    if (this.voices.length === 0 && this.isSupported) {
      this.voices = window.speechSynthesis.getVoices();
    }
    return this.voices;
  }

  public setVoice(voiceURI: string): void {
    this.selectedVoiceURI = voiceURI;
  }

  public setRate(rate: number): void {
    this.defaultRate = Math.max(0.5, Math.min(2.0, rate));
  }

  /**
   * Speaks the provided text and returns a Promise that resolves when speech completes.
   */
  public speak(text: string, options: TTSOptions = {}): Promise<void> {
    return new Promise((resolve) => {
      if (!this.isSupported || !text.trim()) {
        resolve();
        return;
      }

      // Stop any prior speech immediately
      this.stop();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = options.rate ?? this.defaultRate;
      utterance.pitch = options.pitch ?? 1.0;
      utterance.volume = options.volume ?? 1.0;

      const targetVoiceURI = options.voiceURI || this.selectedVoiceURI;
      if (targetVoiceURI) {
        const found = this.voices.find((v) => v.voiceURI === targetVoiceURI);
        if (found) {
          utterance.voice = found;
        }
      }

      utterance.onstart = () => {
        this.setState('speaking');
      };

      utterance.onend = () => {
        this.setState('idle');
        resolve();
      };

      utterance.onerror = () => {
        this.setState('idle');
        resolve();
      };

      window.speechSynthesis.speak(utterance);
    });
  }

  public stop(): void {
    if (this.isSupported) {
      window.speechSynthesis.cancel();
    }
    this.setState('idle');
  }

  public pause(): void {
    if (this.isSupported && this.state === 'speaking') {
      window.speechSynthesis.pause();
      this.setState('paused');
    }
  }

  public resume(): void {
    if (this.isSupported && this.state === 'paused') {
      window.speechSynthesis.resume();
      this.setState('speaking');
    }
  }

  public onStateChange(callback: (state: TTSState) => void): () => void {
    this.stateListeners.push(callback);
    callback(this.state);
    return () => {
      this.stateListeners = this.stateListeners.filter((cb) => cb !== callback);
    };
  }

  private setState(state: TTSState): void {
    this.state = state;
    this.stateListeners.forEach((cb) => cb(state));
  }
}
