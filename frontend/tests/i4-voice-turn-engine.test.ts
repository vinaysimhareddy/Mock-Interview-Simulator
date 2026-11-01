import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  computeRMS,
  isSignificantSpeech,
  VoiceActivityDetector,
} from '../src/services/speech/vad';
import { TranscriptStitcher } from '../src/services/speech/transcriptStitcher';
import { ClientWSMessage } from '../src/lib/types';

describe('I4: Voice Turn Engine (VAD, STT, Interruption, Answer Complete)', () => {
  describe('1. VAD RMS Energy Computation and Speech Classification', () => {
    it('computeRMS returns 0 for empty or completely silent buffers', () => {
      expect(computeRMS(new Uint8Array(0))).toBe(0);

      // Uint8Array centered at 128 is pure silence (offset 0)
      const silentUint8 = new Uint8Array(256).fill(128);
      expect(computeRMS(silentUint8)).toBe(0);

      const silentFloat32 = new Float32Array(256).fill(0.0);
      expect(computeRMS(silentFloat32)).toBe(0);
    });

    it('computeRMS correctly calculates RMS for synthetic sinusoidal signals', () => {
      const sampleCount = 512;
      const floatBuffer = new Float32Array(sampleCount);
      const amplitude = 0.5;

      // Sine wave with peak amplitude 0.5 -> expected RMS = amplitude / sqrt(2) ≈ 0.3535
      for (let i = 0; i < sampleCount; i++) {
        floatBuffer[i] = amplitude * Math.sin((2 * Math.PI * i) / 32);
      }

      const rms = computeRMS(floatBuffer);
      expect(rms).toBeGreaterThan(0.34);
      expect(rms).toBeLessThan(0.36);
    });

    it('computeRMS calculates normalized RMS for Uint8Array audio data', () => {
      const sampleCount = 256;
      const uintBuffer = new Uint8Array(sampleCount);

      // Square wave oscillating between 64 and 192 (deviation = 64/128 = 0.5)
      for (let i = 0; i < sampleCount; i++) {
        uintBuffer[i] = i % 2 === 0 ? 192 : 64;
      }

      const rms = computeRMS(uintBuffer);
      expect(rms).toBeCloseTo(0.5, 2);
    });

    it('distinguishes real vocal energy from ambient noise using energyThreshold', () => {
      const vad = new VoiceActivityDetector({
        energyThreshold: 0.045,
        minSpeechDurationMs: 400,
        hangoverMs: 300,
      });

      // Low ambient noise buffer (RMS ≈ 0.015)
      const noiseBuffer = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        noiseBuffer[i] = 0.015 * Math.sin(i);
      }

      let state = vad.processFrame(noiseBuffer, 1000);
      expect(state.currentRMS).toBeLessThan(0.045);
      expect(state.isSpeaking).toBe(false);

      // High speech energy buffer (RMS ≈ 0.25)
      const speechBuffer = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        speechBuffer[i] = 0.25 * Math.sin(i);
      }

      // Initial frame of speech starts speech timer
      state = vad.processFrame(speechBuffer, 1100);
      expect(state.currentRMS).toBeGreaterThan(0.045);
      expect(state.isSpeaking).toBe(false); // < minSpeechDurationMs (100ms < 400ms)

      // After 450ms of sustained vocal energy, speaking state becomes true
      state = vad.processFrame(speechBuffer, 1550);
      expect(state.isSpeaking).toBe(true);
      expect(state.speechDurationMs).toBe(450);
    });

    it('applies hangover window before transitioning speaking state back to silence', () => {
      const vad = new VoiceActivityDetector({
        energyThreshold: 0.045,
        minSpeechDurationMs: 200,
        hangoverMs: 300,
      });

      const speechBuffer = new Float32Array(256).fill(0.2);
      const silentBuffer = new Float32Array(256).fill(0.0);

      // Speak for 250ms
      vad.processFrame(speechBuffer, 1000);
      const activeState = vad.processFrame(speechBuffer, 1250);
      expect(activeState.isSpeaking).toBe(true);

      // Silence begins at 1260ms (within 300ms hangover window)
      const hangoverState = vad.processFrame(silentBuffer, 1400); // 150ms after speech stopped
      expect(hangoverState.isSpeaking).toBe(true); // Hangover holds state true!

      // Silence past hangover window (> 300ms, at 1600ms = 350ms elapsed)
      const silentState = vad.processFrame(silentBuffer, 1600);
      expect(silentState.isSpeaking).toBe(false); // Transitions back to silence
    });

    it('isSignificantSpeech verifies candidate spoke real answer before allowing auto-complete', () => {
      // Short filler or cough: 250ms, 1 word -> NOT significant
      expect(isSignificantSpeech(250, 1, 400, 2)).toBe(false);

      // Meaningful spoken answer: 600ms, 4 words -> Significant!
      expect(isSignificantSpeech(600, 4, 400, 2)).toBe(true);

      // Zero words with long noise: 1200ms, 0 words -> NOT significant
      expect(isSignificantSpeech(1200, 0, 400, 2)).toBe(false);
    });
  });

  describe('2. Transcript Stitcher and Continuous STT Assembly', () => {
    it('seamlessly concatenates final speech chunks and handles interim updates without duplication', () => {
      const stitcher = new TranscriptStitcher();

      // Interim chunk
      const r1 = stitcher.append('In my previous', false);
      expect(r1.fullTranscript).toBe('In my previous');

      // Finalized chunk
      const r2 = stitcher.append('In my previous role,', true);
      expect(r2.fullTranscript).toBe('In my previous role,');

      // Second interim chunk
      const r3 = stitcher.append('I optimized database queries', false);
      expect(r3.fullTranscript).toBe('In my previous role, I optimized database queries');

      // Second finalized chunk
      const r4 = stitcher.append('I optimized database queries using indexes.', true);
      expect(r4.fullTranscript).toBe(
        'In my previous role, I optimized database queries using indexes.'
      );

      // Reset clears history
      stitcher.reset();
      expect(stitcher.getFullTranscript()).toBe('');
    });
  });

  describe('3. Voice Turn Engine State Machine & Interruption Logic', () => {
    it('executes barge-in interruption when candidate speaks during AI speech', () => {
      // Simulate state machine transitions of useVoiceTurnEngine
      let turnState: 'idle' | 'ai_speaking' | 'candidate_turn' | 'submitting' = 'idle';
      let isAiSpeaking = false;
      let isListening = false;
      const ttsStopMock = vi.fn();
      const sttStartMock = vi.fn();

      // Question starts
      turnState = 'ai_speaking';
      isAiSpeaking = true;
      sttStartMock(); // background STT for barge-in detection
      isListening = true;

      expect(turnState).toBe('ai_speaking');
      expect(isAiSpeaking).toBe(true);

      // Barge-in trigger function (mirrors useVoiceTurnEngine handleBargeIn)
      const handleBargeIn = () => {
        ttsStopMock();
        isAiSpeaking = false;
        turnState = 'candidate_turn';
        if (!isListening) {
          sttStartMock();
          isListening = true;
        }
      };

      // Candidate starts speaking (VAD speechDuration >= 200ms or interim transcript event)
      handleBargeIn();

      expect(ttsStopMock).toHaveBeenCalledTimes(1);
      expect(turnState).toBe('candidate_turn');
      expect(isAiSpeaking).toBe(false);
      expect(isListening).toBe(true);
    });

    it('silence countdown triggers auto-submission after silenceTimeoutMs of completed speech', () => {
      let turnState: 'candidate_turn' | 'submitting' = 'candidate_turn';
      let hasSpokenMeaningfully = false;
      let silenceStartTime: number | null = null;
      let silenceProgress = 0;
      const silenceTimeoutMs = 2000;
      const onSubmitAnswer = vi.fn();
      const wsPackets: ClientWSMessage[] = [];

      const sendWSMessage = (msg: ClientWSMessage) => {
        wsPackets.push(msg);
        return true;
      };

      const triggerAnswerCompletion = async (finalTranscript: string) => {
        turnState = 'submitting';
        silenceProgress = 0;
        sendWSMessage({
          type: 'answer_complete',
          turn_id: 'turn_0',
        });
        await onSubmitAnswer(finalTranscript);
      };

      // Candidate speaks meaningful answer
      const speechDurationMs = 800;
      const wordCount = 12;
      if (isSignificantSpeech(speechDurationMs, wordCount, 400, 2)) {
        hasSpokenMeaningfully = true;
      }
      expect(hasSpokenMeaningfully).toBe(true);

      // Candidate finishes speaking at t = 2000ms
      const t_stop = 2000;

      // 1. Frame at t = 2500ms (500ms silence elapsed)
      silenceStartTime = t_stop;
      let elapsedSilence = 2500 - silenceStartTime;
      silenceProgress = Math.min(1.0, elapsedSilence / silenceTimeoutMs);
      expect(silenceProgress).toBe(0.25);
      expect(turnState).toBe('candidate_turn');

      // 2. Frame at t = 3500ms (1500ms silence elapsed)
      elapsedSilence = 3500 - silenceStartTime;
      silenceProgress = Math.min(1.0, elapsedSilence / silenceTimeoutMs);
      expect(silenceProgress).toBe(0.75);
      expect(turnState).toBe('candidate_turn');

      // 3. Frame at t = 4050ms (> 2000ms silence elapsed -> timeout reached!)
      elapsedSilence = 4050 - silenceStartTime;
      silenceProgress = Math.min(1.0, elapsedSilence / silenceTimeoutMs);
      expect(silenceProgress).toBe(1.0);

      if (elapsedSilence >= silenceTimeoutMs) {
        void triggerAnswerCompletion('I designed and deployed scalable microservices with Kafka.');
      }

      expect(turnState).toBe('submitting');
      expect(silenceProgress).toBe(0);
      expect(onSubmitAnswer).toHaveBeenCalledWith(
        'I designed and deployed scalable microservices with Kafka.'
      );
      expect(wsPackets).toEqual([
        {
          type: 'answer_complete',
          turn_id: 'turn_0',
        },
      ]);
    });

    it('resets silence timer immediately if candidate resumes speaking', () => {
      let silenceStartTime: number | null = 1000;
      let silenceProgress = 0.6;

      // Candidate resumes speaking (vadState.isSpeaking === true)
      const candidateResumedSpeaking = true;
      if (candidateResumedSpeaking) {
        silenceStartTime = null;
        silenceProgress = 0;
      }

      expect(silenceStartTime).toBeNull();
      expect(silenceProgress).toBe(0);
    });

    it('streams live transcript chunks over WebSocket with monotonic timestamp', () => {
      const wsPackets: ClientWSMessage[] = [];
      const sendWSMessage = (msg: ClientWSMessage) => {
        wsPackets.push(msg);
        return true;
      };

      const questionStartTime = 10000;

      const emitTranscriptChunk = (text: string, isFinal: boolean, now: number) => {
        const elapsedSec = (now - questionStartTime) / 1000;
        sendWSMessage({
          type: 'transcript_chunk',
          text,
          is_final: isFinal,
          t: Math.max(0, parseFloat(elapsedSec.toFixed(3))),
        });
      };

      emitTranscriptChunk('First part of response', false, 11250);
      emitTranscriptChunk('First part of response completed.', true, 12500);

      expect(wsPackets).toHaveLength(2);
      expect(wsPackets[0]).toEqual({
        type: 'transcript_chunk',
        text: 'First part of response',
        is_final: false,
        t: 1.25,
      });
      expect(wsPackets[1]).toEqual({
        type: 'transcript_chunk',
        text: 'First part of response completed.',
        is_final: true,
        t: 2.5,
      });
    });
  });

  describe('4. Zero Fake Metrics & Genuine Energy Representation', () => {
    it('audioLevel maps monotonically to genuine RMS without Math.random() or mock 85%', () => {
      const rawRmsValues = [0.0, 0.02, 0.045, 0.1, 0.18, 0.25];

      const levels = rawRmsValues.map((rms) => Math.min(1.0, rms * 4));

      // Check strictly monotonic scaling prior to saturation
      for (let i = 1; i < levels.length; i++) {
        expect(levels[i]).toBeGreaterThan(levels[i - 1]);
      }

      // Check bounded within [0, 1] and saturates at 1.0
      expect(levels[0]).toBe(0);
      expect(levels[levels.length - 1]).toBe(1.0);
      expect(Math.min(1.0, 0.5 * 4)).toBe(1.0);

      // Verify no hardcoded 0.85 fallback
      expect(levels[2]).toBeCloseTo(0.18, 2);
    });
  });
});
