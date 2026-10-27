/**
 * Speech Recognition and Synthesis Abstraction Layer
 * Interfaces allow seamless swapping between Browser Web Speech API and neural providers.
 */

export interface TranscriptEvent {
  text: string;
  isFinal: boolean;
  timestamp: number;
  fullTranscript: string;
}

export interface SpeechError {
  error: string;
  message?: string;
  isFatal: boolean;
}

export type STTState = 'idle' | 'listening' | 'error';
export type TTSState = 'idle' | 'speaking' | 'paused';

export interface TTSOptions {
  voiceURI?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
}

export interface SpeechToText {
  readonly isSupported: boolean;
  readonly isListening: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  resetTranscript(): void;
  getFullTranscript(): string;
  onTranscript(callback: (event: TranscriptEvent) => void): () => void;
  onError(callback: (err: SpeechError) => void): () => void;
  onStateChange(callback: (state: STTState) => void): () => void;
}

export interface TextToSpeech {
  readonly isSupported: boolean;
  readonly isSpeaking: boolean;
  speak(text: string, options?: TTSOptions): Promise<void>;
  stop(): void;
  pause(): void;
  resume(): void;
  getVoices(): SpeechSynthesisVoice[];
  setVoice(voiceURI: string): void;
  setRate(rate: number): void;
  onStateChange(callback: (state: TTSState) => void): () => void;
}
