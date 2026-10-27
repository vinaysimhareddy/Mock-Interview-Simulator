import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeRMS,
  computePeak,
  rmsToDb,
  dbToRms,
  estimateSNR,
  isClipping,
  checkLevelRange,
  NoiseFloorCalibrator,
  VoicedTimeAccumulator,
  evaluateMicQuality,
} from '../src/lib/micQuality';
import { MIC_QUALITY_CONFIG } from '../src/lib/micQualityConfig';
import {
  setupDevicesReducer,
  initialSetupDevicesState,
  SetupDevicesState,
} from '../src/hooks/useSetupDevices';

/**
 * Synthetic Audio Generators for unit testing
 */
function generateSyntheticSilence(
  durationMs: number,
  sampleRate = 16000,
  noiseAmplitude = 0.0001
): Float32Array {
  const numSamples = Math.floor((durationMs / 1000) * sampleRate);
  const buffer = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    buffer[i] = (Math.random() * 2 - 1) * noiseAmplitude;
  }
  return buffer;
}

function generateSyntheticTone(
  frequency: number,
  durationMs: number,
  sampleRate = 16000,
  amplitude = 0.3
): Float32Array {
  const numSamples = Math.floor((durationMs / 1000) * sampleRate);
  const buffer = new Float32Array(numSamples);
  const omega = (2 * Math.PI * frequency) / sampleRate;
  for (let i = 0; i < numSamples; i++) {
    buffer[i] = amplitude * Math.sin(omega * i);
  }
  return buffer;
}

function generateSyntheticNoise(
  durationMs: number,
  sampleRate = 16000,
  amplitude = 0.2
): Float32Array {
  const numSamples = Math.floor((durationMs / 1000) * sampleRate);
  const buffer = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    buffer[i] = (Math.random() * 2 - 1) * amplitude;
  }
  return buffer;
}

function generateSyntheticSpeechPattern(
  speechDurationMs = 1600,
  pauseDurationMs = 300,
  sampleRate = 16000,
  amplitude = 0.25
): Float32Array {
  const totalMs = speechDurationMs + pauseDurationMs;
  const numSamples = Math.floor((totalMs / 1000) * sampleRate);
  const speechSamples = Math.floor((speechDurationMs / 1000) * sampleRate);
  const buffer = new Float32Array(numSamples);

  const f1 = 300;
  const f2 = 1200;
  const f3 = 2400;

  for (let i = 0; i < speechSamples; i++) {
    const t = i / sampleRate;
    const sample =
      0.5 * Math.sin(2 * Math.PI * f1 * t) +
      0.3 * Math.sin(2 * Math.PI * f2 * t) +
      0.2 * Math.sin(2 * Math.PI * f3 * t);
    buffer[i] = sample * amplitude;
  }

  for (let i = speechSamples; i < numSamples; i++) {
    buffer[i] = (Math.random() * 2 - 1) * 0.002;
  }

  return buffer;
}

