/**
 * micQualityConfig.ts
 *
 * Configurable thresholds and tuning constants for microphone quality checking (§2.3).
 */

export const MIC_QUALITY_CONFIG = {
  // 1. Noise Floor Calibration
  NOISE_FLOOR_DURATION_MS: 1000, // 1.0 s of silence at start to calibrate
  MAX_ACCEPTABLE_NOISE_FLOOR_RMS: 0.08, // Maximum allowable ambient noise floor RMS
  MAX_ACCEPTABLE_NOISE_FLOOR_DB: -22.0, // Maximum allowable ambient noise floor in dBFS

  // 2. Voiced Speech Detection
  VOICED_DELTA_DB: 10.0, // Voiced speech segment = RMS >= noise floor + 10 dB
  MIN_VOICED_SEGMENT_MS: 150, // Segments < 150 ms discarded as transient noise blips
  REQUIRED_VOICED_DURATION_MS: 1500, // Cumulative voiced speech required: 1.5 s
  SLIDING_WINDOW_MS: 6000, // Evaluated within a 6.0 s rolling window

  // 3. Audio Level & Clipping
  PEAK_CLIPPING_THRESHOLD: 0.98, // Peak must be < 0.98 full scale (not clipping)
  MIN_AVERAGE_SPEECH_RMS: 0.03, // Healthy lower bound (~ -30.5 dBFS)
  MAX_AVERAGE_SPEECH_RMS: 0.85, // Healthy upper bound (~ -1.4 dBFS)

  // 4. Signal-to-Noise Ratio (SNR)
  MIN_SNR_DB: 12.0, // Estimated SNR >= 12 dB

  // 5. Speech Recognition (Optional bonus proof)
  MIN_RECOGNIZED_WORDS: 3,

  // 6. UI Text & Hints
  HINTS: {
    MEASURING_NOISE: 'Measuring background noise, please stay quiet...',
    NOISE_TOO_HIGH: 'Too noisy: find a quieter place',
    PROMPT_PHRASE: "Say: 'My name is ___ and I'm ready for the interview'",
    SPEAK_LOUDER: 'Speak louder / move closer',
    TOO_LOUD: 'Too loud: move microphone away or speak softer',
    LOW_SNR: 'Voice unclear: speak louder or reduce background noise',
    CLIPPING: 'Audio clipping detected: lower input volume or speak softer',
    VERIFIED: '✓ Microphone verified',
  },
} as const;

export type MicQualityConfig = typeof MIC_QUALITY_CONFIG;
