/**
 * micQuality.ts
 *
 * Pure functions, accumulation classes, and evaluation logic for microphone quality checking (§2.3).
 * Evaluates: ambient noise floor, voiced speech accumulation, SNR, peak clipping, and speech level range.
 */

import { MIC_QUALITY_CONFIG, MicQualityConfig } from './micQualityConfig';

export type MicCriterionId =
  | 'noise_floor'
  | 'voiced_duration'
  | 'snr'
  | 'clipping'
  | 'level_range'
  | 'speech_recognition';

export interface MicCriterionResult {
  id: MicCriterionId;
  name: string;
  passed: boolean;
  isOptional?: boolean;
  hint: string;
  value?: number | string | Record<string, unknown>;
}

export interface MicQualityReport {
  overallPassed: boolean;
  criteria: MicCriterionResult[];
  failingCriterion: MicCriterionResult | null;
  primaryHint: string;
  noiseFloorRms: number;
  noiseFloorDb: number;
  currentRms: number;
  currentDb: number;
  estimatedSnrDb: number;
  voicedSeconds: number;
  targetVoicedSeconds: number;
  isClipping: boolean;
}

export interface MicEvaluationInput {
  currentRms: number;
  peakAmplitude?: number;
  noiseFloorRms: number;
  noiseFloorDb?: number;
  isNoiseFloorCalibrated: boolean;
  cumulativeVoicedSeconds: number;
  targetVoicedSeconds?: number;
  recognizedWordsCount?: number;
  config?: MicQualityConfig;
}

/**
 * Computes Root Mean Square (RMS) of audio samples.
 * Supports Float32Array [-1..1], number[], or Uint8Array [0..255] from byte time domain data.
 */
export function computeRMS(buffer: Float32Array | number[] | Uint8Array): number {
  if (!buffer || buffer.length === 0) return 0;

  let sumSquares = 0;
  const len = buffer.length;

  if (buffer instanceof Uint8Array) {
    for (let i = 0; i < len; i++) {
      const normalized = (buffer[i] - 128) / 128;
      sumSquares += normalized * normalized;
    }
  } else {
    for (let i = 0; i < len; i++) {
      const sample = buffer[i];
      sumSquares += sample * sample;
    }
  }

  return Math.sqrt(sumSquares / len);
}

/**
 * Computes the peak absolute amplitude from audio samples.
 */
export function computePeak(buffer: Float32Array | number[] | Uint8Array): number {
  if (!buffer || buffer.length === 0) return 0;

  let peak = 0;
  const len = buffer.length;

  if (buffer instanceof Uint8Array) {
    for (let i = 0; i < len; i++) {
      const absVal = Math.abs((buffer[i] - 128) / 128);
      if (absVal > peak) peak = absVal;
    }
  } else {
    for (let i = 0; i < len; i++) {
      const absVal = Math.abs(buffer[i]);
      if (absVal > peak) peak = absVal;
    }
  }

  return peak;
}

/**
 * Converts RMS amplitude (0..1) to dBFS (clamped to minDb to avoid -Infinity).
 */
export function rmsToDb(rms: number, minDb = -100): number {
  if (rms <= 1e-5) return minDb;
  const db = 20 * Math.log10(rms);
  return Math.max(minDb, db);
}

/**
 * Converts dBFS to linear RMS.
 */