describe('Microphone Quality Engine (lib/micQuality.ts)', () => {
  describe('Pure Math & Audio Utilities', () => {
    it('computeRMS calculates root mean square correctly', () => {
      // Float32Array with constant value 0.5 -> RMS = 0.5
      const constFloat = new Float32Array([0.5, -0.5, 0.5, -0.5]);
      expect(computeRMS(constFloat)).toBeCloseTo(0.5, 4);

      // Uint8Array byte domain: 128 is 0, 255 is ~1.0, 0 is -1.0
      const constByte = new Uint8Array([128, 128, 128, 128]);
      expect(computeRMS(constByte)).toBeCloseTo(0, 4);

      const highByte = new Uint8Array([255, 1, 255, 1]);
      // (255-128)/128 ~ 0.992
      expect(computeRMS(highByte)).toBeGreaterThan(0.98);

      // Empty buffer
      expect(computeRMS(new Float32Array(0))).toBe(0);
    });

    it('computePeak calculates absolute peak correctly', () => {
      const buffer = new Float32Array([0.1, -0.75, 0.3, -0.2]);
      expect(computePeak(buffer)).toBeCloseTo(0.75, 4);

      const byteBuffer = new Uint8Array([128, 200, 10]);
      // |10-128|/128 = 118/128 ~ 0.9218
      expect(computePeak(byteBuffer)).toBeCloseTo(118 / 128, 3);
    });

    it('rmsToDb and dbToRms invert each other correctly', () => {
      const rms = 0.5;
      const db = rmsToDb(rms);
      expect(db).toBeCloseTo(-6.02, 1);
      expect(dbToRms(db)).toBeCloseTo(rms, 4);

      // Silence clamped to minDb
      expect(rmsToDb(0, -100)).toBe(-100);
      expect(rmsToDb(1e-7, -90)).toBe(-90);
    });

    it('estimateSNR computes correct signal to noise ratio in dB', () => {
      const speechRms = 0.2;
      const noiseRms = 0.02;
      // 20 * log10(10) = 20 dB
      expect(estimateSNR(speechRms, noiseRms)).toBeCloseTo(20.0, 1);
    });

    it('isClipping flags peaks at or above threshold', () => {
      expect(isClipping(0.97)).toBe(false);
      expect(isClipping(0.98)).toBe(true);
      expect(isClipping(1.0)).toBe(true);
    });

    it('checkLevelRange verifies healthy dynamic bounds', () => {
      // Too quiet (< 0.03)
      const quiet = checkLevelRange(0.01);
      expect(quiet.healthy).toBe(false);
      expect(quiet.reason).toBe('too_quiet');

      // Healthy (0.03 .. 0.85)
      const healthy = checkLevelRange(0.25);
      expect(healthy.healthy).toBe(true);

      // Too loud (> 0.85)
      const loud = checkLevelRange(0.92);
      expect(loud.healthy).toBe(false);
      expect(loud.reason).toBe('too_loud');
    });
  });

  describe('NoiseFloorCalibrator', () => {
    let calibrator: NoiseFloorCalibrator;

    beforeEach(() => {
      calibrator = new NoiseFloorCalibrator(1000, 0.08);
    });

    it('requires 1000 ms of samples before calibration is complete', () => {
      calibrator.addSample(0.005, 0);
      calibrator.addSample(0.005, 500);
      expect(calibrator.isCalibrated(500)).toBe(false);

      calibrator.addSample(0.006, 1000);
      expect(calibrator.isCalibrated(1000)).toBe(true);
      expect(calibrator.getAverageRms()).toBeCloseTo(0.00533, 4);
      expect(calibrator.isAcceptable()).toBe(true);
    });

    it('flags noisy ambient environment as unacceptable', () => {
      calibrator.addSample(0.12, 0);
      calibrator.addSample(0.14, 500);
      calibrator.addSample(0.13, 1000);
      expect(calibrator.isCalibrated(1000)).toBe(true);
      expect(calibrator.isAcceptable()).toBe(false); // > 0.08 RMS
    });
  });

  describe('VoicedTimeAccumulator', () => {
    let accumulator: VoicedTimeAccumulator;

    beforeEach(() => {
      // 150ms minimum streak, 6000ms window
      accumulator = new VoicedTimeAccumulator(150, 6000);
    });

    it('discards short transient blips < 150 ms', () => {
      // 80 ms click
      accumulator.update(100, true);
      accumulator.update(180, true);
      // streak ended before 150ms
      accumulator.update(190, false);

      expect(accumulator.getCumulativeVoicedMs(200)).toBe(0);
      expect(accumulator.getCumulativeVoicedSeconds(200)).toBe(0);
    });

    it('accumulates voiced segments that reach >= 150 ms', () => {
      // Run 1: 500ms voiced
      accumulator.update(0, true);
      accumulator.update(500, true);
      accumulator.update(510, false);
      expect(accumulator.getCumulativeVoicedMs(550)).toBe(500);

      // 200ms pause (unvoiced)
      accumulator.update(710, false);

      // Run 2: 1100ms voiced
      accumulator.update(800, true);
      accumulator.update(1900, true);
      accumulator.update(1910, false);

      // Total voiced: 500 + 1100 = 1600 ms >= 1.5s
      expect(accumulator.getCumulativeVoicedMs(2000)).toBe(1600);
      expect(accumulator.getCumulativeVoicedSeconds(2000)).toBeCloseTo(1.6, 2);
      expect(accumulator.hasReachedTarget(2000, 1500)).toBe(true);
    });

    it('prunes expired voiced intervals outside the 6.0s rolling window', () => {
      // Segment at t = 1000 to 2000 (1000 ms)
      accumulator.update(1000, true);
      accumulator.update(2000, true);
      accumulator.update(2010, false);
      expect(accumulator.getCumulativeVoicedMs(2500)).toBe(1000);

      // Advance time to t = 8500 (more than 6000ms after the first interval ended)
      // The interval ending at 2000 is older than 8500 - 6000 = 2500
      expect(accumulator.getCumulativeVoicedMs(8500)).toBe(0);
    });
  });

  describe('5 Required Synthetic Scenarios (§S4 Prompt)', () => {
    // 1. Silence (never verifies)
    it('Scenario 1: Silence never verifies', () => {
      const silenceBuffer = generateSyntheticSilence(3000, 16000, 0.0001);
      const rms = computeRMS(silenceBuffer);
      const peak = computePeak(silenceBuffer);
      expect(rms).toBeLessThan(0.001);

      const accumulator = new VoicedTimeAccumulator();
      const report = evaluateMicQuality({
        currentRms: rms,
        peakAmplitude: peak,
        noiseFloorRms: 0.0005,
        isNoiseFloorCalibrated: true,
        cumulativeVoicedSeconds: 0,
        targetVoicedSeconds: 1.5,
      });

      expect(report.overallPassed).toBe(false);
      expect(report.criteria.find((c) => c.id === 'voiced_duration')?.passed).toBe(false);
      expect(report.criteria.find((c) => c.id === 'level_range')?.passed).toBe(false);
      expect(report.primaryHint).toBe(MIC_QUALITY_CONFIG.HINTS.PROMPT_PHRASE);
    });

    // 2. Short Blip (never verifies)
    it('Scenario 2: A short blip (< 150ms) never verifies', () => {
      const blipBuffer = generateSyntheticTone(440, 100, 16000, 0.4); // 100ms
      const rms = computeRMS(blipBuffer);
      const peak = computePeak(blipBuffer);
      expect(rms).toBeGreaterThan(0.2);

      const accumulator = new VoicedTimeAccumulator(150, 6000);
      // Simulate blip start at 0, frame at 100, then silence at 110
      accumulator.update(0, true);
      accumulator.update(100, true);
      accumulator.update(110, false);

      const voicedMs = accumulator.getCumulativeVoicedMs(200);
      expect(voicedMs).toBe(0); // Discarded as a transient blip!

      const report = evaluateMicQuality({
        currentRms: 0.005, // Return to silence
        peakAmplitude: 0.005,
        noiseFloorRms: 0.004,
        isNoiseFloorCalibrated: true,
        cumulativeVoicedSeconds: voicedMs / 1000,
        targetVoicedSeconds: 1.5,
      });

      expect(report.overallPassed).toBe(false);
      expect(report.voicedSeconds).toBe(0);
    });

    // 3. Steady Noise (never verifies, "too noisy")
    it('Scenario 3: Steady high ambient noise never verifies ("Too noisy")', () => {
      const noiseBuffer = generateSyntheticNoise(2000, 16000, 0.25);
      const noiseRms = computeRMS(noiseBuffer);
      expect(noiseRms).toBeGreaterThan(0.1); // > 0.08 max allowable

      const calibrator = new NoiseFloorCalibrator();
      calibrator.addSample(noiseRms, 0);
      calibrator.addSample(noiseRms, 1000);
      expect(calibrator.isCalibrated(1000)).toBe(true);
      expect(calibrator.isAcceptable()).toBe(false);

      const report = evaluateMicQuality({
        currentRms: noiseRms,
        peakAmplitude: computePeak(noiseBuffer),
        noiseFloorRms: calibrator.getAverageRms(),
        isNoiseFloorCalibrated: true,
        cumulativeVoicedSeconds: 0,
        targetVoicedSeconds: 1.5,
      });

      expect(report.overallPassed).toBe(false);
      expect(report.failingCriterion?.id).toBe('noise_floor');
      expect(report.primaryHint).toBe(MIC_QUALITY_CONFIG.HINTS.NOISE_TOO_HIGH);
    });

    // 4. Clear Speech (verifies after >= 1.5 s)
    it('Scenario 4: Clear speech verifies after cumulative voiced time >= 1.5 s', () => {
      // Quiet background noise floor calibrated
      const noiseFloorRms = 0.004;

      // Voiced speech pattern: 1600 ms of multi-tone speech
      const speechBuffer = generateSyntheticSpeechPattern(1600, 200, 16000, 0.25);
      const speechRms = computeRMS(speechBuffer.slice(0, 1600 * 16));
      const peak = computePeak(speechBuffer.slice(0, 1600 * 16));

      expect(speechRms).toBeGreaterThan(0.08);
      expect(speechRms).toBeLessThan(0.4);
      expect(peak).toBeLessThan(0.98); // Not clipping

      const accumulator = new VoicedTimeAccumulator(150, 6000);
      accumulator.update(0, true);
      accumulator.update(800, true);
      accumulator.update(810, false); // 800ms streak

      accumulator.update(1000, true);
      accumulator.update(1800, true);
      accumulator.update(1810, false); // 800ms streak -> total 1600 ms

      const cumulativeSeconds = accumulator.getCumulativeVoicedSeconds(1850);
      expect(cumulativeSeconds).toBeGreaterThanOrEqual(1.5);

      const report = evaluateMicQuality({
        currentRms: speechRms,
        peakAmplitude: peak,
        noiseFloorRms,
        isNoiseFloorCalibrated: true,
        cumulativeVoicedSeconds: cumulativeSeconds,
        targetVoicedSeconds: 1.5,
      });

      expect(report.overallPassed).toBe(true);
      expect(report.failingCriterion).toBeNull();
      expect(report.estimatedSnrDb).toBeGreaterThanOrEqual(12.0);
      expect(report.primaryHint).toBe(MIC_QUALITY_CONFIG.HINTS.VERIFIED);
    });

    // 5. Post-Verify Level Drop (stays verified / latches)
    it('Scenario 5: Post-verify level drop stays verified in the state machine (latch)', () => {
      // 1. Initial idle
      let state: SetupDevicesState = initialSetupDevicesState;
      expect(state.mic.status).toBe('idle');

      // 2. Requesting & Measuring noise
      state = setupDevicesReducer(state, { type: 'MIC_REQUEST' });
      expect(state.mic.status).toBe('requesting');

      state = setupDevicesReducer(state, {
        type: 'MIC_MEASURING_NOISE',
        noiseFloorDb: -45,
      });
      expect(state.mic.status).toBe('measuring_noise');

      // 3. Collecting speech
      state = setupDevicesReducer(state, {
        type: 'MIC_COLLECTING_SPEECH',
        voicedSeconds: 1.0,
        targetSeconds: 1.5,
        snrDb: 25,
        level: 40,
        hint: 'Listening… keep speaking (1.0 / 1.5 s)',
      });
      expect(state.mic.status).toBe('collecting_speech');

      // 4. Verifies once speech reaches target
      state = setupDevicesReducer(state, {
        type: 'MIC_VERIFY',
        level: 45,
        snrDb: 28,
        noiseFloorDb: -45,
        voicedSeconds: 1.6,
      });
      expect(state.mic.status).toBe('verified');
      if (state.mic.status === 'verified') {
        expect(state.mic.snrDb).toBe(28);
        expect(state.mic.voicedSeconds).toBe(1.6);
      }

      // 5. Candidate stops speaking -> audio drops to zero (post-verify level drop)
      state = setupDevicesReducer(state, {
        type: 'MIC_STREAMING',
        level: 0,
        speechDetected: false,
      });

      // INVARIANT: State MUST stay 'verified', level updates for meter without leaving verified!
      expect(state.mic.status).toBe('verified');
      if (state.mic.status === 'verified') {
        expect(state.mic.level).toBe(0);
      }

      // Subsequent collection or noise actions are also ignored by the latch
      state = setupDevicesReducer(state, {
        type: 'MIC_COLLECTING_SPEECH',
        voicedSeconds: 0,
        targetSeconds: 1.5,
        level: 0,
      });
      expect(state.mic.status).toBe('verified');

      state = setupDevicesReducer(state, {
        type: 'MIC_MEASURING_NOISE',
        noiseFloorDb: -50,
      });
      expect(state.mic.status).toBe('verified');

      // 6. Only track ends / error / reset un-verifies
      state = setupDevicesReducer(state, {
        type: 'MIC_LOST',
        reason: 'Microphone unplugged',
      });
      expect(state.mic.status).toBe('error');
      if (state.mic.status === 'error') {
        expect(state.mic.error).toBe('Microphone unplugged');
      }
    });
  });

  describe('Optional Bonus Proofs & Edge Cases', () => {
    it('evaluates optional speech recognition proof when provided', () => {
      const report = evaluateMicQuality({
        currentRms: 0.15,
        noiseFloorRms: 0.005,
        isNoiseFloorCalibrated: true,
        cumulativeVoicedSeconds: 1.6,
        targetVoicedSeconds: 1.5,
        recognizedWordsCount: 4,
      });

      const sttCriterion = report.criteria.find((c) => c.id === 'speech_recognition');
      expect(sttCriterion).toBeDefined();
      expect(sttCriterion?.passed).toBe(true);
      expect(sttCriterion?.isOptional).toBe(true);
      expect(report.overallPassed).toBe(true);
    });

    it('flags clipping when peak exceeds threshold even if voiced time is met', () => {
      const report = evaluateMicQuality({
        currentRms: 0.88,
        peakAmplitude: 0.99, // Clipping
        noiseFloorRms: 0.005,
        isNoiseFloorCalibrated: true,
        cumulativeVoicedSeconds: 1.6,
        targetVoicedSeconds: 1.5,
      });

      expect(report.isClipping).toBe(true);
      expect(report.overallPassed).toBe(false);
      expect(report.failingCriterion?.id).toBe('clipping');
      expect(report.primaryHint).toBe(MIC_QUALITY_CONFIG.HINTS.CLIPPING);
    });
  });
});
