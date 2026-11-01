import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Mic,
  Video,
  Pause,
  Play,
  HelpCircle,
  Subtitles,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  X,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Smile,
  Eye,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MetricsHUD } from './MetricsHUD';
import { CameraLostModal } from './CameraLostModal';
import { FaceLostModal } from './FaceLostModal';
import { HelpDrawer } from './HelpDrawer';
import { InterviewTopBar } from './InterviewTopBar';
import { InterviewerOrb, OrbState } from './InterviewerOrb';
import { QuestionCaption } from './QuestionCaption';
import { CandidateAnswerTranscript } from './CandidateAnswerTranscript';
import { InterviewComplete } from './InterviewComplete';
import { InterviewAborted } from './InterviewAborted';
import { ExecutiveScorecard } from './ExecutiveScorecard';
import { useWebSocketInterview } from '@/hooks/useWebSocketInterview';
import { useMediaStream } from '@/context/CameraStreamContext';
import { useMediaPipeVision } from '@/hooks/useMediaPipeVision';
import { useVoiceTurnEngine } from '@/hooks/useVoiceTurnEngine';
import { TelemetrySample, ServerWSMessage, FinalReport } from '@/lib/types';
import { ChallengeActionType, LivenessChallengeStep } from '@/lib/integrityTypes';
import { apiClient, ApiError } from '@/lib/api';
import { SessionData } from './InterviewConfigurator';

interface QuestionEvaluation {
  score: number;
  technical_accuracy: number;
  clarity: number;
  completeness: number;
  feedback: string;
  encouragement?: string;
}

interface InterviewStepResponse {
  session_id: string;
  status: string;
  current_question_index: number;
  max_questions: number;
  evaluation?: QuestionEvaluation;
  next_question?: string;
  difficulty: string;
  difficulty_change?: 'UPGRADE' | 'DOWNGRADE' | 'UNCHANGED';
  final_report?: FinalReport;
}

export type RoomPhase = 'live' | 'wrapping_up' | 'complete' | 'scorecard' | 'aborted';

export interface InterviewRoomProps {
  session: SessionData;
  token: string;
  durationMinutes?: number;
  initialQuestion?: string;
  initialPhase?: RoomPhase;
  initialReport?: FinalReport;
  onExit: () => void;
  onOpenHelp?: () => void;
}

