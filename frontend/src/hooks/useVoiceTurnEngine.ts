import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserSpeechToText } from '../services/speech/browserSTT';
import { BrowserTextToSpeech } from '../services/speech/browserTTS';
import { isSignificantSpeech, VoiceActivityDetector } from '../services/speech/vad';
import { mapSpeechRecognitionError, SpeechErrorInfo } from '../services/speech/speechErrors';
import { ClientWSMessage } from '../lib/types';

export type VoiceTurnState =
  | 'idle'
  | 'ai_speaking'
  | 'candidate_turn'
  | 'submitting'
  | 'paused';

export interface UseVoiceTurnEngineOptions {
  audioStream: MediaStream | null;
  currentQuestion: string;
  questionIndex: number;
  isPaused?: boolean;
  sendWSMessage?: (message: ClientWSMessage) => boolean;
  onSubmitAnswer: (answer: string) => Promise<void>;
  autoPlayTTS?: boolean;
  silenceTimeoutMs?: number;      // Silence window after speech to trigger auto-complete (default: 2000ms)
  minSpeechDurationMs?: number;   // Minimum speech duration to qualify as spoken answer (default: 400ms)
  energyThreshold?: number;       // RMS energy threshold for VAD (default: 0.045)
}

export interface UseVoiceTurnEngineReturn {
  turnState: VoiceTurnState;
  isAiSpeaking: boolean;
  isCandidateSpeaking: boolean;
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  audioLevel: number;             // 0..1 normalized RMS for UI visualizer
  silenceProgress: number;        // 0..1 countdown progress toward auto-submission
  isSpeechSupported: boolean;
  speakQuestion: () => Promise<void>;
  stopAudio: () => void;
  interruptAI: () => void;
  submitAnswer: () => Promise<void>;
  clearTranscript: () => void;
  setTranscript: (text: string) => void;
  toggleDictation: () => void;
  sttError?: SpeechErrorInfo | null;
  clearSttError?: () => void;
}

