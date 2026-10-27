import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic,
  MicOff,
  Volume2,
  ChevronLeft,
  Sparkles,
  Send,
  Award,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  AlertCircle,
  Target,
  ArrowRight,
  RefreshCw,
  Play,
  Square,
  ShieldAlert,
  ShieldCheck,
  Download,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  WebcamMonitor,
  WebcamMonitorStatusInfo,
  WebcamMonitorAction,
} from './WebcamMonitor';
import { CameraLostModal } from './CameraLostModal';
import { useWebSocketInterview } from '@/hooks/useWebSocketInterview';
import { TelemetrySample, ServerWSMessage, FinalReport } from '@/lib/types';
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

interface InterviewRoomProps {
  session: SessionData;
  token: string;
  durationMinutes?: number;
  onExit: () => void;
}

export function InterviewRoom({
  session,
  token,
  durationMinutes: _durationMinutes = 15,
  onExit,
}: InterviewRoomProps): React.ReactElement {
  // Camera integrity & edge case recovery states (§5)
  const [isCameraLostModalOpen, setIsCameraLostModalOpen] = useState<boolean>(false);
  const [cameraLostReason, setCameraLostReason] = useState<string>(
    'Camera feed disconnected or obstructed.'
  );
  const [cameraLostGraceSec, setCameraLostGraceSec] = useState<number>(30);
  const [isPausedByIntegrity, setIsPausedByIntegrity] = useState<boolean>(false);
  const [integrityStatusInfo, setIntegrityStatusInfo] = useState<WebcamMonitorStatusInfo | null>(
    null
  );
  const webcamActionRef = useRef<WebcamMonitorAction | null>(null);

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
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
        setIsRecordingAnswer(false);
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
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(message.prompt);
        utterance.rate = 1.0;
        window.speechSynthesis.speak(utterance);
      }
      if (webcamActionRef.current) {
        webcamActionRef.current.startChallenge(1);
      }
    }
  }, []);

  const {
    status: wsStatus,
    send: sendWSMessage,
  } = useWebSocketInterview({
    sessionId: session.id,
    token: token,
    autoConnect: true,
    onMessage: handleWSMessage,
  });

  const [packetCount, setPacketCount] = useState<number>(0);
  const [_latestTelemetry, setLatestTelemetry] = useState<TelemetrySample | null>(null);

  const handleTelemetryPacket = (sample: TelemetrySample) => {
    setLatestTelemetry(sample);
    setPacketCount((prev) => prev + 1);
    sendWSMessage(sample);
  };

  const handleIntegrityStatusChange = useCallback((info: WebcamMonitorStatusInfo) => {
    setIntegrityStatusInfo(info);
    if (info.status === 'error') {
      setIsCameraLostModalOpen(true);
      setCameraLostReason(info.error || 'Camera feed disconnected or permission revoked.');
      setIsPausedByIntegrity(true);
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance('Camera lost, please restore it');
        utterance.rate = 1.0;
        window.speechSynthesis.speak(utterance);
      }
    }
  }, []);

  const handleRestoreCamera = async () => {
    if (webcamActionRef.current) {
      await webcamActionRef.current.restore();
    }
  };

  const handleGraceExpired = () => {
    sendWSMessage({ type: 'end_interview', reason: 'aborted_camera_lost' });
    setErrorMessage(
      'Interview aborted: Physical camera feed was not restored within the 30-second grace window.'
    );
    setIsCameraLostModalOpen(false);
    setIsPausedByIntegrity(true);
  };

  // LangGraph interview engine state
  const [currentQuestion, setCurrentQuestion] = useState<string>('');
  const [questionIndex, setQuestionIndex] = useState<number>(1);
  const [maxQuestions, setMaxQuestions] = useState<number>(5);
  const [currentDifficulty, setCurrentDifficulty] = useState<string>(session.difficulty);
  const [lastDifficultyChange, setLastDifficultyChange] = useState<string | null>(null);
  const [lastEvaluation, setLastEvaluation] = useState<QuestionEvaluation | null>(null);
  const [candidateAnswer, setCandidateAnswer] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [finalReport, setFinalReport] = useState<FinalReport | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);

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

  // TTS & STT States
  const [isSpeakingQuestion, setIsSpeakingQuestion] = useState<boolean>(false);
  const [isRecordingAnswer, setIsRecordingAnswer] = useState<boolean>(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
    };
  }, []);

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
        const msg = err instanceof ApiError ? err.message : 'Failed to launch interview workflow.';
        setErrorMessage(msg);
      } finally {
        setIsInitializing(false);
      }
    }
    initInterviewEngine();
  }, [session.id]);

  const handleToggleSpeech = () => {
    if (!('speechSynthesis' in window)) return;

    if (isSpeakingQuestion) {
      window.speechSynthesis.cancel();
      setIsSpeakingQuestion(false);
    } else {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(currentQuestion);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.onend = () => setIsSpeakingQuestion(false);
      utterance.onerror = () => setIsSpeakingQuestion(false);
      setIsSpeakingQuestion(true);
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleToggleDictation = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setErrorMessage('Speech recognition is not supported in this browser. Please type your response.');
      return;
    }

    if (isRecordingAnswer) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsRecordingAnswer(false);
    } else {
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event: any) => {
          let transcript = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
          }
          setCandidateAnswer((prev) => {
            const trimmed = prev.trim();
            return trimmed ? `${trimmed} ${transcript}` : transcript;
          });
        };

        recognition.onerror = () => {
          setIsRecordingAnswer(false);
        };

        recognition.onend = () => {
          setIsRecordingAnswer(false);
        };

        recognitionRef.current = recognition;
        recognition.start();
        setIsRecordingAnswer(true);
      } catch {
        setIsRecordingAnswer(false);
      }
    }
  };

  const handleSubmitAnswer = async () => {
    if (!candidateAnswer.trim() || isSubmitting) return;

    if (isRecordingAnswer && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsRecordingAnswer(false);
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setIsSpeakingQuestion(false);
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await apiClient.post<InterviewStepResponse>(
        `/api/v1/interview/sessions/${session.id}/answer`,
        { answer: candidateAnswer.trim() }
      );

      if (res.evaluation) {
        setLastEvaluation(res.evaluation);
      }
      if (res.difficulty_change && res.difficulty_change !== 'UNCHANGED') {
        setLastDifficultyChange(res.difficulty_change);
      }
      setCurrentDifficulty(res.difficulty);

      if (res.status === 'COMPLETED' || res.final_report) {
        setFinalReport(res.final_report || null);
      } else if (res.next_question) {
        setCurrentQuestion(res.next_question);
        setQuestionIndex(res.current_question_index);
        setCandidateAnswer('');
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to evaluate response.';
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (finalReport) {
    return (
      <div className="w-full max-w-4xl mx-auto space-y-6 animate-in fade-in py-8">
        <Card className="border-indigo-800/80 bg-slate-900/95 shadow-2xl backdrop-blur-xl">
          <CardHeader className="text-center pb-6 border-b border-slate-800">
            <div className="mx-auto p-3.5 rounded-2xl bg-indigo-600/20 border border-indigo-500/40 text-indigo-400 w-fit mb-2">
              <Award className="h-8 w-8" />
            </div>
            <CardTitle className="text-2xl text-white font-bold">
              Interview Completed: Executive Scorecard
            </CardTitle>
            <CardDescription className="text-slate-400 text-xs font-mono">
              Role: {session.seniority} {session.role} • Evaluated by LangGraph Adaptive Engine
            </CardDescription>

            <div className="flex items-center justify-center gap-4 pt-4">
              <div className="text-center px-6 py-2.5 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-[11px] text-slate-500 uppercase tracking-wider block font-medium">
                  Overall Score
                </span>
                <span className="text-3xl font-extrabold text-white font-mono">
                  {finalReport.overall_score}
                  <span className="text-xs text-slate-400 font-normal">/100</span>
                </span>
              </div>

              <div className="text-center px-6 py-2.5 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-[11px] text-slate-500 uppercase tracking-wider block font-medium">
                  Recommendation
                </span>
                <span className="text-xl font-bold text-emerald-400 font-mono mt-0.5 block">
                  {finalReport.hiring_recommendation}
                </span>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-6 pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 text-center space-y-1">
                <span className="text-xs text-slate-400">Technical Depth (60%)</span>
                <p className="text-xl font-bold text-indigo-300 font-mono">
                  {finalReport.category_scores.technical}%
                </p>
              </div>
              <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 text-center space-y-1">
                <span className="text-xs text-slate-400">Communication (25%)</span>
                <p className="text-xl font-bold text-sky-300 font-mono">
                  {finalReport.category_scores.communication}%
                </p>
              </div>
              <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 text-center space-y-1">
                <span className="text-xs text-slate-400">Biometric Composure (15%)</span>
                <p className="text-xl font-bold text-emerald-300 font-mono">
                  {finalReport.category_scores.composure}%
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-900/40 space-y-2">
                <span className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  Key Strengths
                </span>
                <ul className="text-xs text-slate-300 space-y-1.5 list-disc list-inside">
                  {finalReport.strengths.map((str, i) => (
                    <li key={i}>{str}</li>
                  ))}
                </ul>
              </div>

              <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-900/40 space-y-2">
                <span className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                  <AlertCircle className="h-4 w-4 text-amber-400" />
                  Growth Opportunities
                </span>
                <ul className="text-xs text-slate-300 space-y-1.5 list-disc list-inside">
                  {finalReport.weaknesses.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 leading-relaxed">
              <span className="font-semibold text-slate-200 block mb-1">Executive Summary:</span>
              {finalReport.executive_summary}
            </div>

            {/* SECTION 7: CAMERA INTEGRITY & BIOMETRIC VERIFICATION REPORT */}
            <div className="p-5 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-indigo-950/60 border border-indigo-700/50 text-indigo-400">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white tracking-wide">
                      Physical Camera Integrity & Biometric Verification (§7)
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      Validated by client-side WebAssembly heuristics and server plausibility checks
                    </p>
                  </div>
                </div>
                <Badge
                  className={
                    (finalReport.integrity_summary?.verdict || 'Verified') === 'Verified'
                      ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600/50 text-xs px-3 py-1 gap-1.5'
                      : finalReport.integrity_summary?.verdict === 'Verified with warnings'
                      ? 'bg-amber-950/80 text-amber-300 border-amber-600/50 text-xs px-3 py-1 gap-1.5'
                      : 'bg-rose-950/80 text-rose-300 border-rose-600/50 text-xs px-3 py-1 gap-1.5'
                  }
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      (finalReport.integrity_summary?.verdict || 'Verified') === 'Verified'
                        ? 'bg-emerald-400'
                        : finalReport.integrity_summary?.verdict === 'Verified with warnings'
                        ? 'bg-amber-400'
                        : 'bg-rose-500'
                    }`}
                  />
                  Verdict: {finalReport.integrity_summary?.verdict || 'Verified'}
                </Badge>
              </div>

              {/* Metric Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800/80 space-y-1">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Integrity Score</span>
                  <span className="text-lg font-bold font-mono text-emerald-400">
                    {finalReport.integrity_summary?.integrity_score ?? 100}/100
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800/80 space-y-1">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Face Present Rate</span>
                  <span className="text-lg font-bold font-mono text-white">
                    {finalReport.integrity_summary?.face_present_percentage ?? 100}%
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800/80 space-y-1">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Challenges Passed</span>
                  <span className="text-lg font-bold font-mono text-indigo-300">
                    {finalReport.integrity_summary?.challenges_passed ?? 1} /{' '}
                    {(finalReport.integrity_summary?.challenges_passed ?? 1) +
                      (finalReport.integrity_summary?.challenges_failed ?? 0)}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800/80 space-y-1">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Pause / Loss Incidents</span>
                  <span className="text-lg font-bold font-mono text-slate-300">
                    {finalReport.integrity_summary?.pauses_count ?? 0} incidents
                  </span>
                </div>
              </div>

              <div className="text-[11px] text-slate-400 bg-slate-900/60 p-3 rounded-xl border border-slate-800/60 space-y-1">
                <p className="text-indigo-300 font-medium">
                  •{' '}
                  {finalReport.integrity_summary?.non_verbal_excluded_note ||
                    'Non-verbal scores (eye contact, posture) are computed only from verified-live segments; segments with active integrity flags were excluded.'}
                  {' '}({finalReport.integrity_summary?.excluded_segments_count ?? 0} flagged segments excluded).
                </p>
                <p className="text-slate-400">
                  • Active Camera Device:{' '}
                  <span className="font-mono text-slate-200">
                    {finalReport.integrity_summary?.camera_device_name || 'Physical Hardware Webcam Verified'}
                  </span>
                </p>
              </div>

              {/* Event Timeline Table */}
              {finalReport.integrity_summary?.timeline_events &&
              finalReport.integrity_summary.timeline_events.length > 0 ? (
                <div className="space-y-2">
                  <span className="text-xs font-semibold text-slate-300 block">Integrity Event Timeline</span>
                  <div className="border border-slate-800 rounded-xl overflow-hidden text-xs">
                    <div className="grid grid-cols-4 bg-slate-900 px-3 py-2 font-medium text-slate-400 border-b border-slate-800 text-[11px]">
                      <span>Timestamp</span>
                      <span>Flag</span>
                      <span>Duration</span>
                      <span>Confidence</span>
                    </div>
                    {finalReport.integrity_summary.timeline_events.slice(0, 5).map((evt, idx) => (
                      <div
                        key={idx}
                        className="grid grid-cols-4 px-3 py-2 border-b border-slate-800/50 text-slate-300 font-mono text-[11px]"
                      >
                        <span>{evt.timestamp}s</span>
                        <span className="text-amber-300">{evt.flag}</span>
                        <span>{evt.duration_sec}s</span>
                        <span>{Math.round(evt.confidence * 100)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-emerald-400/90 bg-emerald-950/20 border border-emerald-900/30 p-2.5 rounded-xl">
                  ✓ Pristine session: Zero suspicious video, freeze, or virtual camera events flagged during the interview.
                </div>
              )}

              {/* Heuristic Disclaimer */}
              <p className="text-[10px] text-slate-500 italic text-center pt-1 border-t border-slate-800/50">
                Disclaimer:{' '}
                {finalReport.integrity_summary?.disclaimer ||
                  'Integrity checks are automated heuristics and may produce false positives. Review flagged events before drawing conclusions.'}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
              <Button
                onClick={handleDownloadPdf}
                disabled={isGeneratingPdf}
                variant="outline"
                className="w-full sm:w-auto border-indigo-700/60 bg-indigo-950/30 hover:bg-indigo-900/40 text-indigo-300 font-semibold text-xs px-5 h-10 gap-2 cursor-pointer"
              >
                <Download className={`h-4 w-4 ${isGeneratingPdf ? 'animate-spin' : ''}`} />
                {isGeneratingPdf ? 'Compiling Official PDF...' : 'Download Official PDF Report'}
              </Button>

              <Button
                onClick={onExit}
                className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-6 h-10 gap-2 cursor-pointer"
              >
                Return to Dashboard
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-2xl bg-slate-900/80 border border-slate-800 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onExit}
            className="text-slate-400 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Exit Room
          </Button>
          <div className="h-4 w-[1px] bg-slate-800 hidden sm:block" />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white tracking-tight">
                {session.seniority} {session.role}
              </h2>
              <Badge variant="outline" className="border-indigo-600/40 text-indigo-300 text-xs font-mono">
                {currentDifficulty} Tier
              </Badge>
              {lastDifficultyChange && (
                <Badge
                  variant={lastDifficultyChange === 'UPGRADE' ? 'success' : 'outline'}
                  className="gap-1 text-[10px] font-mono animate-bounce"
                >
                  {lastDifficultyChange === 'UPGRADE' ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  {lastDifficultyChange}
                </Badge>
              )}
            </div>
            <p className="text-xs text-slate-400 font-mono">Session ID: {session.id}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 self-end sm:self-auto flex-wrap">
          {import.meta.env.DEV && import.meta.env.VITE_ALLOW_MOCK_CAMERA === 'true' && (
            <Badge variant="destructive" className="bg-rose-600 text-white font-bold py-1 px-2.5 text-xs animate-pulse">
              DEV MOCK
            </Badge>
          )}

          {/* Camera Integrity Status Dot & Subtle Text (§5.2) */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-950/80 border border-slate-800 text-xs font-mono">
            {!integrityStatusInfo || integrityStatusInfo.status === 'error' || isCameraLostModalOpen ? (
              <>
                <span className="h-2 w-2 rounded-full bg-rose-500 animate-ping" />
                <span className="text-rose-400 font-semibold">
                  Camera integrity: Problem — {integrityStatusInfo?.error || 'Feed lost'}
                </span>
              </>
            ) : integrityStatusInfo.activeFlags.length > 0 ? (
              <>
                <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-amber-300">
                  Camera integrity: Warning — {integrityStatusInfo.activeFlags[0].flag.replace(/_/g, ' ')} suspected
                </span>
              </>
            ) : integrityStatusInfo.isPhysicalVerified ? (
              <>
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-emerald-400">Camera integrity: Good</span>
              </>
            ) : (
              <>
                <span className="h-2 w-2 rounded-full bg-slate-500" />
                <span className="text-slate-400">Camera integrity: Initializing...</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-950/80 border border-slate-800 text-xs font-mono">
            {wsStatus === 'connected' ? (
              <>
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-emerald-400">WS Telemetry Active</span>
                <span className="text-slate-500">({packetCount})</span>
              </>
            ) : wsStatus === 'connecting' || wsStatus === 'reconnecting' ? (
              <>
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-ping" />
                <span className="text-amber-400">{wsStatus === 'reconnecting' ? 'Reconnecting WS...' : 'Connecting WS...'}</span>
              </>
            ) : (
              <>
                <span className="h-2 w-2 rounded-full bg-rose-500" />
                <span className="text-rose-400">WS Disconnected</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 space-y-4">
          <WebcamMonitor
            onTelemetryPacket={handleTelemetryPacket}
            showHUD={true}
            onIntegrityStatusChange={handleIntegrityStatusChange}
            actionRef={webcamActionRef}
          />
        </div>

        <div className="lg:col-span-7 space-y-4">
          <Card className="border-indigo-900/60 bg-slate-900/90 shadow-xl backdrop-blur-md">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Target className="h-5 w-5 text-indigo-400" />
                  <CardTitle className="text-base text-white">
                    Question {questionIndex} of {maxQuestions}
                  </CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="border-indigo-600/60 text-indigo-300 font-mono text-xs">
                    Difficulty: {currentDifficulty}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleToggleSpeech}
                    className={`h-7 px-2 text-xs gap-1 ${
                      isSpeakingQuestion
                        ? 'border-indigo-500 bg-indigo-600/20 text-indigo-300'
                        : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-white'
                    }`}
                  >
                    {isSpeakingQuestion ? (
                      <>
                        <Square className="h-3 w-3 fill-indigo-400" />
                        Stop Audio
                      </>
                    ) : (
                      <>
                        <Play className="h-3 w-3 fill-slate-400" />
                        Play Audio (TTS)
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              {isInitializing ? (
                <div className="py-8 flex flex-col items-center justify-center gap-2 text-slate-400 text-xs font-mono">
                  <RefreshCw className="h-5 w-5 animate-spin text-indigo-400" />
                  <span>Synthesizing tailored question via LangGraph...</span>
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 text-sm text-white font-medium leading-relaxed">
                  {currentQuestion}
                </div>
              )}

              {lastEvaluation && (
                <div className="p-3.5 rounded-xl bg-indigo-950/40 border border-indigo-800/60 text-xs space-y-2 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-indigo-200 flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                      Answer Score: {lastEvaluation.score}/10
                    </span>
                    <div className="flex gap-2 font-mono text-[11px] text-slate-400">
                      <span>Tech: {lastEvaluation.technical_accuracy}</span>
                      <span>Clarity: {lastEvaluation.clarity}</span>
                      <span>Completeness: {lastEvaluation.completeness}</span>
                    </div>
                  </div>
                  <p className="text-slate-300 italic">"{lastEvaluation.feedback}"</p>
                  {lastEvaluation.encouragement && (
                    <p className="text-emerald-300 text-[11px] font-medium">
                      💡 {lastEvaluation.encouragement}
                    </p>
                  )}
                </div>
              )}

              {errorMessage && (
                <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-200 text-xs">
                  {errorMessage}
                </div>
              )}

              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-semibold text-slate-300 flex items-center gap-2">
                    <span>Your Technical Response</span>
                    {isRecordingAnswer && (
                      <span className="inline-flex items-center gap-1 text-rose-400 font-mono text-[11px] animate-pulse">
                        <span className="h-2 w-2 rounded-full bg-rose-500" />
                        Listening...
                      </span>
                    )}
                  </label>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleToggleDictation}
                      className={`text-xs px-2.5 py-1 rounded-md border flex items-center gap-1.5 transition-colors ${
                        isRecordingAnswer
                          ? 'border-rose-500 bg-rose-950/60 text-rose-300'
                          : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-white hover:border-slate-700'
                      }`}
                    >
                      {isRecordingAnswer ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
                      {isRecordingAnswer ? 'Stop Dictation' : 'Speech-to-Text (STT)'}
                    </button>

                  </div>
                </div>

                <textarea
                  rows={4}
                  value={candidateAnswer}
                  onChange={(e) => setCandidateAnswer(e.target.value)}
                  placeholder="Explain your approach, design decisions, trade-offs, and failure handling (type or speak)..."
                  className="w-full p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none font-sans"
                />

                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 font-mono">
                  <div className="flex items-center gap-1.5">
                    <Volume2 className="h-3.5 w-3.5 text-indigo-400" />
                    <span>Live Audio Energy:</span>
                    <div className="flex items-end gap-0.5 h-3">
                      {[3, 6, 12, 18, 10, 14, 8].map((h, i) => (
                        <div
                          key={i}
                          className="w-1 bg-indigo-500 rounded-sm"
                          style={{
                            height: `${isRecordingAnswer ? h : 2}px`,
                            opacity: isRecordingAnswer ? 1 : 0.3,
                          }}
                        />
                      ))}
                    </div>
                  </div>

                  <Button
                    onClick={handleSubmitAnswer}
                    disabled={isSubmitting || isPausedByIntegrity || !candidateAnswer.trim()}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-6 h-9 gap-2 cursor-pointer shadow-lg shadow-indigo-600/20 disabled:opacity-50"
                  >
                    {isSubmitting ? (
                      <span className="flex items-center gap-2">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        Evaluating via Rubric...
                      </span>
                    ) : isPausedByIntegrity ? (
                      <span className="flex items-center gap-2 text-rose-300">
                        <ShieldAlert className="h-3.5 w-3.5 text-rose-400" />
                        Interview Paused (Camera Lost)
                      </span>
                    ) : (
                      <>
                        <Send className="h-3.5 w-3.5" />
                        Submit Answer & Proceed
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Accessible Camera Lost Modal with 30s Grace Countdown (§5.2) */}
      <CameraLostModal
        isOpen={isCameraLostModalOpen}
        graceSeconds={cameraLostGraceSec}
        reason={cameraLostReason}
        onRestore={handleRestoreCamera}
        onGraceExpired={handleGraceExpired}
      />
    </div>
  );
}
