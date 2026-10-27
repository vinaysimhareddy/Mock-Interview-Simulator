/**
 * Voice Activity Detection (VAD) & Energy Computation Engine
 *
 * Provides real-time Root-Mean-Square (RMS) amplitude calculation and
 * speech thresholding with hangover logic to distinguish human speech from ambient noise.
 */

export interface VADOptions {
  energyThreshold?: number;       // RMS threshold above which audio is considered voice (default: 0.045)
  minSpeechDurationMs?: number;   // Minimum speech duration to confirm speech start (default: 400ms)
  hangoverMs?: number;            // Time to keep speaking state active after audio drops below threshold (default: 300ms)
  minWordsForSpeech?: number;     // Minimum recognized words required to confirm meaningful speech (default: 2)
}

export interface VADState {
  isSpeaking: boolean;
  currentRMS: number;
  speechDurationMs: number;
  silenceDurationMs: number;
  speechStartTime: number | null;
  lastSpeechTime: number | null;
}

/**
 * Computes the Root-Mean-Square (RMS) amplitude of a time-domain audio buffer.
 * Accepts either Uint8Array (values 0-255 centered at 128) or Float32Array (-1.0 to 1.0).
 */
export function computeRMS(buffer: Uint8Array | Float32Array): number {
  if (!buffer || buffer.length === 0) return 0;

  let sumSquares = 0;
  const len = buffer.length;

  if (buffer instanceof Uint8Array) {
    for (let i = 0; i < len; i++) {
      // Normalize [0..255] byte data around 0.0 (-1.0 to +1.0)
      const normalized = (buffer[i] - 128) / 128;
      sumSquares += normalized * normalized;
    }
  } else {
    for (let i = 0; i < len; i++) {
      const val = buffer[i];
      sumSquares += val * val;
    }
  }

  return Math.sqrt(sumSquares / len);
}

/**
 * Evaluates whether a candidate's voice activity constitutes significant speech
 * rather than brief coughs, ambient clicks, or filler noise.
 */
export function isSignificantSpeech(durationMs: number, wordCount: number, minDurationMs = 400, minWords = 2): boolean {
  return durationMs >= minDurationMs && wordCount >= minWords;
}

export class VoiceActivityDetector {
  private energyThreshold: number;
  private minSpeechDurationMs: number;
  private hangoverMs: number;

  private isSpeaking: boolean = false;
  private speechStartTime: number | null = null;
  private lastSpeechTime: number | null = null;
  private silenceStartTime: number | null = null;

  constructor(options: VADOptions = {}) {
    this.energyThreshold = options.energyThreshold ?? 0.045;
    this.minSpeechDurationMs = options.minSpeechDurationMs ?? 400;
    this.hangoverMs = options.hangoverMs ?? 300;
  }

  /**
   * Resets VAD state tracking for a new question or interview turn.
   */
  public reset(): void {
    this.isSpeaking = false;
    this.speechStartTime = null;
    this.lastSpeechTime = null;
    this.silenceStartTime = null;
  }

  /**
   * Processes a newly sampled audio buffer with high-precision timestamp.
   *
   * @param buffer Byte or float time-domain audio data
   * @param now Current timestamp in milliseconds (defaults to performance.now())
   * @returns Current VAD state with metrics
   */
  public processFrame(buffer: Uint8Array | Float32Array, now: number = performance.now()): VADState {
    const rms = computeRMS(buffer);
    const isAboveThreshold = rms >= this.energyThreshold;

    if (isAboveThreshold) {
      this.lastSpeechTime = now;
      this.silenceStartTime = null;

      if (!this.speechStartTime) {
        this.speechStartTime = now;
      }

      // Check if continuous speech has exceeded min duration
      const speechDuration = now - this.speechStartTime;
      if (speechDuration >= this.minSpeechDurationMs) {
        this.isSpeaking = true;
      }
    } else {
      // Audio is below energy threshold
      if (this.isSpeaking) {
        if (!this.silenceStartTime) {
          this.silenceStartTime = now;
        }

        // Apply hangover window before dropping speaking state
        if (this.lastSpeechTime && now - this.lastSpeechTime > this.hangoverMs) {
          this.isSpeaking = false;
          this.speechStartTime = null;
        }
      } else {
        this.speechStartTime = null;
        if (!this.silenceStartTime) {
          this.silenceStartTime = now;
        }
      }
    }

    const speechDurationMs = this.speechStartTime ? Math.max(0, now - this.speechStartTime) : 0;
    const silenceDurationMs = this.silenceStartTime ? Math.max(0, now - this.silenceStartTime) : 0;

    return {
      isSpeaking: this.isSpeaking,
      currentRMS: rms,
      speechDurationMs,
      silenceDurationMs,
      speechStartTime: this.speechStartTime,
      lastSpeechTime: this.lastSpeechTime,
    };
  }

  public getEnergyThreshold(): number {
    return this.energyThreshold;
  }

  public setEnergyThreshold(threshold: number): void {
    this.energyThreshold = threshold;
  }
}
