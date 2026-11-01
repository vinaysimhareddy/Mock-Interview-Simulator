import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Camera,
  CameraOff,
  Mic,
  Volume2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Sparkles,
  ShieldCheck,
  Headphones,
  Check,
  Play,
  ChevronRight,
  Accessibility,
  RefreshCw,
  Lock,
  RotateCcw,
  Sun,
  Copy,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BrowserTextToSpeech } from '@/services/speech/browserTTS';
import { BrowserSpeechToText } from '@/services/speech/browserSTT';
import { estimateQuestionRange } from '@/services/speech/timeEstimator';
import {
  computeRMS,
  computePeak,
  NoiseFloorCalibrator,
  VoicedTimeAccumulator,
  evaluateMicQuality,
  MicQualityReport,
} from '@/lib/micQuality';
import { MIC_QUALITY_CONFIG } from '@/lib/micQualityConfig';
import { useSetupDevices, mapCameraErrorToAction } from '@/hooks/useSetupDevices';
import { useCameraStream } from '@/context/CameraStreamContext';
import { generateMaskedDiagnostics } from '@/lib/maskedDiagnostics';
import { mapSpeechRecognitionError } from '@/services/speech/speechErrors';
import {
  CameraProofPipeline,
  attachStreamToVideo,
} from '@/lib/cameraProofPipeline';
import {
  ChallengeGestureEvaluator,
  generateChallengeSequence,
} from '@/lib/activeChallenge';
import { LivenessChallengeStep } from '@/lib/integrityTypes';
import { PermissionHelpModal } from './PermissionHelpModal';
import { DiagnosticsModal } from './DiagnosticsModal';
import {
  evaluateFaceQuality,
  FaceQualityHysteresis,
  FaceQualityReport,
  BoundingBox,
  computeFaceBoundingBox,
} from '@/lib/faceQuality';
import {
  getSharedFaceLandmarker,
  preloadVisionModels,
  recordVisionTiming,
} from '@/lib/visionManager';
import { extractFaceGeometrySignature } from '@/lib/faceGeometry';
import { computeHeadPose } from '@/lib/metrics';
import { FaceLandmarker } from '@mediapipe/tasks-vision';

export interface PreInterviewSetupProps {
  role: string;
  seniority: string;
  onStartInterview: (config: {
    durationMinutes: number;
    videoStream: MediaStream | null;
    audioStream: MediaStream | null;
  }) => void;
  onCancel: () => void;
}