export function InterviewRoom({
  session,
  token,
  durationMinutes = 15,
  initialQuestion,
  initialPhase,
  initialReport,
  onExit,
  onOpenHelp,
}: InterviewRoomProps): React.ReactElement {
  const [roomPhase, setRoomPhase] = useState<RoomPhase>(
    initialPhase || (initialReport ? 'complete' : 'live')
  );
  const [abortReason, setAbortReason] = useState<string>('user_ended');
  const [isGeneratingReport, setIsGeneratingReport] = useState<boolean>(false);

  // Query parameter developer flag (?debug=1)
  const isDebugMode = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('debug') === '1';
  }, []);

  // Candidate Captions & Transcript flag (defaults to ON for accessible live speech feedback §Q6)
  const [showCandidateCaptions, setShowCandidateCaptions] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem('SHOW_CANDIDATE_CAPTIONS');
    if (stored !== null) return stored === 'true';
    return true; // Default to ON so candidate sees live transcript without having to discover toggle (§Q6)
  });

  // User pause state
  const [isUserPaused, setIsUserPaused] = useState<boolean>(false);

  // Help Drawer state (§3.4)
  const [isHelpDrawerOpen, setIsHelpDrawerOpen] = useState<boolean>(false);

  // Face absence monitoring state (§3.5)
  const [faceMissingSeconds, setFaceMissingSeconds] = useState<number>(0);
  const [isFaceLostModalOpen, setIsFaceLostModalOpen] = useState<boolean>(false);
  const [hasRepeatedCurrentQuestion, setHasRepeatedCurrentQuestion] = useState<boolean>(false);

  // Time budget countdown
  const [remainingSeconds, setRemainingSeconds] = useState<number>(durationMinutes * 60);

  // Camera integrity & recovery states
  const [isCameraLostModalOpen, setIsCameraLostModalOpen] = useState<boolean>(false);
  const [cameraLostReason, setCameraLostReason] = useState<string>(
    'Camera feed disconnected or obstructed.'
  );
  const [cameraLostGraceSec, setCameraLostGraceSec] = useState<number>(30);
  const [isPausedByIntegrity, setIsPausedByIntegrity] = useState<boolean>(false);

  // Shared MediaStream from provider (Invariant 5)
  const { videoStream, activeCameraLabel, audioStream, stopAll } = useMediaStream();
  const [showSelfView, setShowSelfView] = useState<boolean>(false);
  const selfViewVideoRef = useRef<HTMLVideoElement>(null);
  const [_latestTelemetry, setLatestTelemetry] = useState<TelemetrySample | null>(null);

  // Ref to hold trigger for active liveness challenge
  const challengeTriggerRef = useRef<
    ((stepsOrCount?: number | LivenessChallengeStep | LivenessChallengeStep[]) => void) | null
  >(null);

  // Active liveness challenge modal state
  const [activeChallengeStep, setActiveChallengeStep] = useState<LivenessChallengeStep | null>(null);
  const [challengeRemainingSec, setChallengeRemainingSec] = useState<number>(8.0);
  const [challengeNotification, setChallengeNotification] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const challengeVideoRef = useRef<HTMLVideoElement>(null);

  // Question & Session progression states
  const [currentQuestion, setCurrentQuestion] = useState<string>(initialQuestion || '');
  const [questionIndex, setQuestionIndex] = useState<number>(1);
  const [_maxQuestions, setMaxQuestions] = useState<number>(5);
  const [_currentDifficulty, setCurrentDifficulty] = useState<string>(session.difficulty);
  const [_lastDifficultyChange, setLastDifficultyChange] = useState<string | null>(null);
  const [_lastEvaluation, setLastEvaluation] = useState<QuestionEvaluation | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [finalReport, setFinalReport] = useState<FinalReport | null>(initialReport || null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);

  // 15s no-speech countdown state (shown in final 5s only)
  const [noSpeechRemaining, setNoSpeechRemaining] = useState<number | null>(null);

  // Handle incoming WebSocket messages
  const handleWSMessage = useCallback((message: ServerWSMessage) => {
    if (message.type === 'pause_integrity') {
      setIsCameraLostModalOpen(true);
      setCameraLostReason(message.reason || 'Camera feed disconnected or obstructed.');
      if (message.grace_seconds !== undefined) {
        setCameraLostGraceSec(message.grace_seconds);
      }
      setIsPausedByIntegrity(true);
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(
          message.voice_prompt || 'Camera lost, please restore it'
        );
        utterance.rate = 1.0;
        window.speechSynthesis.speak(utterance);
      }
    } else if (message.type === 'resume_integrity') {
      setIsCameraLostModalOpen(false);
      setIsPausedByIntegrity(false);
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance('Camera feed restored. Resuming interview.');
        utterance.rate = 1.0;
        window.speechSynthesis.speak(utterance);
      }
    } else if (message.type === 'challenge') {
      const step: LivenessChallengeStep = {
        id: message.challenge_id,
        action: message.action as ChallengeActionType,
        prompt: message.prompt,
        nonce: message.nonce,
        timeoutMs: (message.timeout_sec ?? 8.0) * 1000,
      };
      setActiveChallengeStep(step);
      setChallengeRemainingSec(message.timeout_sec ?? 8.0);
      setChallengeNotification(null);

      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(message.prompt);
        utterance.rate = 1.0;
        window.speechSynthesis.speak(utterance);
      }
      if (challengeTriggerRef.current) {
        challengeTriggerRef.current(step);
      }
    }
  }, []);

  const {
    status: _wsStatus,
    send: sendWSMessage,
    sendTelemetry: sendWSTelemetry,
    ackedPacketCount,
  } = useWebSocketInterview({
    sessionId: session.id,
    token: token,
    autoConnect: true,
    onMessage: handleWSMessage,
  });

  const handleTelemetryPacket = useCallback((sample: TelemetrySample) => {
    setLatestTelemetry(sample);
    void sendWSTelemetry(sample, {
      cameraLabel: activeCameraLabel,
    });
  }, [sendWSTelemetry, activeCameraLabel]);

  // MediaPipe Vision Hook wired directly to shared videoStream in background
  const {
    status: visionStatus,
    error: visionError,
    videoRef: backgroundVideoRef,
    canvasRef: backgroundCanvasRef,
    latestMetrics,
    activeIntegrityFlags: _activeIntegrityFlags,
    isPhysicalVerified: _isPhysicalVerified,
    availableCameras,
    selectedDeviceId,
    selectCamera,
    start: restoreVision,
    startChallenge,
    resetChallenge,
    challengeStatus,
    challengeScore,
  } = useMediaPipeVision({
    stream: videoStream,
    autoStart: true,
    onTelemetryPacket: handleTelemetryPacket,
    onIntegrityEvent: (event) => {
      if (
        event.type === 'track_ended' ||
        event.type === 'frozen_feed' ||
        event.type === 'track_muted'
      ) {
        setIsCameraLostModalOpen(true);
        setCameraLostReason(
          event.type === 'frozen_feed'
            ? 'Camera video feed froze or failed to deliver frames.'
            : event.type === 'track_muted'
            ? 'Camera track was muted by hardware or system.'
            : 'Camera feed disconnected or hardware track ended.'
        );
        setIsPausedByIntegrity(true);
        if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(
            'Camera feed lost. Please restore camera within 30 seconds.'
          );
          utterance.rate = 1.0;
          window.speechSynthesis.speak(utterance);
        }
      } else if (event.type === 'feed_resumed' || event.type === 'track_unmuted') {
        setIsCameraLostModalOpen(false);
        setIsPausedByIntegrity(false);
        if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(
            'Camera feed restored. Resuming interview.'
          );
          utterance.rate = 1.0;
          window.speechSynthesis.speak(utterance);
        }
      }
    },
    onAntiSpoofFlag: (flag) => {
      if (flag.flag === 'camera_covered') {
        setIsCameraLostModalOpen(true);
        setCameraLostReason('Camera lens covered or blocked.');
        setIsPausedByIntegrity(true);
      }
    },
    onChallengeComplete: (result) => {
      sendWSMessage({
        type: 'challenge_result',
        challenge_id: result.challengeId,
        nonce: result.nonce,
        passed: result.passed,
        score: result.score,
      });

      if (result.passed) {
        setChallengeNotification({
          type: 'success',
          message: 'Liveness verified! Physical presence confirmed.',
        });
        setTimeout(() => {
          resetChallenge();
          setActiveChallengeStep(null);
          setChallengeNotification(null);
        }, 1400);
      } else {
        setChallengeNotification({
          type: 'error',
          message: 'Challenge timed out. Verifying with server policy engine...',
        });
        setTimeout(() => {
          resetChallenge();
          setActiveChallengeStep(null);
          setChallengeNotification(null);
        }, 2200);
      }
    },
  });

  useEffect(() => {
    challengeTriggerRef.current = startChallenge;
  }, [startChallenge]);

  // Challenge countdown timer and video attachment
  useEffect(() => {
    if (!activeChallengeStep || challengeStatus !== 'in_progress') return;

    const interval = setInterval(() => {
      setChallengeRemainingSec((prev) => {
        const next = Math.max(0, prev - 0.1);
        return parseFloat(next.toFixed(1));
      });
    }, 100);

    return () => clearInterval(interval);
  }, [activeChallengeStep, challengeStatus]);

  useEffect(() => {
    if (activeChallengeStep && challengeVideoRef.current && videoStream) {
      challengeVideoRef.current.srcObject = videoStream;
      challengeVideoRef.current.play().catch(() => {});
    }
  }, [activeChallengeStep, videoStream]);

  useEffect(() => {
    if (visionStatus === 'error') {
      setIsCameraLostModalOpen(true);
      setCameraLostReason(visionError || 'Camera feed disconnected or permission revoked.');
      setIsPausedByIntegrity(true);
    }
  }, [visionStatus, visionError]);

  useEffect(() => {
    if (showSelfView && selfViewVideoRef.current && videoStream) {
      selfViewVideoRef.current.srcObject = videoStream;
      selfViewVideoRef.current.play().catch(() => {});
    }
  }, [showSelfView, videoStream]);

  const handleRestoreCamera = async () => {
    try {
      await restoreVision();
      setIsCameraLostModalOpen(false);
      setIsPausedByIntegrity(false);
      sendWSMessage({
        type: 'integrity_event',
        event_type: 'camera_restored',
        t: Math.max(
          0,
          parseFloat(
            (
              (Date.now() -
                (session.created_at ? new Date(session.created_at).getTime() : Date.now())) /
              1000
            ).toFixed(3)
          )
        ),
      });
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(
          new SpeechSynthesisUtterance('Camera feed restored. Resuming interview.')
        );
      }
    } catch (err) {
      console.error('Failed to restore camera:', err);
    }
  };

  // Wrap-up Flow (§3.7): Natural spoken closing line, stage fade, tracks stopped via stopAll()
  const handleWrapUp = useCallback(
    (report?: FinalReport) => {
      setRoomPhase('wrapping_up');
      if (report) {
        setFinalReport(report);
      } else {
        setIsGeneratingReport(true);
        apiClient
          .get<FinalReport>(`/api/v1/interview/sessions/${session.id}/report`)
          .then((rep) => setFinalReport(rep))
          .catch(() => {})
          .finally(() => setIsGeneratingReport(false));
      }

      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const closingUtterance = new SpeechSynthesisUtterance(
          'That concludes our interview today. Thank you for your time and thoughtful responses.'
        );
        closingUtterance.rate = 1.0;
        closingUtterance.onend = () => {
          stopAll();
          setRoomPhase('complete');
        };
        window.speechSynthesis.speak(closingUtterance);
        setTimeout(() => {
          stopAll();
          setRoomPhase('complete');
        }, 2600);
      } else {
        stopAll();
        setRoomPhase('complete');
      }
    },
    [session.id, stopAll]
  );

  const handleGraceExpired = () => {
    sendWSMessage({ type: 'end_interview', reason: 'aborted_camera_lost' });
    stopAll();
    setIsCameraLostModalOpen(false);
    setIsPausedByIntegrity(true);
    setAbortReason('aborted_camera_lost');
    setRoomPhase('aborted');
  };

  // Remaining duration countdown timer
  useEffect(() => {
    if (isUserPaused || isPausedByIntegrity || roomPhase !== 'live') return;

    const interval = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          sendWSMessage({ type: 'end_interview', reason: 'time_budget_expired' });
          handleWrapUp();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isUserPaused, isPausedByIntegrity, roomPhase, sendWSMessage, handleWrapUp]);

  // Spacebar shortcut to toggle Pause/Resume
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setIsUserPaused((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Answer submission pipeline
  const executeAnswerSubmission = useCallback(async (answerText: string) => {
    const trimmed = answerText.trim();
    if (!trimmed || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    // Section 3.6: Latency hiding conversational acknowledgement (deterministic based on turn index)
    if ('speechSynthesis' in window && !isUserPaused && !isPausedByIntegrity) {
      const acks = [
        'Got it.',
        'Understood, thank you.',
        "Thanks, that's helpful.",
        'Noted.',
      ];
      const deterministicAck = acks[questionIndex % acks.length];
      const ackUtterance = new SpeechSynthesisUtterance(deterministicAck);
      ackUtterance.rate = 1.1;
      window.speechSynthesis.speak(ackUtterance);
    }

    try {
      const res = await apiClient.post<InterviewStepResponse>(
        `/api/v1/interview/sessions/${session.id}/answer`,
        { answer: trimmed }
      );

      if (res.evaluation) {
        setLastEvaluation(res.evaluation);
      }
      if (res.difficulty_change && res.difficulty_change !== 'UNCHANGED') {
        setLastDifficultyChange(res.difficulty_change);
      }
      setCurrentDifficulty(res.difficulty);

      if (res.status === 'COMPLETED' || res.final_report) {
        handleWrapUp(res.final_report);
      } else if (res.next_question) {
        setCurrentQuestion(res.next_question);
        setQuestionIndex(res.current_question_index);
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to evaluate response.';
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  }, [session.id, isSubmitting, isUserPaused, isPausedByIntegrity, questionIndex, handleWrapUp]);

  // Voice Turn Engine
  const isOverallPaused =
    isUserPaused ||
    isPausedByIntegrity ||
    isCameraLostModalOpen ||
    isFaceLostModalOpen ||
    isHelpDrawerOpen ||
    Boolean(activeChallengeStep && challengeStatus === 'in_progress');

  const {
    turnState,
    isAiSpeaking,
    isCandidateSpeaking,
    isListening,
    transcript,
    interimTranscript,
    audioLevel,
    silenceProgress,
    isSpeechSupported,
    sttError,
    clearTranscript,
    setTranscript,
    speakQuestion: speakCurrentQuestion,
    stopAudio: _stopAudio,
    interruptAI: _interruptAI,
    submitAnswer: _completeVoiceAnswer,
  } = useVoiceTurnEngine({
    audioStream,
    currentQuestion,
    questionIndex,
    isPaused: isOverallPaused,
    sendWSMessage,
    onSubmitAnswer: executeAnswerSubmission,
    autoPlayTTS: true,
    silenceTimeoutMs: 2200,
    minSpeechDurationMs: 400,
  });

  // Reset repeat question allowance on new question
  useEffect(() => {
    setHasRepeatedCurrentQuestion(false);
  }, [currentQuestion]);

  const handleRepeatQuestion = useCallback(() => {
    if (hasRepeatedCurrentQuestion || !currentQuestion) return;
    setHasRepeatedCurrentQuestion(true);
    void speakCurrentQuestion();
  }, [hasRepeatedCurrentQuestion, currentQuestion, speakCurrentQuestion]);

  const handleRetryCamera = useCallback(async () => {
    try {
      await restoreVision();
    } catch (e) {
      console.error('Failed to retry camera:', e);
    }
  }, [restoreVision]);

  const handleRetryMic = useCallback(async () => {
    try {
      if (audioStream) {
        audioStream.getTracks().forEach((t) => t.stop());
      }
    } catch (e) {
      console.error('Failed to retry mic:', e);
    }
  }, [audioStream]);

  // Continuous face absence detection (§3.5)
  useEffect(() => {
    if (isInitializing || Boolean(finalReport)) return;

    if (!latestMetrics.facePresent) {
      const interval = setInterval(() => {
        setFaceMissingSeconds((prev) => {
          const next = prev + 0.5;
          if (next >= 3.0 && !isFaceLostModalOpen) {
            setIsFaceLostModalOpen(true);
          }
          if (next >= 10.0 && prev < 10.0 && 'speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(
              new SpeechSynthesisUtterance('Warning 1 of 2: Face not detected. Please return to camera frame.')
            );
          }
          if (next >= 20.0 && prev < 20.0 && 'speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(
              new SpeechSynthesisUtterance('Warning 2 of 2: Final notice. Continued face absence will end the interview.')
            );
          }
          if (next >= 30.0) {
            clearInterval(interval);
            sendWSMessage({ type: 'end_interview', reason: 'aborted_face_not_visible' });
            stopAll();
            setErrorMessage('Interview ended: Face was not visible for 30 consecutive seconds.');
            setIsFaceLostModalOpen(false);
            setAbortReason('aborted_face_not_visible');
            setRoomPhase('aborted');
          }
          return next;
        });
      }, 500);
      return () => clearInterval(interval);
    } else {
      setFaceMissingSeconds(0);
      setIsFaceLostModalOpen(false);
    }
  }, [latestMetrics.facePresent, isInitializing, finalReport, isFaceLostModalOpen, sendWSMessage]);

  // 15-second no-speech timer (Section 3.6: 15s no-speech advances to next question)
  useEffect(() => {
    if (
      turnState !== 'candidate_turn' ||
      isCandidateSpeaking ||
      transcript.trim().length > 0 ||
      isOverallPaused ||
      !currentQuestion
    ) {
      setNoSpeechRemaining(null);
      return;
    }

    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsedSec = (Date.now() - startTime) / 1000;
      const left = Math.max(0, 15 - elapsedSec);

      // Only reveal timer ring during final 5s to eliminate unnecessary anxiety
      if (left <= 5) {
        setNoSpeechRemaining(Math.ceil(left));
      } else {
        setNoSpeechRemaining(null);
      }

      if (left <= 0) {
        clearInterval(interval);
        if ('speechSynthesis' in window) {
          const skipMsg = new SpeechSynthesisUtterance("Let's move on to the next question.");
          window.speechSynthesis.speak(skipMsg);
        }
        void executeAnswerSubmission('No response provided (timed out).');
      }
    }, 400);

    return () => clearInterval(interval);
  }, [turnState, isCandidateSpeaking, transcript, isOverallPaused, currentQuestion, executeAnswerSubmission]);

  // Initialize session workflow
  useEffect(() => {
    async function initInterviewEngine() {
      setIsInitializing(true);
      setErrorMessage(null);
      try {
        const res = await apiClient.post<InterviewStepResponse>(
          `/api/v1/interview/sessions/${session.id}/start`
        );
        const q = res.next_question || 'Ready to begin.';
        setCurrentQuestion(q);
        setQuestionIndex(res.current_question_index);
        setMaxQuestions(res.max_questions);
        setCurrentDifficulty(res.difficulty);
      } catch (err) {
        if (!initialQuestion) {
          const msg = err instanceof ApiError ? err.message : 'Failed to launch interview workflow.';
          setErrorMessage(msg);
        }
      } finally {
        setIsInitializing(false);
      }
    }
    initInterviewEngine();
  }, [session.id]);

  const handleDownloadPdf = async () => {
    if (!finalReport) return;
    setIsGeneratingPdf(true);
    try {
      const { pdf } = await import('@react-pdf/renderer');
      const { PDFReportDocument } = await import('../report/PDFReportDocument');
      const blob = await pdf(<PDFReportDocument session={session} report={finalReport} />).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Interview_Report_${session.role.replace(/[^a-zA-Z0-9_-]/g, '_')}_${session.id.slice(0, 8)}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to generate PDF report:', err);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  // Determine Orb visual state
  const orbState: OrbState = useMemo(() => {
    if (isAiSpeaking) return 'speaking';
    if (isSubmitting || isInitializing) return 'thinking';
    if (turnState === 'candidate_turn') return 'listening';
    return 'idle';
  }, [isAiSpeaking, isSubmitting, isInitializing, turnState]);

  // State hint text
  const stateHint = useMemo(() => {
    if (isUserPaused) return 'Interview paused • Press Space or click Resume to continue';
    if (isPausedByIntegrity) return 'Camera feed lost • Please restore camera';
    if (isInitializing) return 'Connecting to your AI Interviewer...';
    if (isSubmitting) return 'Processing your response...';
    if (isAiSpeaking) return 'AI Interviewer speaking...';
    if (turnState === 'candidate_turn') {
      if (isCandidateSpeaking) return 'Listening to your response...';
      if (silenceProgress > 0) return 'Detected pause • Concluding answer turn...';
      if (noSpeechRemaining !== null) return `Take your time (${noSpeechRemaining}s)`;
      return 'Listening… Take your time';
    }
    return 'Ready';
  }, [
    isUserPaused,
    isPausedByIntegrity,
    isInitializing,
    isSubmitting,
    isAiSpeaking,
    turnState,
    isCandidateSpeaking,
    silenceProgress,
    noSpeechRemaining,
  ]);

  // Screen 1: Interview Aborted Screen
  if (roomPhase === 'aborted') {
    return (
      <div className="min-h-screen w-full flex flex-col bg-background text-foreground">
        <InterviewAborted
          role={session.role}
          seniority={session.seniority}
          reason={abortReason}
          onReturnHome={onExit}
          onRestartSession={onExit}
        />
      </div>
    );
  }

  // Screen 2: Interview Complete (Preliminary Handoff Screen)
  if (roomPhase === 'complete') {
    return (
      <div className="min-h-screen w-full flex flex-col bg-background text-foreground">
        <InterviewComplete
          role={session.role}
          seniority={session.seniority}
          isGeneratingReport={isGeneratingReport || !finalReport}
          hasReport={Boolean(finalReport)}
          onViewReport={() => setRoomPhase('scorecard')}
          onDownloadPdf={finalReport ? handleDownloadPdf : undefined}
          isDownloadingPdf={isGeneratingPdf}
          onReturnHome={onExit}
        />
      </div>
    );
  }

  // Screen 3: Detailed Executive Scorecard Screen
  if (roomPhase === 'scorecard' && finalReport) {
    return (
      <div className="min-h-screen w-full flex flex-col bg-background text-foreground">
        <ExecutiveScorecard
          session={session}
          report={finalReport}
          onBack={() => setRoomPhase('complete')}
          onDownloadPdf={handleDownloadPdf}
          isDownloadingPdf={isGeneratingPdf}
          onReturnHome={onExit}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex flex-col bg-background text-foreground transition-colors selection:bg-primary/20">
      {/* Wrap-up overlay while interviewer speaks closing line (§3.7) */}
      {roomPhase === 'wrapping_up' && (
        <div className="fixed inset-0 z-50 bg-background/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center space-y-4 animate-in fade-in duration-500">
          <div className="h-16 w-16 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center text-primary">
            <Sparkles className="h-8 w-8 animate-pulse text-primary" />
          </div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight">Concluding Interview</h2>
          <p className="text-sm text-muted-foreground max-w-md">
            "That concludes our interview today. Thank you for your time and thoughtful responses."
          </p>
        </div>
      )}

      {/* Top Bar with product logo, timer, privacy indicator ("Camera & mic active: monitoring posture & eye contact"), theme toggle, and End button */}
      <InterviewTopBar
        role={session.role}
        seniority={session.seniority}
        remainingSeconds={remainingSeconds}
        totalDurationMinutes={durationMinutes}
        cameraActive={visionStatus === 'running'}
        micActive={audioStream !== null}
        onEndInterview={() => {
          sendWSMessage({ type: 'end_interview', reason: 'user_ended' });
          stopAll();
          setAbortReason('user_ended');
          setRoomPhase('aborted');
        }}
        onOpenHelp={() => setIsHelpDrawerOpen(true)}
        showTimer={true}
        interviewerName="AI Interviewer"
      />

      {/* Main Immersive Interview Stage */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 flex flex-col items-center justify-center relative select-none">
        {/* Error notification if any */}
        {errorMessage && (
          <div className="absolute top-4 left-4 right-4 max-w-lg mx-auto p-3 rounded-xl bg-destructive/15 border border-destructive/30 text-destructive text-xs text-center z-20">
            {errorMessage}
          </div>
        )}

        {/* Center Stage: Large Animated AI Interviewer Orb */}
        <div className="w-full flex flex-col items-center justify-center space-y-8 my-auto">
          <InterviewerOrb
            state={orbState}
            audioLevel={isAiSpeaking ? 0.7 : audioLevel}
            isCandidateSpeaking={isCandidateSpeaking}
            className="my-2"
          />

          {/* Question Caption revealed in sync with speech */}
          <QuestionCaption
            questionText={currentQuestion}
            isAiSpeaking={isAiSpeaking}
            className="mt-4"
          />

          {/* Subtle State Hint */}
          <div className="flex flex-col items-center justify-center gap-2 pt-2">
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-muted/40 border border-border/50 text-xs text-muted-foreground font-medium transition-all">
              {noSpeechRemaining !== null && (
                <div className="relative w-4 h-4 flex items-center justify-center">
                  <div className="absolute inset-0 rounded-full border border-amber-400/40 animate-ping" />
                  <div className="w-2 h-2 rounded-full bg-amber-400" />
                </div>
              )}
              <span>{stateHint}</span>
            </div>
          </div>

          {/* Dedicated Live Candidate Answer Transcript (§Q6) */}
          {showCandidateCaptions && (
            <CandidateAnswerTranscript
              transcript={transcript}
              interimTranscript={interimTranscript}
              isListening={turnState === 'candidate_turn' || isListening}
              isCandidateSpeaking={isCandidateSpeaking}
              isAiSpeaking={isAiSpeaking}
              isSubmitting={isSubmitting}
              audioLevel={audioLevel}
              silenceProgress={silenceProgress}
              isSpeechSupported={isSpeechSupported}
              sttError={sttError}
              onSubmit={executeAnswerSubmission}
              onClearAndRetry={clearTranscript}
              onManualTextChange={setTranscript}
              onRetryMic={handleRetryMic}
              className="mt-4"
            />
          )}
        </div>

        {/* Developer HUD: ONLY rendered if ?debug=1 is present in URL */}
        {isDebugMode && (
          <div className="fixed top-16 right-4 z-50 w-80 p-3 rounded-2xl bg-card/95 border border-border shadow-2xl backdrop-blur-md text-xs space-y-2 animate-in fade-in">
            <div className="flex items-center justify-between pb-1.5 border-b border-border font-mono">
              <span className="font-bold text-foreground">DEBUG TELEMETRY HUD</span>
              <span className="text-emerald-400">{ackedPacketCount} acked</span>
            </div>
            <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
              <div className="p-1.5 rounded bg-muted/40">
                <span className="text-muted-foreground block">FPS</span>
                <span className="font-bold text-foreground">{latestMetrics.fps}</span>
              </div>
              <div className="p-1.5 rounded bg-muted/40">
                <span className="text-muted-foreground block">Eye Contact</span>
                <span className="font-bold text-foreground">
                  {latestMetrics.eyeContactRatio !== null
                    ? `${Math.round(latestMetrics.eyeContactRatio * 100)}%`
                    : '—'}
                </span>
              </div>
              <div className="p-1.5 rounded bg-muted/40">
                <span className="text-muted-foreground block">Posture</span>
                <span className="font-bold text-foreground">
                  {latestMetrics.postureScore !== null
                    ? `${Math.round(latestMetrics.postureScore * 100)}%`
                    : '—'}
                </span>
              </div>
              <div className="p-1.5 rounded bg-muted/40">
                <span className="text-muted-foreground block">Face Present</span>
                <span className={`font-bold ${latestMetrics.facePresent ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {latestMetrics.facePresent ? 'True' : 'False'}
                </span>
              </div>
            </div>
            <MetricsHUD {...latestMetrics} />
          </div>
        )}
      </main>

      {/* Bottom Bar Controls */}
      <footer className="w-full border-t border-border/80 bg-background/80 backdrop-blur-md px-4 sm:px-6 h-16 flex items-center justify-between relative z-30">
        {/* Left: Self-View Toggle and Accessibility Captions Toggle */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSelfView((prev) => !prev)}
            className={`h-9 px-3 text-xs font-medium gap-1.5 rounded-full border border-border/60 ${
              showSelfView ? 'bg-primary/15 text-primary border-primary/40' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Video className="h-4 w-4" />
            <span>{showSelfView ? 'Hide Self-View' : 'Show Self-View'}</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowCandidateCaptions((prev) => {
                const next = !prev;
                localStorage.setItem('SHOW_CANDIDATE_CAPTIONS', String(next));
                return next;
              });
            }}
            className={`h-9 px-3 text-xs font-medium gap-1.5 rounded-full border border-border/60 ${
              showCandidateCaptions ? 'bg-primary/15 text-primary border-primary/40' : 'text-muted-foreground hover:text-foreground'
            }`}
            title="Toggle candidate real-time speech transcript"
          >
            <Subtitles className="h-4 w-4" />
            <span className="hidden sm:inline">Transcript</span>
          </Button>
        </div>

        {/* Center: Quiet Mic Level Indicator & Pause Button */}
        <div className="flex items-center gap-3">
          {/* Subtle Mic Activity Glow */}
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all duration-200 select-none ${
              isCandidateSpeaking
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.25)]'
                : 'bg-muted/40 border-border/60 text-muted-foreground'
            }`}
            title={isCandidateSpeaking ? 'Speaking: Mic detecting voice' : 'Mic listening'}
          >
            <Mic className="h-3.5 w-3.5" />
            <div className="flex items-center gap-0.5 h-3">
              {[0.15, 0.4, 0.7].map((threshold, i) => (
                <div
                  key={i}
                  className={`w-0.5 rounded-full transition-all duration-75 ${
                    audioLevel >= threshold
                      ? 'bg-emerald-400 h-3'
                      : audioLevel >= threshold * 0.5
                      ? 'bg-primary h-2'
                      : 'bg-muted-foreground/30 h-1'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Pause / Resume Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsUserPaused((prev) => !prev)}
            className="h-9 px-3.5 text-xs font-medium gap-1.5 rounded-full border-border/80 hover:bg-muted/60"
            title="Pause or resume the interview session (Spacebar)"
          >
            {isUserPaused ? (
              <>
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Resume</span>
              </>
            ) : (
              <>
                <Pause className="h-3.5 w-3.5" />
                <span>Pause</span>
              </>
            )}
          </Button>
        </div>

        {/* Right: Having trouble? Help Button */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (onOpenHelp) {
                onOpenHelp();
              }
              setIsHelpDrawerOpen(true);
            }}
            className="h-9 px-3 text-xs font-medium gap-1.5 text-muted-foreground hover:text-foreground rounded-full border border-border/60 hover:bg-muted/60"
          >
            <HelpCircle className="h-4 w-4" />
            <span className="hidden sm:inline">Having trouble?</span>
          </Button>
        </div>
      </footer>

      {/* Floating Picture-in-Picture Self-View Thumbnail */}
      {showSelfView && (
        <div className="fixed bottom-20 left-6 z-40 w-56 sm:w-64 rounded-2xl bg-card/95 border border-border shadow-2xl p-2.5 backdrop-blur-md animate-in fade-in slide-in-from-bottom-4">
          <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-border">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-semibold text-foreground">Self-View</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSelfView(false)}
              className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
              title="Hide Self-View"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
          <div className="relative aspect-video w-full rounded-xl bg-muted overflow-hidden border border-border">
            <video
              ref={selfViewVideoRef}
              playsInline
              muted
              autoPlay
              className="w-full h-full object-cover transform -scale-x-100"
            />
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
            On-device local processing • Not recorded
          </p>
        </div>
      )}

      {/* Background processing video (always rendered, visually hidden 2x2px, non-display:none so browser continues delivering frames) (§2.2 Invariant 1 & 2) */}
      <video
        ref={backgroundVideoRef}
        playsInline
        muted
        autoPlay
        style={{
          width: '2px',
          height: '2px',
          opacity: 0.01,
          position: 'fixed',
          bottom: 0,
          right: 0,
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      />
      <canvas
        ref={backgroundCanvasRef}
        style={{
          width: '2px',
          height: '2px',
          opacity: 0.01,
          position: 'fixed',
          bottom: 0,
          right: 0,
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      />

      {/* Active Liveness Challenge Modal Overlay (§4.2, §5) */}
      {(activeChallengeStep || challengeNotification) && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="challenge-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-md animate-in fade-in"
        >
          <div className="relative w-full max-w-lg rounded-2xl bg-card border border-primary/40 shadow-2xl overflow-hidden p-6 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary">
                  <ShieldCheck className="h-5 w-5 animate-pulse" />
                </div>
                <div>
                  <h3 id="challenge-dialog-title" className="text-base font-semibold text-foreground">
                    Physical Presence Check
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Brief gesture verification to confirm active physical presence
                  </p>
                </div>
              </div>
              <Badge variant="outline" className="font-mono text-xs px-2 py-0.5">
                {challengeNotification
                  ? challengeNotification.type === 'success'
                    ? 'Verified'
                    : 'Failed'
                  : `${challengeRemainingSec.toFixed(1)}s`}
              </Badge>
            </div>

            {challengeNotification ? (
              <div
                className={`p-4 rounded-xl border flex items-center gap-3 ${
                  challengeNotification.type === 'success'
                    ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-300'
                    : 'bg-rose-950/40 border-rose-500/50 text-rose-300'
                }`}
              >
                {challengeNotification.type === 'success' ? (
                  <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-400" />
                ) : (
                  <AlertCircle className="h-6 w-6 shrink-0 text-rose-400" />
                )}
                <div>
                  <div className="font-semibold text-sm">
                    {challengeNotification.type === 'success'
                      ? 'Verification Passed'
                      : 'Challenge Unsuccessful'}
                  </div>
                  <div className="text-xs opacity-90">{challengeNotification.message}</div>
                </div>
              </div>
            ) : (
              activeChallengeStep && (
                <>
                  <div className="p-4 rounded-xl bg-primary/10 border border-primary/20 text-center space-y-2">
                    <div className="flex items-center justify-center gap-2 text-primary font-semibold text-base sm:text-lg">
                      {renderChallengeIcon(activeChallengeStep.action)}
                      <span>{activeChallengeStep.prompt}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Please perform this natural head or facial gesture towards your webcam.
                    </p>
                  </div>

                  <div className="relative aspect-video w-full rounded-xl bg-muted overflow-hidden border border-border shadow-inner">
                    <video
                      ref={challengeVideoRef}
                      playsInline
                      muted
                      autoPlay
                      className="w-full h-full object-cover transform -scale-x-100"
                    />

                    <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between bg-card/85 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-border text-xs">
                      <span className="text-muted-foreground font-medium">Gesture Detected</span>
                      <span className="font-mono font-bold text-primary">
                        {Math.round(challengeScore * 100)}%
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3 pt-1">
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Movement Recognition</span>
                        <span>{Math.round(challengeScore * 100)}% / 100%</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-primary to-indigo-500 transition-all duration-100 ease-out"
                          style={{ width: `${Math.min(100, Math.round(challengeScore * 100))}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </>
              )
            )}
          </div>
        </div>
      )}

      {/* 30-Second Recovery Grace Modal (§5.3) */}
      <CameraLostModal
        isOpen={isCameraLostModalOpen}
        graceSeconds={cameraLostGraceSec}
        reason={cameraLostReason}
        availableCameras={availableCameras}
        selectedDeviceId={selectedDeviceId}
        onSelectCamera={selectCamera}
        onRestore={handleRestoreCamera}
        onGraceExpired={handleGraceExpired}
      />

      {/* Face Absence Recovery Modal with Warning Tiers (§3.5) */}
      <FaceLostModal
        isOpen={isFaceLostModalOpen}
        missingSeconds={faceMissingSeconds}
        videoStream={videoStream}
        onFaceRestored={() => setIsFaceLostModalOpen(false)}
      />

      {/* Right-Side Slide-Over Help & Troubleshooting Drawer (§3.4) */}
      <HelpDrawer
        isOpen={isHelpDrawerOpen}
        onClose={() => setIsHelpDrawerOpen(false)}
        videoStream={videoStream}
        audioStream={audioStream}
        audioLevel={audioLevel}
        availableCameras={availableCameras}
        selectedCameraId={selectedDeviceId}
        onSelectCamera={selectCamera}
        onRetryCamera={handleRetryCamera}
        onRetryMic={handleRetryMic}
        onRepeatQuestion={handleRepeatQuestion}
        hasRepeatedQuestion={hasRepeatedCurrentQuestion}
        onReconnectWS={() => sendWSMessage({ type: 'ping' })}
        wsStatus={_wsStatus}
        sendWSMessage={sendWSMessage}
        supportEmail={import.meta.env.VITE_SUPPORT_EMAIL || 'support@ai-interviewer.com'}
      />
    </div>
  );
}

function renderChallengeIcon(action: string) {
  switch (action) {
    case 'turn_head_left':
      return <ArrowLeft className="h-5 w-5 text-primary shrink-0" />;
    case 'turn_head_right':
      return <ArrowRight className="h-5 w-5 text-primary shrink-0" />;
    case 'look_up':
      return <ArrowUp className="h-5 w-5 text-primary shrink-0" />;
    case 'nod':
      return <ArrowDown className="h-5 w-5 text-primary shrink-0" />;
    case 'smile':
      return <Smile className="h-5 w-5 text-primary shrink-0" />;
    case 'blink_twice':
      return <Eye className="h-5 w-5 text-primary shrink-0" />;
    default:
      return <Sparkles className="h-5 w-5 text-primary shrink-0" />;
  }
}