export function dbToRms(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Estimates Signal-to-Noise Ratio (SNR) in dB between speech RMS and noise floor RMS.
 */
export function estimateSNR(speechRms: number, noiseFloorRms: number): number {
  const safeNoise = Math.max(1e-5, noiseFloorRms);
  const safeSpeech = Math.max(1e-5, speechRms);
  return 20 * Math.log10(safeSpeech / safeNoise);
}

/**
 * Determines whether the signal exhibits clipping (> threshold).
 */
export function isClipping(
  peak: number,
  threshold: number = MIC_QUALITY_CONFIG.PEAK_CLIPPING_THRESHOLD
): boolean {
  return peak >= threshold;
}

/**
 * Checks if the average speech level falls within a healthy dynamic range.
 */
export function checkLevelRange(
  rms: number,
  min: number = MIC_QUALITY_CONFIG.MIN_AVERAGE_SPEECH_RMS,
  max: number = MIC_QUALITY_CONFIG.MAX_AVERAGE_SPEECH_RMS
): { healthy: boolean; reason?: 'too_quiet' | 'too_loud'; hint?: string } {
  if (rms < min) {
    return {
      healthy: false,
      reason: 'too_quiet',
      hint: MIC_QUALITY_CONFIG.HINTS.SPEAK_LOUDER,
    };
  }
  if (rms > max) {
    return {
      healthy: false,
      reason: 'too_loud',
      hint: MIC_QUALITY_CONFIG.HINTS.TOO_LOUD,
    };
  }
  return { healthy: true };
}

/**
 * Noise Floor Calibrator: Measures ambient RMS over a fixed window (default: 1.0 s).
 */
export class NoiseFloorCalibrator {
  private samples: { rms: number; timestamp: number }[] = [];
  private startTime: number | null = null;
  private readonly durationMs: number;
  private readonly maxAcceptableRms: number;

  constructor(
    durationMs: number = MIC_QUALITY_CONFIG.NOISE_FLOOR_DURATION_MS,
    maxAcceptableRms: number = MIC_QUALITY_CONFIG.MAX_ACCEPTABLE_NOISE_FLOOR_RMS
  ) {
    this.durationMs = durationMs;
    this.maxAcceptableRms = maxAcceptableRms;
  }

  public addSample(rms: number, timestamp: number): void {
    if (this.startTime === null) {
      this.startTime = timestamp;
    }
    this.samples.push({ rms, timestamp });
  }

  public isCalibrated(now: number): boolean {
    if (this.startTime === null) return false;
    return now - this.startTime >= this.durationMs && this.samples.length > 0;
  }

  public getElapsedMs(now: number): number {
    if (this.startTime === null) return 0;
    return Math.max(0, now - this.startTime);
  }

  public getAverageRms(): number {
    if (this.samples.length === 0) return 0;
    const sum = this.samples.reduce((acc, s) => acc + s.rms, 0);
    return sum / this.samples.length;
  }

  public getAverageDb(): number {
    return rmsToDb(this.getAverageRms());
  }

  public isAcceptable(): boolean {
    return this.getAverageRms() <= this.maxAcceptableRms;
  }

  public reset(): void {
    this.samples = [];
    this.startTime = null;
  }
}

export interface VoicedInterval {
  start: number;
  end: number;
}

/**
 * Voiced Time Accumulator:
 * Tracks speech segments within a rolling sliding window (default: 6.0 s).
 * Rejects transient noise blips with duration < minSegmentMs (default: 150 ms).
 */
export class VoicedTimeAccumulator {
  private activeStreakStart: number | null = null;
  private activeStreakLastTime: number | null = null;
  private committedIntervals: VoicedInterval[] = [];
  private readonly minSegmentMs: number;
  private readonly windowMs: number;

  constructor(
    minSegmentMs: number = MIC_QUALITY_CONFIG.MIN_VOICED_SEGMENT_MS,
    windowMs: number = MIC_QUALITY_CONFIG.SLIDING_WINDOW_MS
  ) {
    this.minSegmentMs = minSegmentMs;
    this.windowMs = windowMs;
  }

  /**
   * Updates state with frame at timestamp `now` and whether it exceeds the voiced threshold.
   * Returns current cumulative voiced duration in milliseconds inside the sliding window.
   */
  public update(now: number, isVoiced: boolean): number {
    if (isVoiced) {
      if (this.activeStreakStart === null) {
        this.activeStreakStart = now;
        this.activeStreakLastTime = now;
      } else {
        this.activeStreakLastTime = now;
      }
    } else {
      if (this.activeStreakStart !== null && this.activeStreakLastTime !== null) {
        const streakDuration = this.activeStreakLastTime - this.activeStreakStart;
        if (streakDuration >= this.minSegmentMs) {
          this.committedIntervals.push({
            start: this.activeStreakStart,
            end: this.activeStreakLastTime,
          });
        }
        this.activeStreakStart = null;
        this.activeStreakLastTime = null;
      }
    }

    return this.getCumulativeVoicedMs(now);
  }

  /**
   * Calculates the cumulative voiced time (ms) within [now - windowMs, now].
   */
  public getCumulativeVoicedMs(now: number): number {
    const windowStart = now - this.windowMs;
    let totalMs = 0;

    // Prune expired intervals and sum overlapping portions
    const survivingIntervals: VoicedInterval[] = [];
    for (const interval of this.committedIntervals) {
      if (interval.end < windowStart) {
        continue; // Fully expired
      }
      survivingIntervals.push(interval);
      const effectiveStart = Math.max(windowStart, interval.start);
      const effectiveEnd = Math.min(now, interval.end);
      if (effectiveEnd > effectiveStart) {
        totalMs += effectiveEnd - effectiveStart;
      }
    }
    this.committedIntervals = survivingIntervals;

    // Include active streak if it currently meets or exceeds minSegmentMs
    if (this.activeStreakStart !== null && this.activeStreakLastTime !== null) {
      const activeDuration = this.activeStreakLastTime - this.activeStreakStart;
      if (activeDuration >= this.minSegmentMs) {
        const effectiveStart = Math.max(windowStart, this.activeStreakStart);
        const effectiveEnd = Math.min(now, this.activeStreakLastTime);
        if (effectiveEnd > effectiveStart) {
          totalMs += effectiveEnd - effectiveStart;
        }
      }
    }

    return totalMs;
  }

  public getCumulativeVoicedSeconds(now: number): number {
    return this.getCumulativeVoicedMs(now) / 1000;
  }

  public hasReachedTarget(
    now: number,
    targetMs: number = MIC_QUALITY_CONFIG.REQUIRED_VOICED_DURATION_MS
  ): boolean {
    return this.getCumulativeVoicedMs(now) >= targetMs;
  }

  public reset(): void {
    this.activeStreakStart = null;
    this.activeStreakLastTime = null;
    this.committedIntervals = [];
  }
}

/**
 * Pure function to evaluate microphone quality against target criteria (§2.3).
 */
export function evaluateMicQuality(input: MicEvaluationInput): MicQualityReport {
  const config = input.config ?? MIC_QUALITY_CONFIG;
  const targetVoicedSeconds =
    input.targetVoicedSeconds ?? config.REQUIRED_VOICED_DURATION_MS / 1000;

  const currentRms = input.currentRms;
  const currentDb = rmsToDb(currentRms);
  const noiseFloorRms = input.noiseFloorRms;
  const noiseFloorDb = input.noiseFloorDb ?? rmsToDb(noiseFloorRms);
  const peakAmplitude = input.peakAmplitude ?? currentRms;
  const isClippingVal = isClipping(peakAmplitude, config.PEAK_CLIPPING_THRESHOLD);
  const snrDb = estimateSNR(currentRms, noiseFloorRms);

  const criteria: MicCriterionResult[] = [];

  // 1. Noise Floor Criterion
  const noiseFloorPassed =
    input.isNoiseFloorCalibrated &&
    noiseFloorRms <= config.MAX_ACCEPTABLE_NOISE_FLOOR_RMS;
  criteria.push({
    id: 'noise_floor',
    name: 'Ambient Noise Floor',
    passed: noiseFloorPassed,
    hint: !input.isNoiseFloorCalibrated
      ? config.HINTS.MEASURING_NOISE
      : !noiseFloorPassed
      ? config.HINTS.NOISE_TOO_HIGH
      : 'Ambient noise is low',
    value: noiseFloorDb,
  });

  // 2. Peak Clipping Criterion
  const clippingPassed = !isClippingVal;
  criteria.push({
    id: 'clipping',
    name: 'Audio Headroom / No Clipping',
    passed: clippingPassed,
    hint: clippingPassed ? 'No clipping detected' : config.HINTS.CLIPPING,
    value: peakAmplitude,
  });

  // 3. Speech Level Range (evaluated on active speech or during accumulation)
  const levelCheck = checkLevelRange(
    currentRms,
    config.MIN_AVERAGE_SPEECH_RMS,
    config.MAX_AVERAGE_SPEECH_RMS
  );
  // If user hasn't voiced yet or is silent between words, level_range shouldn't fail if already accumulated
  const levelPassed =
    input.cumulativeVoicedSeconds >= targetVoicedSeconds || levelCheck.healthy;
  criteria.push({
    id: 'level_range',
    name: 'Speech Level Range',
    passed: levelPassed,
    hint: levelCheck.healthy ? 'Good speech volume' : (levelCheck.hint ?? ''),
    value: currentDb,
  });

  // 4. SNR Criterion
  // SNR must be >= 12 dB for voiced speech
  const snrPassed =
    input.cumulativeVoicedSeconds >= targetVoicedSeconds ||
    (currentRms >= config.MIN_AVERAGE_SPEECH_RMS && snrDb >= config.MIN_SNR_DB);
  criteria.push({
    id: 'snr',
    name: 'Signal-to-Noise Ratio (SNR)',
    passed: snrPassed,
    hint: snrPassed ? `Clear voice (SNR ${snrDb.toFixed(1)} dB)` : config.HINTS.LOW_SNR,
    value: snrDb,
  });

  // 5. Cumulative Voiced Duration Criterion
  const voicedPassed = input.cumulativeVoicedSeconds >= targetVoicedSeconds;
  criteria.push({
    id: 'voiced_duration',
    name: 'Cumulative Voiced Speech',
    passed: voicedPassed,
    hint: voicedPassed
      ? `Voice evidence captured (${input.cumulativeVoicedSeconds.toFixed(1)}s)`
      : `Listening… keep speaking (${input.cumulativeVoicedSeconds.toFixed(1)} / ${targetVoicedSeconds.toFixed(1)} s)`,
    value: input.cumulativeVoicedSeconds,
  });

  // 6. Speech Recognition (Optional Bonus Proof)
  if (input.recognizedWordsCount !== undefined) {
    const sttPassed = input.recognizedWordsCount >= config.MIN_RECOGNIZED_WORDS;
    criteria.push({
      id: 'speech_recognition',
      name: 'Speech Recognition Proof',
      passed: sttPassed,
      isOptional: true,
      hint: sttPassed
        ? `Recognized ${input.recognizedWordsCount} words`
        : 'Spoken phrase verification (optional)',
      value: input.recognizedWordsCount,
    });
  }

  // Determine overall pass and primary failing hint
  const requiredCriteria = criteria.filter((c) => !c.isOptional);
  const failingCriterion = requiredCriteria.find((c) => !c.passed) || null;
  const overallPassed = failingCriterion === null;

  let primaryHint: string;
  if (!input.isNoiseFloorCalibrated) {
    primaryHint = config.HINTS.MEASURING_NOISE;
  } else if (!noiseFloorPassed) {
    primaryHint = config.HINTS.NOISE_TOO_HIGH;
  } else if (overallPassed) {
    primaryHint = config.HINTS.VERIFIED;
  } else if (input.cumulativeVoicedSeconds > 0 && input.cumulativeVoicedSeconds < targetVoicedSeconds) {
    primaryHint = `Listening… keep speaking (${input.cumulativeVoicedSeconds.toFixed(1)} / ${targetVoicedSeconds.toFixed(1)} s)`;
  } else if (failingCriterion?.id === 'clipping') {
    primaryHint = config.HINTS.CLIPPING;
  } else if (input.cumulativeVoicedSeconds === 0 && currentRms < config.MIN_AVERAGE_SPEECH_RMS) {
    primaryHint = config.HINTS.PROMPT_PHRASE;
  } else if (failingCriterion?.id === 'level_range' && levelCheck.reason === 'too_quiet') {
    primaryHint = config.HINTS.SPEAK_LOUDER;
  } else if (failingCriterion?.id === 'level_range' && levelCheck.reason === 'too_loud') {
    primaryHint = config.HINTS.TOO_LOUD;
  } else {
    primaryHint = config.HINTS.PROMPT_PHRASE;
  }

  return {
    overallPassed,
    criteria,
    failingCriterion,
    primaryHint,
    noiseFloorRms,
    noiseFloorDb,
    currentRms,
    currentDb,
    estimatedSnrDb: snrDb,
    voicedSeconds: input.cumulativeVoicedSeconds,
    targetVoicedSeconds,
    isClipping: isClippingVal,
  };
}