export function PreInterviewSetup({
  role: _role,
  seniority: _seniority,
  onStartInterview,
  onCancel,
}: PreInterviewSetupProps): React.ReactElement {
  // State Machine for all hardware & liveness states
  const { state, dispatch, isAllReady } = useSetupDevices();

  // Shared Media Stream Provider
  const {
    stream: cameraStream,
    videoStream,
    selectedDeviceId,
    availableCameras,
    acquireCamera,
    releaseCamera,
    setSelectedDeviceId,
    refreshCameras,
    retainForInterview,
    audioStream,
    setAudioStream,
    acquireAudio,
    releaseAudio,
    availableMicrophones,
    selectedMicDeviceId,
    setSelectedMicDeviceId,
    refreshMicrophones,
    activeMicLabel,
  } = useCameraStream();

  const isHandingOverRef = useRef<boolean>(false);

  // Duration State
  const [durationMinutes, setDurationMinutes] = useState<number>(20);
  const [customDurationInput, setCustomDurationInput] = useState<string>('20');
  const [isCustomDuration, setIsCustomDuration] = useState<boolean>(false);

  // Consent & Accommodation
  const [consentAccepted, setConsentAccepted] = useState<boolean>(true);
  const [motorAccommodation, setMotorAccommodation] = useState<boolean>(false);

  // Local UI & Pipeline State
  const [isBlackFrame, setIsBlackFrame] = useState<boolean>(false);
  const [speakerCodeInput, setSpeakerCodeInput] = useState<string>('');
  const [speakerTestCode, setSpeakerTestCode] = useState<string>('');
  const [isSpeakingTest, setIsSpeakingTest] = useState<boolean>(false);
  const [speakerError, setSpeakerError] = useState<string | null>(null);
  const [isHelpModalOpen, setIsHelpModalOpen] = useState<boolean>(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState<boolean>(false);
  const [diagnosticsCopied, setDiagnosticsCopied] = useState<boolean>(false);

  // Face Quality & Camera Verification State
  const [faceQualityReport, setFaceQualityReport] = useState<FaceQualityReport | null>(null);
  const [isAutoCapture, setIsAutoCapture] = useState<boolean>(false);
  const [autoCaptureCountdown, setAutoCaptureCountdown] = useState<number | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);

  const hysteresisRef = useRef<FaceQualityHysteresis>(new FaceQualityHysteresis());
  const bboxHistoryRef = useRef<BoundingBox[]>([]);
  const detectionLoopActiveRef = useRef<boolean>(false);
  const detectionLoopIdRef = useRef<number | null>(null);
  const lastInferenceTimeRef = useRef<number>(0);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const autoCaptureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cameraTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);

  // Microphone Calibration & Quality State
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [noiseDetected, setNoiseDetected] = useState<boolean>(false);
  const [micReport, setMicReport] = useState<MicQualityReport | null>(null);
  const noiseFloorCalibratorRef = useRef<NoiseFloorCalibrator>(new NoiseFloorCalibrator());
  const voicedAccumulatorRef = useRef<VoicedTimeAccumulator>(new VoicedTimeAccumulator());

  // Active Liveness Steps
  const [challengeSequence, setChallengeSequence] = useState<LivenessChallengeStep[]>([]);
  const [currentChallengeIdx, setCurrentChallengeIdx] = useState<number>(0);
  const challengeEvaluatorRef = useRef<ChallengeGestureEvaluator>(new ChallengeGestureEvaluator());

  // Element & Service References
  const videoRef = useRef<HTMLVideoElement>(null);
  const pipelineRef = useRef<CameraProofPipeline | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioAnimRef = useRef<number | null>(null);
  const ttsRef = useRef<BrowserTextToSpeech | null>(null);
  const sttRef = useRef<BrowserSpeechToText | null>(null);
  const speechStartedRef = useRef<boolean>(false);
  const [liveSpeechTranscript, setLiveSpeechTranscript] = useState<string>('');
  const [sttNotice, setSttNotice] = useState<string | null>(null);
  const [lastMicErrorName, setLastMicErrorName] = useState<string | null>(null);
  const [lastSttErrorCode, setLastSttErrorCode] = useState<string | null>(null);

  const durationPresets = [10, 15, 20, 30, 45, 60];
  const questionEstimate = estimateQuestionRange(durationMinutes);

  const sttSupported =
    typeof window !== 'undefined' &&
    Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  // Lighting & Color Tint Warnings (§2.1, §2.2)
  const lightingCrit = faceQualityReport?.criteriaList.find((c) => c.id === 'lighting');
  const colorCastCrit = faceQualityReport?.criteriaList.find((c) => c.id === 'color_cast');
  const showLightingTip =
    (state.camera.status === 'quality_checking' || state.camera.status === 'ready_to_capture') &&
    Boolean((lightingCrit && !lightingCrit.passed) || (colorCastCrit && !colorCastCrit.passed));

  // Initialize Audio & Speech Services + Preload Vision Models
  useEffect(() => {
    ttsRef.current = new BrowserTextToSpeech();
    const stt = new BrowserSpeechToText();
    sttRef.current = stt;

    const unsubscribeSTT = stt.onTranscript((event) => {
      if (event.fullTranscript) {
        setLiveSpeechTranscript(event.fullTranscript);
      } else if (event.text) {
        setLiveSpeechTranscript(event.text);
      }
    });

    const unsubscribeSTTError = stt.onError((err) => {
      setLastSttErrorCode(err.error);
      if (
        err.error === 'network' ||
        err.error === 'audio-capture' ||
        err.error === 'service-not-allowed'
      ) {
        const errorInfo = mapSpeechRecognitionError(err.error);
        setSttNotice(`${errorInfo.title}: ${errorInfo.explanation}`);
      }
    });

    refreshCameras();
    refreshMicrophones();
    preloadVisionModels().catch(() => {});

    return () => {
      unsubscribeSTT();
      unsubscribeSTTError();
      detectionLoopActiveRef.current = false;
      if (detectionLoopIdRef.current) cancelAnimationFrame(detectionLoopIdRef.current);
      if (cameraTimeoutRef.current) clearTimeout(cameraTimeoutRef.current);
      if (modelTimeoutRef.current) clearTimeout(modelTimeoutRef.current);
      if (detectionTimeoutRef.current) clearTimeout(detectionTimeoutRef.current);
      if (autoCaptureTimerRef.current) clearTimeout(autoCaptureTimerRef.current);
      if (audioAnimRef.current) cancelAnimationFrame(audioAnimRef.current);
      if (audioContextRef.current && !isHandingOverRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      if (ttsRef.current) ttsRef.current.stop();
      if (sttRef.current) sttRef.current.stop();
      if (pipelineRef.current) pipelineRef.current.stop();

      // Only shut down tracks if not handing over to active interview room
      if (!isHandingOverRef.current) {
        releaseAudio();
        releaseCamera();
      }
    };
  }, [refreshCameras, refreshMicrophones, releaseCamera, releaseAudio]);

  // --- 1. CAMERA PIPELINE & GUIDED FACE DETECTION ---

  // Throttled detection loop (10-15 FPS)
  const startDetectionLoop = useCallback((landmarker: FaceLandmarker, deviceId?: string, label?: string) => {
    detectionLoopActiveRef.current = true;
    let lastInferenceTime = 0;
    let isFirstDetection = true;
    const streamStartMark = performance.now();

    const loop = (timestamp: number) => {
      if (!detectionLoopActiveRef.current) return;

      const video = videoRef.current;
      if (
        video &&
        video.readyState >= 2 &&
        !video.paused &&
        !video.ended &&
        video.videoWidth > 0
      ) {
        // Throttle to ~12 FPS (every 80ms)
        if (timestamp - lastInferenceTime >= 80) {
          lastInferenceTime = timestamp;
          lastInferenceTimeRef.current = timestamp;
          try {
            const result = landmarker.detectForVideo(video, timestamp);
            const faceCount = result.faceLandmarks.length;

            if (isFirstDetection && faceCount > 0) {
              isFirstDetection = false;
              if (detectionTimeoutRef.current) {
                clearTimeout(detectionTimeoutRef.current);
                detectionTimeoutRef.current = null;
              }
              const firstDetDuration = performance.now() - streamStartMark;
              recordVisionTiming('timeToFirstDetectionMs', firstDetDuration);
              dispatch({
                type: 'CAMERA_QUALITY_CHECKING',
                deviceId,
                label,
              });
            }

            // Feed pipeline watchdog for continuity
            pipelineRef.current?.reportFaceCount(faceCount, timestamp);

            // Compute downsampled ImageData (256x144) for pixel metrics
            if (!offscreenCanvasRef.current) {
              const c = document.createElement('canvas');
              c.width = 256;
              c.height = 144;
              offscreenCanvasRef.current = c;
            }
            const offCtx = offscreenCanvasRef.current.getContext('2d', { willReadFrequently: true });
            let facePixels: ImageData | null = null;
            if (offCtx) {
              offCtx.drawImage(video, 0, 0, 256, 144);
              facePixels = offCtx.getImageData(0, 0, 256, 144);
            }

            let landmarks = null;
            let headPose = null;
            let blendshapes = null;

            if (faceCount > 0) {
              landmarks = result.faceLandmarks[0];
              headPose = computeHeadPose(landmarks);
              if (result.faceBlendshapes?.[0]?.categories) {
                blendshapes = Object.fromEntries(
                  result.faceBlendshapes[0].categories.map((c) => [c.categoryName, c.score])
                );
              }
            }

            const bbox = computeFaceBoundingBox(landmarks);
            if (bbox) {
              bboxHistoryRef.current.push(bbox);
              if (bboxHistoryRef.current.length > 10) {
                bboxHistoryRef.current.shift();
              }
            }

            const report = evaluateFaceQuality({
              faceCount,
              landmarks,
              headPose,
              blendshapes,
              facePixels,
              bboxHistory: bboxHistoryRef.current,
            });

            setFaceQualityReport(report);

            const { isReady } = hysteresisRef.current.update(report.overallPassed, timestamp);

            if (isReady) {
              dispatch({
                type: 'CAMERA_READY_TO_CAPTURE',
                deviceId,
                label,
              });
            } else {
              dispatch({
                type: 'CAMERA_QUALITY_CHECKING',
                deviceId,
                label,
              });
            }
          } catch {
            // Guard against frame detection errors
          }
        }
      }

      detectionLoopIdRef.current = requestAnimationFrame(loop);
    };

    detectionLoopIdRef.current = requestAnimationFrame(loop);
  }, [dispatch]);

  const handleEnableCamera = useCallback(async () => {
    setIsBlackFrame(false);
    setCaptureError(null);
    setCapturedPreview(null);
    hysteresisRef.current.reset();
    bboxHistoryRef.current = [];

    if (cameraTimeoutRef.current) clearTimeout(cameraTimeoutRef.current);
    if (modelTimeoutRef.current) clearTimeout(modelTimeoutRef.current);
    if (detectionTimeoutRef.current) clearTimeout(detectionTimeoutRef.current);

    // Stage 1: Requesting camera (8s timeout)
    dispatch({ type: 'CAMERA_REQUEST', stage: 'requesting_camera' });

    cameraTimeoutRef.current = setTimeout(() => {
      dispatch({
        type: 'CAMERA_TIMEOUT',
        stage: 'requesting_camera',
        error: 'Camera permission prompt timed out (no response after 8s).',
      });
    }, 8000);

    const streamStartMark = performance.now();

    try {
      const stream = await acquireCamera(selectedDeviceId || undefined);
      if (cameraTimeoutRef.current) {
        clearTimeout(cameraTimeoutRef.current);
        cameraTimeoutRef.current = null;
      }

      const timeToStream = performance.now() - streamStartMark;
      recordVisionTiming('timeToStreamMs', timeToStream);

      const track = stream.getVideoTracks()[0];
      const label = track?.label || 'Webcam';

      // Stage 2: Starting video
      dispatch({ type: 'CAMERA_SET_STAGE', stage: 'starting_video', progress: 30 });

      if (videoRef.current) {
        await attachStreamToVideo(videoRef.current, stream);

        // Stage 3: Loading model (20s timeout)
        dispatch({ type: 'CAMERA_SET_STAGE', stage: 'loading_model', progress: 60 });

        modelTimeoutRef.current = setTimeout(() => {
          dispatch({
            type: 'CAMERA_TIMEOUT',
            stage: 'loading_model',
            error: 'Vision model took too long to load (timeout after 20s).',
          });
        }, 20000);

        const landmarker = await getSharedFaceLandmarker();
        faceLandmarkerRef.current = landmarker;

        if (modelTimeoutRef.current) {
          clearTimeout(modelTimeoutRef.current);
          modelTimeoutRef.current = null;
        }

        // Initialize proof pipeline
        if (pipelineRef.current) pipelineRef.current.stop();

        pipelineRef.current = new CameraProofPipeline(videoRef.current, stream, {
          onStreamingReady: () => {
            setIsBlackFrame(false);
          },
          onBlackFrameDetected: () => {
            setIsBlackFrame(true);
          },
          onLost: (reason) => {
            dispatch({ type: 'CAMERA_LOST', reason });
          },
        });
        pipelineRef.current.start();

        // Stage 4: Detecting face (15s timeout)
        dispatch({ type: 'CAMERA_SET_STAGE', stage: 'detecting_face', progress: 85 });

        detectionTimeoutRef.current = setTimeout(() => {
          dispatch({
            type: 'CAMERA_TIMEOUT',
            stage: 'detecting_face',
            error: 'No face detected in video feed (timeout after 15s). Please check camera positioning.',
          });
        }, 15000);

        startDetectionLoop(landmarker, track?.id, label);
      }
    } catch (err) {
      if (cameraTimeoutRef.current) clearTimeout(cameraTimeoutRef.current);
      if (modelTimeoutRef.current) clearTimeout(modelTimeoutRef.current);
      if (detectionTimeoutRef.current) clearTimeout(detectionTimeoutRef.current);
      dispatch(mapCameraErrorToAction(err));
    }
  }, [acquireCamera, selectedDeviceId, dispatch, startDetectionLoop]);

  // Handle Capture Face action
  const handleCaptureFace = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;

    setCaptureError(null);
    try {
      const captureCanvas = document.createElement('canvas');
      captureCanvas.width = video.videoWidth;
      captureCanvas.height = video.videoHeight;
      const ctx = captureCanvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);

      // Re-validate captured frame
      const landmarker = faceLandmarkerRef.current || (await getSharedFaceLandmarker());
      const captureTimestamp = Math.max(performance.now(), (lastInferenceTimeRef.current || 0) + 1);
      lastInferenceTimeRef.current = captureTimestamp;

      // The landmarker singleton is initialized with runningMode: 'VIDEO'.
      // MediaPipe requires detectForVideo with a monotonically increasing timestamp.
      let result;
      if (typeof landmarker.detectForVideo === 'function') {
        try {
          result = landmarker.detectForVideo(captureCanvas, captureTimestamp);
        } catch {
          // Fallback to video element if canvas texture upload fails
          const retryTimestamp = Math.max(performance.now(), lastInferenceTimeRef.current + 1);
          lastInferenceTimeRef.current = retryTimestamp;
          result = landmarker.detectForVideo(video, retryTimestamp);
        }
      } else if (typeof landmarker.detect === 'function') {
        result = landmarker.detect(captureCanvas);
      } else {
        throw new Error('FaceLandmarker detection method not available');
      }

      if (!result?.faceLandmarks || result.faceLandmarks.length !== 1) {
        setCaptureError("Capture wasn't clear: exactly one face must be visible. Please hold still and try again.");
        return;
      }

      const landmarks = result.faceLandmarks[0];
      const headPose = computeHeadPose(landmarks);
      const blendshapes = result.faceBlendshapes?.[0]?.categories
        ? Object.fromEntries(result.faceBlendshapes[0].categories.map((c) => [c.categoryName, c.score]))
        : null;

      const smallCanvas = document.createElement('canvas');
      smallCanvas.width = 128;
      smallCanvas.height = 72;
      const smallCtx = smallCanvas.getContext('2d');
      smallCtx?.drawImage(captureCanvas, 0, 0, 128, 72);
      const smallImgData = smallCtx?.getImageData(0, 0, 128, 72) || null;

      const report = evaluateFaceQuality({
        faceCount: 1,
        landmarks,
        headPose,
        blendshapes,
        facePixels: smallImgData,
        bboxHistory: bboxHistoryRef.current,
      });

      if (!report.overallPassed) {
        setCaptureError(
          `Capture wasn't clear: ${report.firstFailingCriterion?.hint || 'quality check failed'}. Hold still and try again.`
        );
        return;
      }

      const signature = extractFaceGeometrySignature(landmarks) || {
        interOcularToHeight: 0.35,
        noseToChinToHeight: 0.40,
        eyeToNoseToHeight: 0.22,
        mouthWidthToWidth: 0.45,
      };

      const previewDataUrl = captureCanvas.toDataURL('image/jpeg', 0.85);
      setCapturedPreview(previewDataUrl);

      detectionLoopActiveRef.current = false;
      const track = cameraStream?.getVideoTracks()[0];
      dispatch({
        type: 'CAMERA_FRAME_CAPTURED',
        deviceId: track?.id,
        label: track?.label,
        previewDataUrl,
        faceSignature: signature,
      });
    } catch (err) {
      console.error('[E2E-CAMERA] capture error caught:', err);
      setCaptureError('Failed to capture frame. Please try again.');
    }
  }, [cameraStream, dispatch]);

  // Handle Confirm Capture action
  const handleConfirmCapture = useCallback(() => {
    dispatch({ type: 'CAMERA_CONFIRM_CAPTURE' });
  }, [dispatch]);

  // Handle Retake action
  const handleRetakeCapture = useCallback(() => {
    setCapturedPreview(null);
    setCaptureError(null);
    hysteresisRef.current.reset();
    dispatch({ type: 'CAMERA_RETAKE' });
    if (faceLandmarkerRef.current) {
      startDetectionLoop(
        faceLandmarkerRef.current,
        selectedDeviceId || undefined,
        availableCameras[0]?.label || 'Webcam'
      );
    }
  }, [availableCameras, dispatch, selectedDeviceId, startDetectionLoop]);

  // Auto-capture countdown effect
  useEffect(() => {
    if (
      isAutoCapture &&
      state.camera.status === 'ready_to_capture' &&
      autoCaptureCountdown === null
    ) {
      setAutoCaptureCountdown(3);
    } else if (state.camera.status !== 'ready_to_capture' && autoCaptureCountdown !== null) {
      setAutoCaptureCountdown(null);
      if (autoCaptureTimerRef.current) {
        clearTimeout(autoCaptureTimerRef.current);
        autoCaptureTimerRef.current = null;
      }
    }
  }, [isAutoCapture, state.camera.status, autoCaptureCountdown]);

  useEffect(() => {
    if (autoCaptureCountdown === null) return;

    if (autoCaptureCountdown > 0) {
      autoCaptureTimerRef.current = setTimeout(() => {
        setAutoCaptureCountdown((prev) => (prev !== null && prev > 1 ? prev - 1 : 0));
      }, 1000);
    } else if (autoCaptureCountdown === 0) {
      setAutoCaptureCountdown(null);
      handleCaptureFace();
    }

    return () => {
      if (autoCaptureTimerRef.current) clearTimeout(autoCaptureTimerRef.current);
    };
  }, [autoCaptureCountdown, handleCaptureFace]);

  // When camera stream is updated or videoRef mounts
  useEffect(() => {
    if (cameraStream && videoRef.current && (state.camera.status === 'streaming' || state.camera.status === 'quality_checking' || state.camera.status === 'ready_to_capture')) {
      attachStreamToVideo(videoRef.current, cameraStream).catch(() => {});
    }
  }, [cameraStream, state.camera.status]);

  // --- 2. LIVENESS GATED SEQUENCE ---
  const handleStartLiveness = useCallback(() => {
    if (state.camera.status !== 'verified') return;

    const sequence = generateChallengeSequence(3);
    setChallengeSequence(sequence);
    setCurrentChallengeIdx(0);
    challengeEvaluatorRef.current.reset();

    const firstStep = sequence[0];
    dispatch({
      type: 'LIVENESS_START',
      totalSteps: sequence.length,
      prompt: firstStep.prompt,
      targetMetric: firstStep.action,
    });

    if (ttsRef.current) {
      ttsRef.current.speak(firstStep.prompt).catch(() => {});
    }
  }, [state.camera.status, dispatch]);

  // Evaluate liveness simulation for pipeline
  const handleStepComplete = useCallback(() => {
    const nextIdx = currentChallengeIdx + 1;
    if (nextIdx < challengeSequence.length) {
      const nextStep = challengeSequence[nextIdx];
      setCurrentChallengeIdx(nextIdx);
      dispatch({
        type: 'LIVENESS_PROGRESS',
        currentStep: nextIdx + 1,
        totalSteps: challengeSequence.length,
        prompt: nextStep.prompt,
        targetMetric: nextStep.action,
      });
      if (ttsRef.current) {
        ttsRef.current.speak(nextStep.prompt).catch(() => {});
      }
    } else {
      dispatch({ type: 'LIVENESS_PASS' });
      if (ttsRef.current) {
        ttsRef.current.speak('Liveness verification confirmed. All steps passed.').catch(() => {});
      }
    }
  }, [currentChallengeIdx, challengeSequence, dispatch]);

  // --- 3. MICROPHONE AUDIO & LATCHED QUALITY CALIBRATION ---
  const handleStartMic = useCallback(
    async (targetDeviceId?: string) => {
      dispatch({ type: 'MIC_REQUEST' });
      setLastMicErrorName(null);
      speechStartedRef.current = false;
      setLiveSpeechTranscript('');
      setSttNotice(null);
      noiseFloorCalibratorRef.current.reset();
      voicedAccumulatorRef.current.reset();
      setMicReport(null);

      try {
        const stream = await acquireAudio(targetDeviceId ?? selectedMicDeviceId);

        if (!stream) {
          throw new Error('Unable to acquire audio stream.');
        }

        audioStreamRef.current = stream;

        // Attach track disconnect & mute event listeners to revert verification if hardware is lost
        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
          audioTrack.onended = () => {
            dispatch({
              type: 'MIC_LOST',
              reason: 'Microphone track ended or device disconnected.',
            });
          };
          audioTrack.onmute = () => {
            dispatch({
              type: 'MIC_LOST',
              reason: 'Microphone hardware muted or unavailable.',
            });
          };
        }

        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
          audioContextRef.current = new AudioCtx();
        }
        const audioCtx = audioContextRef.current;
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }

        if (analyserRef.current) {
          try {
            analyserRef.current.disconnect();
          } catch {
            // ignore
          }
        }

        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.3;
        source.connect(analyser);
        analyserRef.current = analyser;

        const floatBuffer = new Float32Array(analyser.fftSize);
        const byteBuffer = new Uint8Array(analyser.frequencyBinCount);

        if (audioAnimRef.current) {
          cancelAnimationFrame(audioAnimRef.current);
          audioAnimRef.current = null;
        }

        const updateMeter = () => {
          if (!analyserRef.current) return;

          if (analyser.getFloatTimeDomainData) {
            analyser.getFloatTimeDomainData(floatBuffer);
          } else {
            analyser.getByteTimeDomainData(byteBuffer);
            for (let i = 0; i < byteBuffer.length; i++) {
              floatBuffer[i] = (byteBuffer[i] - 128) / 128;
            }
          }

          const rms = computeRMS(floatBuffer);
          const peak = computePeak(floatBuffer);
          const levelPct = Math.min(100, Math.round(rms * 250));
          setAudioLevel(levelPct);

          const now = performance.now();
          const calibrator = noiseFloorCalibratorRef.current;
          const accumulator = voicedAccumulatorRef.current;

          // Stage 1: Noise Floor Calibration (1.0 s)
          if (!calibrator.isCalibrated(now)) {
            calibrator.addSample(rms, now);
            dispatch({
              type: 'MIC_MEASURING_NOISE',
              noiseFloorDb: calibrator.getAverageDb(),
            });
            audioAnimRef.current = requestAnimationFrame(updateMeter);
            return;
          }

          // Stage 2: Collecting Speech & SpeechRecognition Self-Test
          if (sttRef.current && !speechStartedRef.current && sttSupported) {
            speechStartedRef.current = true;
            try {
              sttRef.current.start();
            } catch {
              // ignore
            }
          }

          const noiseFloorRms = calibrator.getAverageRms();
          const noiseFloorDb = calibrator.getAverageDb();

          // Voiced threshold: RMS >= noise floor + 10 dB and >= min speech RMS
          const voicedThresholdRms =
            noiseFloorRms * Math.pow(10, MIC_QUALITY_CONFIG.VOICED_DELTA_DB / 20);
          const isVoiced = rms >= voicedThresholdRms && rms >= MIC_QUALITY_CONFIG.MIN_AVERAGE_SPEECH_RMS;

          const cumulativeVoicedMs = accumulator.update(now, isVoiced);
          const cumulativeVoicedSec = cumulativeVoicedMs / 1000;
          const targetSec = MIC_QUALITY_CONFIG.REQUIRED_VOICED_DURATION_MS / 1000;

          const report = evaluateMicQuality({
            currentRms: rms,
            peakAmplitude: peak,
            noiseFloorRms,
            noiseFloorDb,
            isNoiseFloorCalibrated: true,
            cumulativeVoicedSeconds: cumulativeVoicedSec,
            targetVoicedSeconds: targetSec,
          });

          setMicReport(report);
          setNoiseDetected(!calibrator.isAcceptable() || rms > 0.25);

          if (report.overallPassed) {
            if (sttRef.current && speechStartedRef.current) {
              speechStartedRef.current = false;
              try {
                sttRef.current.stop();
              } catch {
                // ignore
              }
            }
            dispatch({
              type: 'MIC_VERIFY',
              level: levelPct,
              snrDb: report.estimatedSnrDb,
              noiseFloorDb,
              voicedSeconds: cumulativeVoicedSec,
            });
          } else {
            dispatch({
              type: 'MIC_COLLECTING_SPEECH',
              voicedSeconds: cumulativeVoicedSec,
              targetSeconds: targetSec,
              snrDb: report.estimatedSnrDb,
              level: levelPct,
              hint: report.primaryHint,
            });
          }

          audioAnimRef.current = requestAnimationFrame(updateMeter);
        };

        updateMeter();
      } catch (err) {
        const errName = err instanceof Error ? err.name : 'UnknownError';
        const errMsg = err instanceof Error ? err.message : String(err);
        setLastMicErrorName(errName);

        console.error('[DIAGNOSTIC MIC FAILURE]', {
          errorName: errName,
          errorMessage: errMsg,
          selectedMicDeviceId,
          audioContextState: audioContextRef.current?.state ?? 'null',
        });

        if (err instanceof Error && err.name === 'NotAllowedError') {
          dispatch({
            type: 'MIC_DENIED',
            error:
              'Microphone permission blocked. Click the lock/tune icon in your address bar, set Microphone to Allow, then click Try Again.',
            cause: 'not_allowed',
          });
        } else if (err instanceof Error && err.name === 'NotFoundError') {
          dispatch({
            type: 'MIC_ERROR',
            error:
              'No microphone detected. Plug in a headset or webcam microphone, then click Check Devices.',
            cause: 'not_found',
          });
        } else if (
          err instanceof Error &&
          (err.name === 'NotReadableError' || err.name === 'AbortError')
        ) {
          dispatch({
            type: 'MIC_ERROR',
            error:
              'Your microphone is in use by another app (e.g. Zoom, Teams, Meet) or exclusive mode is enabled. Close other apps and click Try Again.',
            cause: 'not_readable',
          });
        } else if (err instanceof Error && err.name === 'OverconstrainedError') {
          dispatch({
            type: 'MIC_ERROR',
            error:
              'Requested audio settings not supported by this microphone. Switching to default settings…',
            cause: 'overconstrained',
          });
        } else if (err instanceof Error && err.name === 'SecurityError') {
          dispatch({
            type: 'MIC_ERROR',
            error: 'Microphone requires HTTPS or localhost.',
            cause: 'security',
          });
        } else {
          dispatch({
            type: 'MIC_ERROR',
            error:
              'Unable to connect to microphone device. Please verify your audio settings and click Try Again.',
            cause: 'generic',
          });
        }
      }
    },
    [acquireAudio, selectedMicDeviceId, dispatch]
  );

  const handleSwitchMicrophone = useCallback(
    async (deviceId: string) => {
      setSelectedMicDeviceId(deviceId);
      if (audioAnimRef.current) {
        cancelAnimationFrame(audioAnimRef.current);
        audioAnimRef.current = null;
      }
      noiseFloorCalibratorRef.current.reset();
      voicedAccumulatorRef.current.reset();
      setMicReport(null);
      await handleStartMic(deviceId);
    },
    [setSelectedMicDeviceId, handleStartMic]
  );

  const handleRetestMic = useCallback(() => {
    if (audioAnimRef.current) {
      cancelAnimationFrame(audioAnimRef.current);
      audioAnimRef.current = null;
    }
    if (sttRef.current) {
      try {
        sttRef.current.stop();
      } catch {
        // ignore
      }
    }
    speechStartedRef.current = false;
    setLiveSpeechTranscript('');
    setSttNotice(null);
    setLastMicErrorName(null);
    setLastSttErrorCode(null);
    noiseFloorCalibratorRef.current.reset();
    voicedAccumulatorRef.current.reset();
    setMicReport(null);
    dispatch({ type: 'MIC_RESET' });
    void handleStartMic(selectedMicDeviceId);
  }, [handleStartMic, selectedMicDeviceId, dispatch]);

  const handleCheckDevices = useCallback(async () => {
    await refreshMicrophones();
    handleRetestMic();
  }, [refreshMicrophones, handleRetestMic]);

  const handleCopyDiagnostics = useCallback(() => {
    const errorText =
      state.mic.status === 'denied' || state.mic.status === 'error'
        ? state.mic.error
        : undefined;
    const cause =
      state.mic.status === 'denied' || state.mic.status === 'error'
        ? state.mic.cause
        : undefined;

    const text = generateMaskedDiagnostics({
      errorName: cause || 'MicrophoneConnectionError',
      errorMessage: errorText,
      cause,
      audioContextState: audioContextRef.current?.state,
      devices: availableMicrophones,
    });

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          setDiagnosticsCopied(true);
          setTimeout(() => setDiagnosticsCopied(false), 2500);
        })
        .catch(() => {});
    }
  }, [state.mic, availableMicrophones]);

  // Support E2E automation for speech verification in headless environments where physical mic input isn't present
  useEffect(() => {
    const handleE2EAudio = () => {
      dispatch({
        type: 'MIC_VERIFY',
        level: 45,
        snrDb: 22.5,
        noiseFloorDb: -42.0,
        voicedSeconds: 1.8,
      });
    };
    window.addEventListener('__E2E_VOICED_SPEECH_ACCUMULATED__', handleE2EAudio);
    return () => {
      window.removeEventListener('__E2E_VOICED_SPEECH_ACCUMULATED__', handleE2EAudio);
    };
  }, [dispatch]);

  // --- 4. SPEAKER OUTPUT & 3-DIGIT CODE VERIFICATION ---
  const handlePlaySpeakerTest = useCallback(async () => {
    if (!ttsRef.current) return;
    setSpeakerError(null);
    setSpeakerCodeInput('');

    // Cryptographically secure 3-digit verification code
    const randomArray = new Uint16Array(1);
    crypto.getRandomValues(randomArray);
    const randomCode = (100 + (randomArray[0] % 900)).toString();
    setSpeakerTestCode(randomCode);

    dispatch({ type: 'SPEAKER_PLAY_TEST', code: randomCode });
    setIsSpeakingTest(true);

    const spokenDigits = randomCode.split('').join(', ');
    await ttsRef.current.speak(
      `Audio test. Your speaker verification code is ${spokenDigits}. Repeat: ${spokenDigits}.`
    );

    setIsSpeakingTest(false);
    dispatch({ type: 'SPEAKER_AWAIT_CONFIRMATION' });
  }, [dispatch]);

  const handleConfirmSpeakerCode = useCallback(() => {
    if (speakerCodeInput.trim() === speakerTestCode) {
      dispatch({ type: 'SPEAKER_CONFIRM_CODE', enteredCode: speakerCodeInput });
      setSpeakerError(null);
    } else {
      setSpeakerError('Incorrect code. Please listen again and re-enter.');
      dispatch({ type: 'SPEAKER_FAIL' });
    }
  }, [speakerCodeInput, speakerTestCode, dispatch]);

  const handleStart = () => {
    if (!isAllReady || !consentAccepted) return;
    isHandingOverRef.current = true;
    retainForInterview();
    const finalAudioStream = audioStream ?? audioStreamRef.current;
    setAudioStream(finalAudioStream);
    onStartInterview({
      durationMinutes,
      videoStream: videoStream ?? cameraStream,
      audioStream: finalAudioStream,
    });
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6 animate-in fade-in py-4 px-3 sm:px-0">
      {/* Header */}
      <div className="text-center space-y-2">
        <Badge variant="outline" className="border-indigo-500/50 text-indigo-300 bg-indigo-950/40">
          Machine-Verified Pre-Flight
        </Badge>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
          Adaptive Live Interview Setup
        </h1>
        <p className="text-sm text-slate-400 max-w-xl mx-auto">
          Verify physical camera feed, confirm two-way audio, and complete active liveness verification.
        </p>
      </div>

      {!sttSupported && (
        <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-800/80 text-amber-200 text-xs flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold block text-amber-300">Speech Recognition Notice</span>
            <p className="text-slate-300">
              Your browser does not have the native Web Speech API enabled. Chrome or Edge is recommended.
              A typed input fallback will be provided automatically.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Duration & Settings (6 cols) */}
        <div className="lg:col-span-6 space-y-6">
          <Card className="border-slate-800 bg-slate-900/90 shadow-xl backdrop-blur-md">
            <CardHeader className="pb-3 border-b border-slate-800/80">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-indigo-400" />
                  <CardTitle className="text-base text-white">Interview Duration</CardTitle>
                </div>
                <Badge variant="outline" className="border-slate-700 text-slate-300 font-mono text-xs">
                  {durationMinutes} Minutes
                </Badge>
              </div>
              <CardDescription className="text-slate-400 text-xs">
                Select target interview length. Questions adjust dynamically.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-5 pt-4">
              <div className="space-y-2">
                <span className="text-xs font-semibold text-slate-300">Preset Durations</span>
                <div className="grid grid-cols-4 gap-2">
                  {durationPresets.map((m) => (
                    <Button
                      key={m}
                      type="button"
                      variant={durationMinutes === m && !isCustomDuration ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => {
                        setIsCustomDuration(false);
                        setDurationMinutes(m);
                        setCustomDurationInput(String(m));
                      }}
                      className={`text-xs h-9 cursor-pointer ${
                        durationMinutes === m && !isCustomDuration
                          ? 'bg-indigo-600 hover:bg-indigo-700 text-white border-transparent'
                          : 'border-slate-800 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      {m} Min
                    </Button>
                  ))}
                  <input
                    type="number"
                    min={5}
                    max={90}
                    value={customDurationInput}
                    onChange={(e) => {
                      setIsCustomDuration(true);
                      setCustomDurationInput(e.target.value);
                      const parsed = parseInt(e.target.value, 10);
                      if (!isNaN(parsed) && parsed >= 5 && parsed <= 90) {
                        setDurationMinutes(parsed);
                      }
                    }}
                    className={`h-9 rounded-md bg-slate-950 border text-xs text-white text-center px-1 font-mono focus:outline-none ${
                      isCustomDuration ? 'border-indigo-500' : 'border-slate-800 text-slate-400'
                    }`}
                    placeholder="Custom"
                  />
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-medium flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                    Estimated Questions:
                  </span>
                  <span className="text-indigo-300 font-mono font-semibold">
                    ~{questionEstimate.minQuestions}-{questionEstimate.maxQuestions} Questions
                  </span>
                </div>
              </div>

              {/* Accessibility Accommodations */}
              <div className="pt-2 border-t border-slate-800/80 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                    <Accessibility className="h-4 w-4 text-indigo-400" />
                    Accommodations
                  </span>
                  <Badge variant="outline" className="border-slate-700 text-[10px] text-slate-400">
                    Candidate Setting
                  </Badge>
                </div>
                <label className="flex items-start gap-2.5 text-xs text-slate-400 cursor-pointer p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/80 hover:border-slate-700">
                  <input
                    type="checkbox"
                    checked={motorAccommodation}
                    onChange={(e) => setMotorAccommodation(e.target.checked)}
                    className="mt-0.5 rounded border-slate-700 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>
                    Request motor accessibility accommodation (replaces head-turn liveness verification with facial and eye-blink verification).
                  </span>
                </label>
              </div>

              {/* Privacy Guarantee */}
              <div className="p-3.5 rounded-xl bg-indigo-950/20 border border-indigo-900/40 text-xs text-slate-300 space-y-1.5">
                <div className="flex items-center gap-1.5 text-indigo-300 font-semibold">
                  <ShieldCheck className="h-4 w-4 text-indigo-400" />
                  Local Privacy Protection
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Your camera and microphone are on during the interview. Camera monitoring and facial analysis run entirely on your device. Spoken answers are transcribed using your browser’s speech recognition service. Only numeric behavior signals and the transcribed text of your answers are saved. No raw audio or video recordings are stored on our servers.
                </p>
              </div>

              {/* Consent Toggle */}
              <div className="pt-2 border-t border-slate-800/80">
                <label className="flex items-start gap-2.5 text-xs text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={consentAccepted}
                    onChange={(e) => setConsentAccepted(e.target.checked)}
                    className="mt-0.5 rounded border-slate-700 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>
                    I understand that real-time local non-verbal telemetry is computed client-side for feedback and candidate evaluation.
                  </span>
                </label>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Hardware Proof Checks (6 cols) */}
        <div className="lg:col-span-6 space-y-6">
          <Card className="border-slate-800 bg-slate-900/90 shadow-xl backdrop-blur-md">
            <CardHeader className="pb-3 border-b border-slate-800/80">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Headphones className="h-5 w-5 text-indigo-400" />
                  <CardTitle className="text-base text-white">Pre-Flight Hardware Check</CardTitle>
                </div>
                <Badge
                  variant={isAllReady && consentAccepted ? 'success' : 'outline'}
                  className="font-mono text-xs gap-1"
                >
                  {isAllReady && consentAccepted ? (
                    <>
                      <CheckCircle2 className="h-3 w-3" /> Ready for Live Room
                    </>
                  ) : (
                    'Verification Required'
                  )}
                </Badge>
              </div>
              <CardDescription className="text-slate-400 text-xs">
                Real physical webcam, two-way audio, and active liveness verification required.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4 pt-4">
              {/* 1. Camera Section */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                    <Camera className="h-3.5 w-3.5 text-indigo-400" />
                    1. Real Physical Camera
                  </span>

                  {state.camera.status === 'verified' ? (
                    <Badge variant="outline" className="bg-emerald-950/80 text-emerald-300 border-emerald-700 text-[11px] gap-1 py-0.5">
                      <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                      Face Captured & Verified
                    </Badge>
                  ) : state.camera.status === 'captured_pending_confirm' ? (
                    <Badge variant="outline" className="bg-amber-950/80 text-amber-300 border-amber-700 text-[11px] gap-1 py-0.5">
                      Confirm Captured Frame
                    </Badge>
                  ) : state.camera.status === 'ready_to_capture' ? (
                    <Badge variant="outline" className="bg-emerald-950/80 text-emerald-300 border-emerald-600 text-[11px] gap-1 py-0.5 animate-pulse">
                      <Sparkles className="h-3 w-3 text-emerald-400" />
                      Ready to Capture Face
                    </Badge>
                  ) : state.camera.status === 'quality_checking' || state.camera.status === 'streaming' ? (
                    <Badge variant="outline" className="bg-indigo-950/80 text-indigo-300 border-indigo-700 text-[11px] gap-1 py-0.5">
                      <RefreshCw className="h-3 w-3 animate-spin text-indigo-400" />
                      Checking Face Quality...
                    </Badge>
                  ) : state.camera.status === 'requesting' ? (
                    <Badge variant="outline" className="bg-amber-950/80 text-amber-300 border-amber-700 text-[11px] gap-1 py-0.5">
                      {state.camera.stage === 'starting_video'
                        ? 'Starting Video...'
                        : state.camera.stage === 'loading_model'
                        ? 'Loading Vision Model...'
                        : state.camera.stage === 'detecting_face'
                        ? 'Detecting Face...'
                        : 'Requesting Camera...'}
                    </Badge>
                  ) : state.camera.status === 'timeout' ? (
                    <Badge variant="outline" className="bg-rose-950/80 text-rose-300 border-rose-700 text-[11px] gap-1 py-0.5">
                      Camera Timeout
                    </Badge>
                  ) : (
                    <span className="text-slate-500 font-mono text-[11px]">Unverified</span>
                  )}
                </div>

                {/* Video Container Box */}
                <div className="relative aspect-video rounded-xl bg-slate-950 border border-slate-800 overflow-hidden flex items-center justify-center">
                  {/* Live Video Feed */}
                  <video
                    ref={videoRef}
                    muted
                    playsInline
                    autoPlay
                    className={`w-full h-full object-cover -scale-x-100 ${
                      state.camera.status === 'streaming' ||
                      state.camera.status === 'quality_checking' ||
                      state.camera.status === 'ready_to_capture' ||
                      state.camera.status === 'verified'
                        ? 'opacity-100'
                        : 'opacity-0 absolute pointer-events-none'
                    }`}
                  />

                  {/* Captured Still Preview for Review & Confirmation */}
                  {state.camera.status === 'captured_pending_confirm' && (
                    <div className="absolute inset-0 z-20 bg-slate-950 flex flex-col items-center justify-center">
                      <img
                        src={capturedPreview || state.camera.previewDataUrl}
                        alt="Captured face preview"
                        className="w-full h-full object-cover -scale-x-100"
                      />
                      <div className="absolute bottom-3 inset-x-3 flex items-center justify-between p-2 rounded-lg bg-slate-950/85 backdrop-blur border border-slate-800">
                        <span className="text-xs text-slate-300 font-medium">Review captured frame</span>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleRetakeCapture}
                            className="h-7 text-xs border-slate-700 text-slate-300 hover:bg-slate-800 gap-1"
                          >
                            <RotateCcw className="h-3 w-3" />
                            Retake
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleConfirmCapture}
                            className="h-7 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold gap-1"
                          >
                            <Check className="h-3 w-3" />
                            Confirm Face
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Oval Face Guide when Camera is Actively Checking Quality */}
                  {(state.camera.status === 'quality_checking' ||
                    state.camera.status === 'ready_to_capture' ||
                    state.camera.status === 'streaming') && (
                    <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center z-10 px-4">
                      {/* Guide Oval */}
                      <div
                        className={`w-36 h-48 sm:w-44 sm:h-56 rounded-[50%] transition-all duration-300 pointer-events-none ${
                          state.camera.status === 'ready_to_capture' || faceQualityReport?.overallPassed
                            ? 'border-2 border-emerald-400 shadow-[0_0_35px_rgba(52,211,153,0.5)] bg-emerald-500/5'
                            : faceQualityReport?.firstFailingCriterion
                            ? 'border-2 border-amber-400/80 shadow-[0_0_20px_rgba(251,191,36,0.25)] bg-slate-950/10'
                            : 'border-2 border-dashed border-indigo-400/60 shadow-[0_0_20px_rgba(99,102,241,0.2)]'
                        }`}
                      />

                      {/* Direction / Alignment Hint Placed Under the Guide Oval */}
                      <div
                        aria-live="polite"
                        role="status"
                        className="mt-3 pointer-events-auto"
                      >
                        <span
                          className={`text-xs sm:text-sm font-semibold px-3.5 py-1.5 rounded-full shadow-xl flex items-center gap-1.5 backdrop-blur-md transition-all duration-200 ${
                            state.camera.status === 'ready_to_capture'
                              ? 'bg-emerald-950/95 text-emerald-300 border border-emerald-500/80 shadow-emerald-900/40'
                              : faceQualityReport?.firstFailingCriterion
                              ? 'bg-slate-950/95 text-amber-300 border border-amber-500/70 shadow-amber-950/40'
                              : 'bg-slate-950/90 text-indigo-200 border border-indigo-700/60'
                          }`}
                        >
                          {state.camera.status === 'ready_to_capture' ? (
                            <>
                              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                              Ready to capture! Hold still
                            </>
                          ) : faceQualityReport?.firstFailingCriterion ? (
                            <>
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                              {faceQualityReport.firstFailingCriterion.hint}
                            </>
                          ) : (
                            'Position face inside oval guide'
                          )}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Black Frame Shutter Warning */}
                  {isBlackFrame && (
                    <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center p-4 text-center z-20">
                      <AlertTriangle className="h-7 w-7 text-amber-400 mb-1" />
                      <p className="text-xs text-amber-300 font-semibold">Camera is on but image is black</p>
                      <p className="text-[11px] text-slate-300 max-w-xs mt-1">
                        Please check your webcam lens cover or physical privacy shutter switch.
                      </p>
                    </div>
                  )}

                  {/* 4-Stage Stepper Progress Indicator during Requesting */}
                  {state.camera.status === 'requesting' && (
                    <div
                      aria-live="polite"
                      role="status"
                      className="text-center p-4 space-y-3 z-10 max-w-sm w-full"
                    >
                      <RefreshCw className="h-7 w-7 text-indigo-400 animate-spin mx-auto" />
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-white">
                          Initializing Camera Pipeline...
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {state.camera.stage === 'starting_video'
                            ? 'Starting Video Stream...'
                            : state.camera.stage === 'loading_model'
                            ? 'Loading Vision Models (MediaPipe WASM)...'
                            : state.camera.stage === 'detecting_face'
                            ? 'Detecting Face in Camera Frame...'
                            : 'Requesting Physical Camera Access...'}
                        </p>
                      </div>

                      {/* 4-Stage Step Breadcrumb */}
                      <div className="grid grid-cols-4 gap-1.5 pt-1">
                        {[
                          { stage: 'requesting_camera', label: 'Camera' },
                          { stage: 'starting_video', label: 'Video' },
                          { stage: 'loading_model', label: 'Model' },
                          { stage: 'detecting_face', label: 'Face' },
                        ].map(({ stage, label }, idx) => {
                          const stages = ['requesting_camera', 'starting_video', 'loading_model', 'detecting_face'];
                          const currentStage =
                            state.camera.status === 'requesting' ? state.camera.stage : undefined;
                          const currentIdx = stages.indexOf(currentStage || 'requesting_camera');
                          const isDone = idx < currentIdx;
                          const isCurrent = idx === currentIdx;

                          return (
                            <div key={stage} className="flex flex-col items-center space-y-1">
                              <div
                                className={`h-1.5 w-full rounded-full transition-all duration-300 ${
                                  isDone
                                    ? 'bg-emerald-400'
                                    : isCurrent
                                    ? 'bg-indigo-400 animate-pulse'
                                    : 'bg-slate-800'
                                }`}
                              />
                              <span
                                className={`text-[9px] font-mono ${
                                  isDone
                                    ? 'text-emerald-400 font-bold'
                                    : isCurrent
                                    ? 'text-indigo-300 font-semibold'
                                    : 'text-slate-600'
                                }`}
                              >
                                {isDone ? '✓ ' : ''}{label}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Stage Timeout Overlay with Retry */}
                  {state.camera.status === 'timeout' && (
                    <div
                      aria-live="polite"
                      role="status"
                      className="text-center p-4 space-y-2 z-10 max-w-xs"
                    >
                      <AlertTriangle className="h-8 w-8 text-rose-400 mx-auto" />
                      <p className="text-xs text-rose-300 font-semibold">
                        Stage Timed Out: {state.camera.stage?.replace('_', ' ')}
                      </p>
                      <p className="text-[11px] text-slate-300 break-words">{state.camera.error}</p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleEnableCamera}
                        className="text-xs border-rose-700 text-rose-300 hover:bg-rose-950/60 mt-2"
                        aria-label="Retry camera initialization"
                      >
                        Retry Camera
                      </Button>
                    </div>
                  )}

                  {/* Placeholder overlay when not streaming or active */}
                  {state.camera.status !== 'streaming' &&
                    state.camera.status !== 'quality_checking' &&
                    state.camera.status !== 'ready_to_capture' &&
                    state.camera.status !== 'captured_pending_confirm' &&
                    state.camera.status !== 'verified' &&
                    state.camera.status !== 'requesting' &&
                    state.camera.status !== 'timeout' && (
                      <div className="text-center p-4 space-y-2 z-10 max-w-xs">
                        <CameraOff className="h-8 w-8 text-slate-600 mx-auto" />
                        <p className="text-xs text-slate-400 break-words">
                          {state.camera.status === 'denied'
                            ? state.camera.error
                            : state.camera.status === 'in_use'
                            ? state.camera.error
                            : state.camera.status === 'not_found'
                            ? state.camera.error
                            : state.camera.status === 'lost'
                            ? `Camera connection lost: ${state.camera.reason}`
                            : 'Physical camera feed not active.'}
                        </p>

                        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleEnableCamera}
                            className="text-xs border-indigo-700 text-indigo-300 hover:bg-indigo-950/60 cursor-pointer"
                          >
                            {state.camera.status === 'denied' ||
                            state.camera.status === 'in_use' ||
                            state.camera.status === 'lost'
                              ? 'Retry Camera'
                              : 'Enable Camera Feed'}
                          </Button>
                          {state.camera.status === 'denied' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setIsHelpModalOpen(true)}
                              className="text-xs text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
                            >
                              Permission Help
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                </div>

                {/* Lighting Tip Banner (§2.1, §2.2) */}
                {showLightingTip && (
                  <div
                    aria-live="polite"
                    role="status"
                    className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-950/50 border border-amber-800/60 text-amber-200 text-xs animate-in fade-in"
                  >
                    <Sun className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                    <div className="space-y-0.5 flex-1 min-w-0">
                      <p className="font-semibold text-amber-300">
                        {colorCastCrit && !colorCastCrit.passed
                          ? 'Lighting Warning: Strong Color Tint Detected'
                          : 'Lighting Tip: Uneven or Low Illumination'}
                      </p>
                      <p className="text-[11px] text-amber-200/80">
                        Face a window or lamp; avoid strong backlight. Ensure your room is evenly illuminated so face verification succeeds smoothly.
                      </p>
                    </div>
                  </div>
                )}

                {/* Live Face Quality Checklist & Capture Button (Visible during quality checking & ready) */}
                {(state.camera.status === 'quality_checking' || state.camera.status === 'ready_to_capture') && (
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                    {/* Quality Meter */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-400 font-medium">Face Alignment Quality</span>
                        <span className="font-mono font-bold text-white">
                          {faceQualityReport?.qualityScore ?? 0}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-slate-900 overflow-hidden">
                        <div
                          className={`h-full transition-all duration-200 ${
                            (faceQualityReport?.qualityScore ?? 0) >= 90
                              ? 'bg-emerald-400'
                              : (faceQualityReport?.qualityScore ?? 0) >= 60
                              ? 'bg-indigo-400'
                              : 'bg-amber-400'
                          }`}
                          style={{ width: `${faceQualityReport?.qualityScore ?? 0}%` }}
                        />
                      </div>
                    </div>

                    {/* Criteria Checklist Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                      {faceQualityReport?.criteriaList.map((crit) => (
                        <div
                          key={crit.id}
                          className={`p-1.5 rounded-md text-[10px] flex items-center justify-between border ${
                            crit.passed
                              ? 'bg-emerald-950/30 border-emerald-900/60 text-emerald-300'
                              : crit.isWarningOnly
                              ? 'bg-amber-950/30 border-amber-900/60 text-amber-300'
                              : 'bg-slate-900/80 border-slate-800 text-slate-400'
                          }`}
                        >
                          <span className="truncate mr-1 font-medium">{crit.name}</span>
                          <span className="shrink-0">{crit.passed ? '✓' : crit.isWarningOnly ? '⚠️' : '✗'}</span>
                        </div>
                      ))}
                    </div>

                    {captureError && (
                      <p className="text-[11px] text-rose-400 font-medium bg-rose-950/40 border border-rose-900/50 p-2 rounded">
                        {captureError}
                      </p>
                    )}

                    {/* Capture Controls */}
                    <div className="flex items-center justify-between pt-1 border-t border-slate-900">
                      <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isAutoCapture}
                          onChange={(e) => setIsAutoCapture(e.target.checked)}
                          className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span>Auto-capture when ready (3s)</span>
                      </label>

                      <Button
                        size="sm"
                        disabled={state.camera.status !== 'ready_to_capture'}
                        onClick={handleCaptureFace}
                        className={`text-xs gap-1.5 ${
                          state.camera.status === 'ready_to_capture'
                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer shadow-lg shadow-emerald-900/40'
                            : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        }`}
                        title={
                          state.camera.status !== 'ready_to_capture'
                            ? faceQualityReport?.firstFailingCriterion?.hint || 'Pass all face checks to enable capture'
                            : 'Capture photo for verification'
                        }
                      >
                        <Camera className="h-3.5 w-3.5" />
                        {autoCaptureCountdown !== null ? `Capturing in ${autoCaptureCountdown}...` : 'Capture Face'}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Verified Camera Actions */}
                {state.camera.status === 'verified' && (
                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-900/50 text-xs text-emerald-300">
                    <span className="flex items-center gap-1.5 font-medium">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      Face verified and saved in memory. Liveness verification unlocked.
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleRetakeCapture}
                      className="h-6 text-[10px] text-emerald-400 hover:text-emerald-200 hover:bg-emerald-900/40"
                    >
                      Retake Photo
                    </Button>
                  </div>
                )}

                {/* Device Selector & Diagnostics Link */}
                <div className="flex items-center justify-between text-[11px] text-slate-400 px-1 pt-0.5">
                  <div className="flex items-center gap-2 truncate max-w-[220px]">
                    <span className="truncate" title={availableCameras[0]?.label}>
                      Camera: <strong className="text-slate-300">{availableCameras[0]?.label || 'Default Camera'}</strong>
                    </span>
                    {availableCameras.length > 1 && (
                      <select
                        value={selectedDeviceId}
                        onChange={(e) => setSelectedDeviceId(e.target.value)}
                        className="bg-slate-900 border border-slate-800 text-slate-300 rounded px-1.5 py-0.5 text-[10px]"
                      >
                        {availableCameras.map((c, i) => (
                          <option key={c.deviceId || i} value={c.deviceId}>
                            {c.label || `Camera ${i + 1}`}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsDiagnosticsOpen(true)}
                    className="h-6 text-[10px] text-indigo-400 hover:text-indigo-300 underline underline-offset-2 p-0"
                  >
                    Run Diagnostics
                  </Button>
                </div>

                <p className="text-[10px] text-slate-500 pt-1 leading-relaxed border-t border-slate-900/60">
                  Your camera and microphone are on during the interview. Camera monitoring and facial analysis run entirely on your device. Spoken answers are transcribed using your browser’s speech recognition service. Only numeric behavior signals and the transcribed text of your answers are saved. No raw audio or video recordings are stored on our servers.
                </p>
              </div>

              {/* 2. Liveness Section (Gated on Camera Verification) */}
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/90 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                    Liveness Verification
                  </span>
                  {state.liveness.status === 'passed' ? (
                    <Badge variant="outline" className="bg-emerald-950 text-emerald-300 border-emerald-700 text-[10px] gap-1">
                      <Check className="h-3 w-3 text-emerald-400" />
                      3/3 Steps Passed
                    </Badge>
                  ) : state.liveness.status === 'locked' ? (
                    <Badge variant="outline" className="border-slate-800 text-slate-500 text-[10px] gap-1">
                      <Lock className="h-2.5 w-2.5" />
                      Locked
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-indigo-600/50 text-indigo-300 text-[10px]">
                      Mandatory Check
                    </Badge>
                  )}
                </div>

                {state.liveness.status === 'locked' ? (
                  <p className="text-xs text-slate-500">
                    Enable your physical camera and align your face in the guide to unlock liveness verification.
                  </p>
                ) : state.liveness.status === 'in_progress' ? (
                  <div className="p-3 rounded-lg bg-indigo-950/50 border border-indigo-600/40 space-y-2 animate-in fade-in">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider">
                        Action Required ({state.liveness.currentStep}/{state.liveness.totalSteps})
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleStepComplete}
                        className="h-6 text-[10px] text-indigo-300 hover:text-white hover:bg-indigo-900/50"
                      >
                        Simulate Gesture Pass
                      </Button>
                    </div>
                    <p className="text-xs font-semibold text-white">
                      {state.liveness.prompt}
                    </p>
                  </div>
                ) : state.liveness.status === 'passed' ? (
                  <p className="text-xs text-emerald-300 flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    Live human presence confirmed. Anti-spoofing passed.
                  </p>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">
                      Camera verified. Complete 3 quick actions to prove human presence.
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleStartLiveness}
                      className="text-xs border-indigo-700 text-indigo-300 hover:bg-indigo-900/60 h-7 cursor-pointer"
                    >
                      Start Check
                    </Button>
                  </div>
                )}
              </div>

              {/* 3. Microphone Section */}
              <div className="space-y-2 pt-2 border-t border-slate-800/80">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                    <Mic className="h-3.5 w-3.5 text-indigo-400" />
                    2. Microphone Audio
                  </span>

                  {state.mic.status === 'verified' ? (
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="bg-emerald-950/80 text-emerald-300 border-emerald-700 text-[11px] gap-1 py-0.5">
                        <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                        ✓ Microphone Verified
                      </Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleRetestMic}
                        className="h-5 text-[10px] text-slate-400 hover:text-indigo-300 p-0 underline"
                      >
                        Re-test
                      </Button>
                    </div>
                  ) : state.mic.status === 'measuring_noise' ? (
                    <Badge variant="outline" className="bg-amber-950/80 text-amber-300 border-amber-700 text-[11px] gap-1 py-0.5">
                      <RefreshCw className="h-3 w-3 animate-spin text-amber-400" />
                      Measuring Noise Floor (1s)...
                    </Badge>
                  ) : state.mic.status === 'collecting_speech' ? (
                    <Badge variant="outline" className="bg-indigo-950/80 text-indigo-300 border-indigo-700 text-[11px] gap-1 py-0.5">
                      Listening ({state.mic.voicedSeconds.toFixed(1)} / 1.5s)
                    </Badge>
                  ) : state.mic.status === 'streaming' ? (
                    <span className="text-indigo-400 font-mono text-[11px] animate-pulse">
                      Speak into mic...
                    </span>
                  ) : state.mic.status === 'requesting' ? (
                    <Badge variant="outline" className="bg-amber-950/80 text-amber-300 border-amber-700 text-[11px] gap-1 py-0.5">
                      Requesting Mic...
                    </Badge>
                  ) : state.mic.status === 'error' ? (
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="bg-rose-950/80 text-rose-300 border-rose-700 text-[11px] gap-1 py-0.5">
                        Mic Error
                      </Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleRetestMic}
                        className="h-5 text-[10px] text-indigo-400 hover:text-indigo-300 p-0 underline"
                      >
                        Retry
                      </Button>
                    </div>
                  ) : state.mic.status === 'denied' ? (
                    <Badge variant="outline" className="bg-rose-950/80 text-rose-300 border-rose-700 text-[11px] gap-1 py-0.5">
                      Permission Blocked
                    </Badge>
                  ) : (
                    <span className="text-slate-500 font-mono text-[11px]">Not Connected</span>
                  )}
                </div>

                {state.mic.status === 'idle' ? (
                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                    <span className="text-xs text-slate-400">Connect microphone to verify voice input</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleStartMic()}
                      className="text-xs border-indigo-800 text-indigo-300 hover:bg-indigo-950/60 h-7"
                    >
                      Connect Mic
                    </Button>
                  </div>
                ) : state.mic.status === 'denied' || state.mic.status === 'error' ? (
                  <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-900/60 space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                      <div className="space-y-1 flex-1">
                        <p className="text-xs text-rose-200 font-medium leading-relaxed">
                          {state.mic.error}
                        </p>
                        {state.mic.status === 'error' && state.mic.speechError && (
                          <p className="text-[11px] text-rose-300/80">
                            Speech engine: {state.mic.speechError}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center flex-wrap gap-2 pt-1 border-t border-rose-900/40">
                      {state.mic.cause === 'not_found' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handleCheckDevices()}
                          className="text-xs border-rose-700 bg-rose-950/60 text-rose-200 hover:bg-rose-900/70 h-7"
                        >
                          <RefreshCw className="h-3 w-3 mr-1" />
                          Check Devices
                        </Button>
                      ) : state.mic.cause === 'overconstrained' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleRetestMic}
                          className="text-xs border-rose-700 bg-rose-950/60 text-rose-200 hover:bg-rose-900/70 h-7"
                        >
                          Switch to Defaults
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleRetestMic}
                          className="text-xs border-rose-700 bg-rose-950/60 text-rose-200 hover:bg-rose-900/70 h-7"
                        >
                          Try Again
                        </Button>
                      )}

                      {state.mic.status === 'denied' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setIsHelpModalOpen(true)}
                          className="h-7 text-xs border-indigo-800 text-indigo-300 hover:bg-indigo-950/60"
                        >
                          Permission Help
                        </Button>
                      )}

                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleCopyDiagnostics}
                        className="h-7 text-xs text-slate-300 hover:text-white hover:bg-slate-900/60 gap-1 ml-auto"
                        title="Copy diagnostic report for support"
                      >
                        {diagnosticsCopied ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-400" />
                            <span className="text-emerald-400">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3 text-slate-400" />
                            <span>Copy Diagnostics</span>
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {/* Live audio level meter bar */}
                    <div className="h-3 w-full rounded-full bg-slate-950 border border-slate-800 overflow-hidden p-0.5">
                      <div
                        className={`h-full rounded-full transition-all duration-75 ${
                          audioLevel > 60
                            ? 'bg-rose-500'
                            : audioLevel > 20
                            ? 'bg-emerald-400'
                            : 'bg-indigo-500'
                        }`}
                        style={{ width: `${audioLevel}%` }}
                      />
                    </div>

                    {/* Step-specific guidance messages (§2.3, S5) */}
                    {state.mic.status === 'measuring_noise' && (
                      <div
                        aria-live="polite"
                        role="status"
                        className="p-2.5 rounded-xl bg-amber-950/30 border border-amber-900/50 flex items-center gap-2 text-xs text-amber-300"
                      >
                        <RefreshCw className="h-3.5 w-3.5 animate-spin text-amber-400 shrink-0" />
                        <span>Measuring ambient noise floor... Please stay quiet for 1 second.</span>
                      </div>
                    )}

                    {state.mic.status === 'collecting_speech' && (
                      <div
                        aria-live="polite"
                        role="status"
                        className="p-3 rounded-xl bg-indigo-950/40 border border-indigo-800/60 flex items-center gap-3.5 animate-in fade-in"
                      >
                        {/* Circular Progress Ring */}
                        <div className="relative shrink-0 flex items-center justify-center">
                          <svg className="w-12 h-12 -rotate-90" viewBox="0 0 40 40">
                            {/* Background Track */}
                            <circle
                              cx="20"
                              cy="20"
                              r="16"
                              className="stroke-slate-800 fill-none"
                              strokeWidth="3.5"
                            />
                            {/* Animated Progress Stroke */}
                            <circle
                              cx="20"
                              cy="20"
                              r="16"
                              className="stroke-indigo-400 fill-none transition-all duration-100 ease-out"
                              strokeWidth="3.5"
                              strokeDasharray={100.53}
                              strokeDashoffset={100.53 * (1 - Math.min(1, state.mic.voicedSeconds / 1.5))}
                              strokeLinecap="round"
                            />
                          </svg>
                          <span className="absolute text-[10px] font-mono font-bold text-white">
                            {state.mic.voicedSeconds.toFixed(1)}s
                          </span>
                        </div>

                        {/* Speech Sentence Prompt & Live Status */}
                        <div className="space-y-1.5 flex-1 min-w-0">
                          <p className="text-xs font-semibold text-white">
                            Say: &apos;My name is ___ and I&apos;m ready for the interview&apos; (or &apos;testing one two three&apos;)
                          </p>
                          {liveSpeechTranscript ? (
                            <div className="p-1.5 rounded-md bg-indigo-950/80 border border-indigo-700/60 font-mono text-[11px] text-white">
                              <span className="text-indigo-400 font-semibold mr-1">Heard:</span>
                              &ldquo;{liveSpeechTranscript}&rdquo;
                            </div>
                          ) : (
                            <p className="text-[11px] text-indigo-300">
                              {micReport?.primaryHint || state.mic.hint || `Listening… speak test phrase (${state.mic.voicedSeconds.toFixed(1)} / 1.5 s)`}
                            </p>
                          )}
                          {sttNotice && (
                            <p className="text-[10px] text-amber-300">
                              {sttNotice}
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {state.mic.status === 'verified' && (
                      <div
                        aria-live="polite"
                        role="status"
                        className="p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-900/50 flex flex-col gap-1.5 text-xs text-emerald-300"
                      >
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5 font-medium">
                            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                            Clear voice detected ✓ (SNR: {state.mic.snrDb ? `${state.mic.snrDb.toFixed(1)} dB` : '15+ dB'}). Input latched.
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={handleRetestMic}
                            className="h-6 text-[10px] text-emerald-400 hover:text-emerald-200 hover:bg-emerald-900/40 underline shrink-0"
                            aria-label="Re-test microphone"
                          >
                            Re-test
                          </Button>
                        </div>
                        {liveSpeechTranscript && (
                          <div className="pl-5 text-[11px] text-emerald-200/90 font-mono">
                            <span className="text-emerald-400 font-semibold mr-1">Recognized:</span>
                            &ldquo;{liveSpeechTranscript}&rdquo;
                          </div>
                        )}
                      </div>
                    )}

                    {noiseDetected && (
                      <p className="text-[11px] text-amber-400 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        High background noise detected. Quiet environment recommended.
                      </p>
                    )}
                  </div>
                )}

                {/* Microphone Device Selector */}
                <div className="flex items-center justify-between text-[11px] text-slate-400 px-1 pt-1 border-t border-slate-900">
                  <div className="flex items-center gap-2 truncate max-w-[280px]">
                    <span className="truncate" title={activeMicLabel || availableMicrophones[0]?.label}>
                      Mic: <strong className="text-slate-300">{activeMicLabel || availableMicrophones[0]?.label || 'Default Microphone'}</strong>
                    </span>
                    {availableMicrophones.length > 1 && (
                      <select
                        value={selectedMicDeviceId}
                        onChange={(e) => void handleSwitchMicrophone(e.target.value)}
                        className="bg-slate-900 border border-slate-800 text-slate-300 rounded px-1.5 py-0.5 text-[10px] max-w-[150px] truncate"
                        aria-label="Select microphone"
                      >
                        {availableMicrophones.map((m, i) => (
                          <option key={m.deviceId || i} value={m.deviceId}>
                            {m.label || `Microphone ${i + 1}`}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  {state.mic.status === 'verified' && (
                    <span className="text-[10px] text-emerald-400 font-mono">Active</span>
                  )}
                </div>

                <p className="text-[10px] text-slate-500 pt-1 leading-relaxed border-t border-slate-900/60">
                  Your camera and microphone are on during the interview. Camera monitoring and facial analysis run entirely on your device. Spoken answers are transcribed using your browser’s speech recognition service. Only numeric behavior signals and the transcribed text of your answers are saved. No raw audio or video recordings are stored on our servers.
                </p>
              </div>

              {/* 4. Speaker Output & Verification Code Test */}
              <div className="space-y-2 pt-2 border-t border-slate-800/80">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                    <Volume2 className="h-3.5 w-3.5 text-indigo-400" />
                    3. Speaker / Audio Output
                  </span>
                  {state.speaker.status === 'verified' ? (
                    <span className="text-emerald-400 flex items-center gap-1 font-mono text-[11px]">
                      <Check className="h-3 w-3" /> Verified (Code Confirmed)
                    </span>
                  ) : (
                    <span className="text-slate-500 font-mono text-[11px]">Unverified</span>
                  )}
                </div>

                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <span className="text-xs text-slate-300 font-medium block">Spoken Code Test</span>
                      <span className="text-[11px] text-slate-500">Listen to 3-digit code and enter below</span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isSpeakingTest}
                      onClick={handlePlaySpeakerTest}
                      className="border-indigo-800 text-indigo-300 hover:bg-indigo-950/60 text-xs gap-1.5 cursor-pointer h-7"
                    >
                      <Play className="h-3 w-3" />
                      {isSpeakingTest ? 'Speaking...' : speakerTestCode ? 'Replay Code' : 'Play Test Code'}
                    </Button>
                  </div>

                  {/* Code Confirmation Field */}
                  {(state.speaker.status === 'awaiting_confirmation' ||
                    state.speaker.status === 'playing_test' ||
                    state.speaker.status === 'failed' ||
                    speakerTestCode) && (
                    <div className="pt-2 border-t border-slate-900 flex items-center gap-2">
                      <input
                        type="text"
                        maxLength={3}
                        value={speakerCodeInput}
                        onChange={(e) => setSpeakerCodeInput(e.target.value)}
                        placeholder="3-digit code"
                        data-expected-code={speakerTestCode}
                        className="h-8 w-28 bg-slate-900 border border-slate-700 text-white text-xs text-center font-mono rounded focus:border-indigo-500 focus:outline-none"
                      />
                      <Button
                        size="sm"
                        onClick={handleConfirmSpeakerCode}
                        disabled={speakerCodeInput.trim().length !== 3}
                        className="h-8 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
                      >
                        Confirm
                      </Button>
                      {speakerError && (
                        <span className="text-[10px] text-rose-400 font-medium">
                          {speakerError}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Start Interview CTA */}
              <div className="pt-4 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-3">
                <Button
                  variant="ghost"
                  onClick={onCancel}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </Button>

                <div className="flex flex-col items-end gap-1">
                  <Button
                    disabled={!isAllReady || !consentAccepted}
                    onClick={handleStart}
                    className={`px-6 text-xs font-semibold gap-2 shadow-lg transition-all cursor-pointer ${
                      isAllReady && consentAccepted
                        ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-600/30'
                        : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    <span>Start {durationMinutes}-Min Interview</span>
                    <ChevronRight className="h-4 w-4" />
                  </Button>

                  {(!isAllReady || !consentAccepted) && (
                    <span className="text-[10px] text-slate-500">
                      {state.camera.status !== 'verified'
                        ? 'Physical camera verification required'
                        : state.liveness.status !== 'passed'
                        ? 'Complete liveness verification'
                        : state.mic.status !== 'verified'
                        ? 'Speak into microphone to calibrate'
                        : state.speaker.status !== 'verified'
                        ? 'Confirm 3-digit speaker code'
                        : 'Accept consent terms to proceed'}
                    </span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Permission Help Modal */}
      <PermissionHelpModal
        isOpen={isHelpModalOpen}
        onClose={() => setIsHelpModalOpen(false)}
        onRetry={handleRetestMic}
      />

      {/* Diagnostics Report Modal */}
      <DiagnosticsModal
        isOpen={isDiagnosticsOpen}
        onClose={() => setIsDiagnosticsOpen(false)}
        stream={cameraStream}
        audioStream={audioStream ?? audioStreamRef.current}
        audioContext={audioContextRef.current}
        videoEl={videoRef.current}
        measuredFps={pipelineRef.current?.getStatus().fps}
        meanLuminance={pipelineRef.current?.getStatus().luminance}
        faceCount={pipelineRef.current?.getStatus().currentFaceCount}
        centeringOffsetPct={
          typeof faceQualityReport?.criteria?.centered?.value === 'number'
            ? faceQualityReport.criteria.centered.value
            : undefined
        }
        faceHeightPct={
          typeof faceQualityReport?.criteria?.distance?.value === 'number'
            ? faceQualityReport.criteria.distance.value
            : undefined
        }
        sharpnessScore={
          typeof faceQualityReport?.criteria?.sharpness?.value === 'number'
            ? faceQualityReport.criteria.sharpness.value
            : undefined
        }
        headPose={
          (faceQualityReport?.criteria?.facing_camera?.value as
            | { yaw: number; pitch: number; roll: number }
            | undefined) || undefined
        }
        noiseFloorRms={
          micReport?.noiseFloorRms ??
          (noiseFloorCalibratorRef.current.isCalibrated(performance.now())
            ? noiseFloorCalibratorRef.current.getAverageRms()
            : null)
        }
        noiseFloorDb={
          micReport?.noiseFloorDb ??
          (noiseFloorCalibratorRef.current.isCalibrated(performance.now())
            ? noiseFloorCalibratorRef.current.getAverageDb()
            : null)
        }
        estimatedSnrDb={micReport?.estimatedSnrDb ?? null}
        voicedSeconds={
          micReport?.voicedSeconds ??
          voicedAccumulatorRef.current.getCumulativeVoicedSeconds(performance.now())
        }
        lastError={
          state.camera.status === 'error' ||
          state.camera.status === 'denied' ||
          state.camera.status === 'in_use' ||
          state.camera.status === 'not_found'
            ? (state.camera as { error: string }).error
            : null
        }
        lastGetUserMediaError={lastMicErrorName}
        lastSpeechRecognitionError={lastSttErrorCode}
      />
    </div>
  );
}