export function useVoiceTurnEngine({
  audioStream,
  currentQuestion,
  questionIndex,
  isPaused = false,
  sendWSMessage,
  onSubmitAnswer,
  autoPlayTTS = true,
  silenceTimeoutMs = 2000,
  minSpeechDurationMs = 400,
  energyThreshold = 0.045,
}: UseVoiceTurnEngineOptions): UseVoiceTurnEngineReturn {
  const [turnState, setTurnState] = useState<VoiceTurnState>('idle');
  const [isAiSpeaking, setIsAiSpeaking] = useState<boolean>(false);
  const [isCandidateSpeaking, setIsCandidateSpeaking] = useState<boolean>(false);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [transcript, setTranscriptState] = useState<string>('');
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [silenceProgress, setSilenceProgress] = useState<number>(0);
  const [sttError, setSttError] = useState<SpeechErrorInfo | null>(null);

  // References for services and lifecycle
  const ttsRef = useRef<BrowserTextToSpeech | null>(null);
  const sttRef = useRef<BrowserSpeechToText | null>(null);
  const vadRef = useRef<VoiceActivityDetector | null>(null);

  // Web Audio API refs for VAD
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animFrameIdRef = useRef<number | null>(null);

  // State machine tracking refs
  const turnStateRef = useRef<VoiceTurnState>('idle');
  turnStateRef.current = turnState;

  const transcriptRef = useRef<string>('');
  transcriptRef.current = transcript;

  const hasSpokenMeaningfullyRef = useRef<boolean>(false);
  const silenceStartTimeRef = useRef<number | null>(null);
  const isSubmittingRef = useRef<boolean>(false);
  const currentQuestionRef = useRef<string>('');
  const questionStartTimeRef = useRef<number>(Date.now());

  // Check browser speech capabilities
  const isSpeechSupported =
    typeof window !== 'undefined' &&
    Boolean(window.SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);

  // 1. Initialize STT, TTS, and VAD instances
  useEffect(() => {
    ttsRef.current = new BrowserTextToSpeech();
    sttRef.current = new BrowserSpeechToText();
    vadRef.current = new VoiceActivityDetector({
      energyThreshold,
      minSpeechDurationMs,
      hangoverMs: 300,
    });

    const unsubscribeSTT = sttRef.current.onTranscript((event) => {
      // If AI is speaking and candidate starts speaking, trigger barge-in interruption!
      if (turnStateRef.current === 'ai_speaking' && event.text.trim().length > 0) {
        handleBargeIn();
      }

      if (event.isFinal) {
        setTranscriptState(event.fullTranscript);
        setInterimTranscript('');
        transcriptRef.current = event.fullTranscript;
      } else {
        setInterimTranscript(event.text);
      }

      // Stream transcript chunk to server over WebSocket (§4.2)
      if (sendWSMessage && event.text.trim()) {
        const elapsedSec = (Date.now() - questionStartTimeRef.current) / 1000;
        sendWSMessage({
          type: 'transcript_chunk',
          text: event.text.trim(),
          is_final: event.isFinal,
          t: Math.max(0, parseFloat(elapsedSec.toFixed(3))),
        });
      }
    });

    const unsubscribeState = sttRef.current.onStateChange((state) => {
      setIsListening(state === 'listening');
    });

    const unsubscribeError = sttRef.current.onError((err) => {
      if (
        err.isFatal ||
        err.error === 'network' ||
        err.error === 'audio-capture' ||
        err.error === 'service-not-allowed'
      ) {
        setSttError(mapSpeechRecognitionError(err.error));
      }
    });

    return () => {
      unsubscribeSTT();
      unsubscribeState();
      unsubscribeError();
      if (ttsRef.current) ttsRef.current.stop();
      if (sttRef.current) sttRef.current.stop();
    };
  }, [sendWSMessage, energyThreshold, minSpeechDurationMs]);

  // 2. Set up Web Audio AnalyserNode for shared audioStream VAD
  useEffect(() => {
    if (!audioStream || !audioStream.active || audioStream.getAudioTracks().length === 0) {
      return;
    }

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.2;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(audioStream);
      source.connect(analyser);
      sourceNodeRef.current = source;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const processAudio = () => {
        if (!analyserRef.current || isPaused) {
          animFrameIdRef.current = requestAnimationFrame(processAudio);
          return;
        }

        analyserRef.current.getByteTimeDomainData(dataArray);
        const now = performance.now();

        if (vadRef.current) {
          const vadState = vadRef.current.processFrame(dataArray, now);
          const normalizedRms = Math.min(1.0, vadState.currentRMS * 4);
          setAudioLevel(normalizedRms);
          setIsCandidateSpeaking(vadState.isSpeaking);

          // 2a. Interruption Check: Candidate speaking while AI is speaking
          if (turnStateRef.current === 'ai_speaking') {
            if (vadState.speechDurationMs >= 200 && vadState.currentRMS >= energyThreshold) {
              handleBargeIn();
            }
          }

          // 2b. Turn-taking & Silence Detection during candidate_turn
          if (turnStateRef.current === 'candidate_turn') {
            const currentWords = transcriptRef.current.trim().split(/\s+/).filter(Boolean).length;
            if (isSignificantSpeech(vadState.speechDurationMs, currentWords, minSpeechDurationMs, 2)) {
              hasSpokenMeaningfullyRef.current = true;
            }

            if (hasSpokenMeaningfullyRef.current) {
              if (!vadState.isSpeaking) {
                // Candidate is silent after having spoken
                if (!silenceStartTimeRef.current) {
                  silenceStartTimeRef.current = now;
                }
                const elapsedSilence = now - silenceStartTimeRef.current;
                const progress = Math.min(1.0, elapsedSilence / silenceTimeoutMs);
                setSilenceProgress(progress);

                if (elapsedSilence >= silenceTimeoutMs && !isSubmittingRef.current) {
                  // Silence timeout reached -> automatically complete answer
                  void triggerAnswerCompletion();
                }
              } else {
                // Candidate resumed speaking -> reset silence timer
                silenceStartTimeRef.current = null;
                setSilenceProgress(0);
              }
            }
          }
        }

        animFrameIdRef.current = requestAnimationFrame(processAudio);
      };

      animFrameIdRef.current = requestAnimationFrame(processAudio);
    } catch (err) {
      console.warn('Web Audio VAD setup warning:', err);
    }

    return () => {
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
      if (sourceNodeRef.current) {
        sourceNodeRef.current.disconnect();
        sourceNodeRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
    };
  }, [audioStream, isPaused, energyThreshold, minSpeechDurationMs, silenceTimeoutMs]);

  // 3. Handle Candidate Interruption (Barge-in)
  const handleBargeIn = useCallback(() => {
    if (ttsRef.current) {
      ttsRef.current.stop();
    }
    setIsAiSpeaking(false);
    setTurnState('candidate_turn');

    // Ensure STT is listening
    if (sttRef.current && !sttRef.current.isListening) {
      try {
        sttRef.current.start();
      } catch {}
    }
  }, []);

  // 4. Trigger Answer Completion & Submission
  const triggerAnswerCompletion = useCallback(async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    // Stop STT and VAD tracking
    if (sttRef.current) {
      sttRef.current.stop();
    }
    setTurnState('submitting');
    setSilenceProgress(0);

    // Notify backend WebSocket that answer is complete
    if (sendWSMessage) {
      sendWSMessage({
        type: 'answer_complete',
        turn_id: `turn_${questionIndex}`,
      });
    }

    const finalAnswer = transcriptRef.current.trim();
    try {
      await onSubmitAnswer(finalAnswer);
    } finally {
      isSubmittingRef.current = false;
    }
  }, [sendWSMessage, questionIndex, onSubmitAnswer]);

  // 5. Speak Question via TTS
  const speakQuestion = useCallback(async () => {
    if (!currentQuestion.trim() || isPaused) return;

    // Reset turn state for new question
    if (sttRef.current) {
      sttRef.current.stop();
      sttRef.current.resetTranscript();
    }
    if (vadRef.current) {
      vadRef.current.reset();
    }
    setTranscriptState('');
    setInterimTranscript('');
    transcriptRef.current = '';
    hasSpokenMeaningfullyRef.current = false;
    silenceStartTimeRef.current = null;
    setSilenceProgress(0);
    questionStartTimeRef.current = Date.now();

    setTurnState('ai_speaking');
    setIsAiSpeaking(true);

    // Start background STT to enable voice barge-in interruption while AI speaks
    if (sttRef.current && sttRef.current.isSupported) {
      try {
        sttRef.current.start();
      } catch {}
    }

    try {
      if (ttsRef.current) {
        await ttsRef.current.speak(currentQuestion);
      }
    } finally {
      setIsAiSpeaking(false);
      // If candidate hasn't already interrupted and taken turn, hand over to candidate
      if (turnStateRef.current === 'ai_speaking') {
        setTurnState('candidate_turn');
        if (sttRef.current && !sttRef.current.isListening) {
          try {
            sttRef.current.start();
          } catch {}
        }
      }
    }
  }, [currentQuestion, isPaused]);

  // 6. Stop all audio playback
  const stopAudio = useCallback(() => {
    if (ttsRef.current) {
      ttsRef.current.stop();
    }
    setIsAiSpeaking(false);
  }, []);

  // 7. Manual Dictation Toggle
  const toggleDictation = useCallback(() => {
    if (!sttRef.current) return;
    if (sttRef.current.isListening) {
      sttRef.current.stop();
    } else {
      stopAudio();
      setTurnState('candidate_turn');
      sttRef.current.start();
    }
  }, [stopAudio]);

  // 8. Auto-speak when question text changes
  useEffect(() => {
    if (currentQuestion && currentQuestion !== currentQuestionRef.current) {
      currentQuestionRef.current = currentQuestion;
      if (autoPlayTTS && !isPaused) {
        void speakQuestion();
      } else {
        setTurnState('candidate_turn');
        if (sttRef.current) {
          sttRef.current.resetTranscript();
          try {
            sttRef.current.start();
          } catch {}
        }
      }
    }
  }, [currentQuestion, autoPlayTTS, isPaused, speakQuestion]);

  // 9. Pause handling: silence TTS & STT when room is paused
  useEffect(() => {
    if (isPaused) {
      if (ttsRef.current) ttsRef.current.stop();
      if (sttRef.current) sttRef.current.stop();
      setIsAiSpeaking(false);
      setIsListening(false);
      setTurnState('paused');
    } else if (turnStateRef.current === 'paused') {
      setTurnState('candidate_turn');
      if (sttRef.current) {
        try {
          sttRef.current.start();
        } catch {}
      }
    }
  }, [isPaused]);

  return {
    turnState,
    isAiSpeaking,
    isCandidateSpeaking,
    isListening,
    transcript,
    interimTranscript,
    audioLevel,
    silenceProgress,
    isSpeechSupported,
    speakQuestion,
    stopAudio,
    interruptAI: handleBargeIn,
    submitAnswer: triggerAnswerCompletion,
    clearTranscript: () => {
      setTranscriptState('');
      setInterimTranscript('');
      transcriptRef.current = '';
      if (sttRef.current) sttRef.current.resetTranscript();
    },
    setTranscript: (text: string) => {
      setTranscriptState(text);
      transcriptRef.current = text;
    },
    toggleDictation,
    sttError,
    clearSttError: () => setSttError(null),
  };
}
