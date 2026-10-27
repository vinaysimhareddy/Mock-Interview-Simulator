import { useCallback, useEffect, useRef, useState } from 'react';
import { FaceLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import { getSharedFaceLandmarker, getSharedPoseLandmarker } from '../lib/visionManager';
import {
  isVirtualCamera,
  filterPhysicalCameras,
  VIRTUAL_CAMERA_REJECTION_MESSAGE,
} from '../lib/virtualCameraBlocklist';
import { CameraWatchdog, CameraIntegrityEvent } from '../lib/cameraWatchdog';
import { recordGetUserMediaCall } from '../lib/diagnosticsCollector';
import {
  computeHeadPose,
  computePostureScore,
  isLookingAtCamera,
  LandmarkPoint,
  MetricAggregator,
} from '../lib/metrics';
import {
  CalibrationBaseline,
  DistractionFlag,
  ExpressionMetrics,
  FrameMetricSnapshot,
  HeadPose,
  TelemetrySample,
} from '../lib/types';
import {
  IntegrityFlagEvent,
  LivenessChallengeStep,
} from '../lib/integrityTypes';
import { PassiveAntiSpoofDetector } from '../lib/passiveAntiSpoof';
import { extractFaceGeometrySignature, Landmark3D } from '../lib/faceGeometry';
import {
  ChallengeGestureEvaluator,
  generateChallengeSequence,
} from '../lib/activeChallenge';

export type VisionStatus = 'idle' | 'initializing' | 'ready' | 'running' | 'error';

export interface LiveVisionMetrics {
  eyeContactRatio: number | null;
  postureScore: number | null;
  headPose: HeadPose | null;
  expression: ExpressionMetrics | null;
  distractionFlags: DistractionFlag[];
  fps: number;
  facePresent: boolean;
}

export interface UseMediaPipeVisionOptions {
  stream?: MediaStream | null;
  onTelemetryPacket?: (packet: TelemetrySample) => void;
  autoStart?: boolean;
  allowPhoneCamera?: boolean;
  selectedDeviceId?: string;
  onIntegrityEvent?: (event: CameraIntegrityEvent) => void;
  onAntiSpoofFlag?: (event: IntegrityFlagEvent) => void;
}

export interface UseMediaPipeVisionReturn {
  status: VisionStatus;
  error: string | null;
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  latestPacket: TelemetrySample | null;
  latestMetrics: LiveVisionMetrics;
  isCalibrating: boolean;
  calibrationProgress: number; // 0..100
  availableCameras: MediaDeviceInfo[];
  activeCameraLabel: string;
  isPhysicalVerified: boolean;
  activeIntegrityFlags: IntegrityFlagEvent[];
  activeChallenge: LivenessChallengeStep | null;
  challengeStatus: 'idle' | 'in_progress' | 'passed' | 'failed';
  startCalibration: () => void;
  selectCamera: (deviceId: string) => Promise<void>;
  startChallenge: (count?: number) => void;
  resetChallenge: () => void;
  start: () => Promise<void>;
  stop: () => void;
}

export function useMediaPipeVision(
  options: UseMediaPipeVisionOptions = {}
): UseMediaPipeVisionReturn {
  const {
    stream: externalStream,
    onTelemetryPacket,
    autoStart = false,
    allowPhoneCamera = false,
    selectedDeviceId: initialDeviceId,
    onIntegrityEvent,
    onAntiSpoofFlag,
  } = options;

  const [status, setStatus] = useState<VisionStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const aggregatorRef = useRef<MetricAggregator>(new MetricAggregator());

  // Passive anti-spoof detector and active challenge evaluator
  const antiSpoofDetectorRef = useRef<PassiveAntiSpoofDetector>(new PassiveAntiSpoofDetector());
  const challengeEvaluatorRef = useRef<ChallengeGestureEvaluator>(new ChallengeGestureEvaluator());
  const downsamplerCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const animationFrameIdRef = useRef<number | null>(null);
  const rvfcHandleRef = useRef<number | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const externalStreamRef = useRef<MediaStream | null | undefined>(externalStream);
  const streamFromOptionsRef = useRef<boolean>(false);
  const watchdogRef = useRef<CameraWatchdog | null>(null);
  const lastVideoTimeRef = useRef<number>(-1);
  const startTimeRef = useRef<number>(0);

  // FPS tracking
  const frameCountRef = useRef<number>(0);
  const lastFpsUpdateRef = useRef<number>(0);
  const measuredFpsRef = useRef<number>(30);

  // Device management state
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [activeCameraLabel, setActiveCameraLabel] = useState<string>('');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(initialDeviceId || '');
  const [isPhysicalVerified, setIsPhysicalVerified] = useState<boolean>(false);

  // Integrity flags state
  const [activeIntegrityFlags, setActiveIntegrityFlags] = useState<IntegrityFlagEvent[]>([]);

  // Active challenge state
  const [challengeList, setChallengeList] = useState<LivenessChallengeStep[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [challengeStatus, setChallengeStatus] = useState<
    'idle' | 'in_progress' | 'passed' | 'failed'
  >('idle');
  const challengeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Calibration state
  const [isCalibrating, setIsCalibrating] = useState<boolean>(false);
  const [calibrationProgress, setCalibrationProgress] = useState<number>(0);
  const calibrationFramesRef = useRef<{
    shoulderWidths: number[];
    noseYs: number[];
    yaws: number[];
    pitches: number[];
  }>({ shoulderWidths: [], noseYs: [], yaws: [], pitches: [] });
  const calibrationLandmarksRef = useRef<Landmark3D[] | null>(null);
  const calibrationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Latest metrics state for live HUD UI (null when no live face data)
  const [latestPacket, setLatestPacket] = useState<TelemetrySample | null>(null);
  const [latestMetrics, setLatestMetrics] = useState<LiveVisionMetrics>({
    eyeContactRatio: null,
    postureScore: null,
    headPose: null,
    expression: null,
    distractionFlags: [] as DistractionFlag[],
    fps: 0,
    facePresent: false,
  });

  const lastPoseTimeRef = useRef<number>(0);
  const lastPostureScoreRef = useRef<number>(0.8);

  useEffect(() => {
    externalStreamRef.current = externalStream;
  }, [externalStream]);

  const onTelemetryPacketRef = useRef(onTelemetryPacket);
  useEffect(() => {
    onTelemetryPacketRef.current = onTelemetryPacket;
  }, [onTelemetryPacket]);

  const onIntegrityEventRef = useRef(onIntegrityEvent);
  useEffect(() => {
    onIntegrityEventRef.current = onIntegrityEvent;
  }, [onIntegrityEvent]);

  const onAntiSpoofFlagRef = useRef(onAntiSpoofFlag);
  useEffect(() => {
    onAntiSpoofFlagRef.current = onAntiSpoofFlag;
  }, [onAntiSpoofFlag]);

  /**
   * Enumerate available physical cameras (post-permission).
   */
  const updateDeviceList = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const physicalCameras = filterPhysicalCameras(allDevices, allowPhoneCamera);
      setAvailableCameras(physicalCameras);
    } catch {
      // Ignore device enumeration error
    }
  }, [allowPhoneCamera]);

  /**
   * Initialize MediaPipe Task Vision models using shared singletons (GPU with CPU fallback).
   */
  const initializeLandmarkers = useCallback(async (): Promise<{
    face: FaceLandmarker;
    pose: PoseLandmarker;
  }> => {
    setStatus('initializing');
    setError(null);
    try {
      const face = await getSharedFaceLandmarker();
      const pose = await getSharedPoseLandmarker();
      return { face, pose };
    } catch (err) {
      console.warn('Failed to initialize shared landmarkers:', err);
      setError('Failed to initialize vision models.');
      setStatus('error');
      throw err;
    }
  }, []);

  /**
   * Start 3-second neutral baseline calibration and geometric baseline capture (§4.3).
   */
  const startCalibration = useCallback(() => {
    setIsCalibrating(true);
    setCalibrationProgress(0);
    calibrationFramesRef.current = { shoulderWidths: [], noseYs: [], yaws: [], pitches: [] };
    calibrationLandmarksRef.current = null;

    const startTime = performance.now();
    const duration = 3000;

    if (calibrationTimerRef.current) clearInterval(calibrationTimerRef.current);

    calibrationTimerRef.current = setInterval(() => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(100, Math.round((elapsed / duration) * 100));
      setCalibrationProgress(progress);

      if (progress >= 100) {
        if (calibrationTimerRef.current) clearInterval(calibrationTimerRef.current);
        setIsCalibrating(false);

        // Compute posture and pose baseline
        const frames = calibrationFramesRef.current;
        if (frames.shoulderWidths.length > 5) {
          const avgWidth =
            frames.shoulderWidths.reduce((a, b) => a + b, 0) / frames.shoulderWidths.length;
          const avgNoseY = frames.noseYs.reduce((a, b) => a + b, 0) / frames.noseYs.length;
          const avgYaw = frames.yaws.reduce((a, b) => a + b, 0) / frames.yaws.length;
          const avgPitch = frames.pitches.reduce((a, b) => a + b, 0) / frames.pitches.length;

          const baseline: CalibrationBaseline = {
            neutralShoulderWidth: avgWidth,
            neutralShoulderSlope: 0,
            neutralNoseY: avgNoseY,
            neutralYaw: avgYaw,
            neutralPitch: avgPitch,
          };
          aggregatorRef.current.setBaseline(baseline);
        }

        // Establish face geometry baseline (§4.3)
        if (calibrationLandmarksRef.current) {
          const sig = extractFaceGeometrySignature(calibrationLandmarksRef.current);
          if (sig) {
            antiSpoofDetectorRef.current.setBaselineGeometry(sig);
          }
        }
      }
    }, 100);
  }, []);

  /**
   * Start an active liveness challenge sequence (§4.2).
   */
  const startChallenge = useCallback((count: number = 3) => {
    const sequence = generateChallengeSequence(count);
    setChallengeList(sequence);
    setCurrentStepIndex(0);
    setChallengeStatus('in_progress');
    challengeEvaluatorRef.current.reset();

    if (challengeTimerRef.current) clearTimeout(challengeTimerRef.current);
    if (sequence.length > 0) {
      challengeTimerRef.current = setTimeout(() => {
        setChallengeStatus('failed');
      }, sequence[0].timeoutMs);
    }
  }, []);

  const resetChallenge = useCallback(() => {
    if (challengeTimerRef.current) clearTimeout(challengeTimerRef.current);
    setChallengeStatus('idle');
    setChallengeList([]);
    setCurrentStepIndex(0);
    challengeEvaluatorRef.current.reset();
  }, []);

  /**
   * Stop processing loop, stop webcam stream, and close landmarkers.
   */
  const stop = useCallback(() => {
    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }

    if (rvfcHandleRef.current !== null && videoRef.current && typeof (videoRef.current as any).cancelVideoFrameCallback === 'function') {
      (videoRef.current as any).cancelVideoFrameCallback(rvfcHandleRef.current);
      rvfcHandleRef.current = null;
    }

    if (calibrationTimerRef.current) {
      clearInterval(calibrationTimerRef.current);
      calibrationTimerRef.current = null;
    }

    if (challengeTimerRef.current) {
      clearTimeout(challengeTimerRef.current);
      challengeTimerRef.current = null;
    }

    if (watchdogRef.current) {
      watchdogRef.current.destroy();
      watchdogRef.current = null;
    }

    if (mediaStreamRef.current) {
      if (!streamFromOptionsRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      mediaStreamRef.current = null;
    }

    if (faceLandmarkerRef.current) {
      faceLandmarkerRef.current = null;
    }

    if (poseLandmarkerRef.current) {
      poseLandmarkerRef.current = null;
    }

    aggregatorRef.current.reset();
    antiSpoofDetectorRef.current.reset();
    challengeEvaluatorRef.current.reset();
    setIsPhysicalVerified(false);
    setActiveIntegrityFlags([]);
    setStatus('idle');
  }, []);

  /**
   * Start webcam stream and computer vision processing loop with device ID and virtual camera check.
   */
  const startWithDeviceId = useCallback(
    async (deviceId?: string) => {
      try {
        stop();
        setError(null);
        setIsPhysicalVerified(false);

        if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
          setError('Media devices API is not supported in this browser environment.');
          setStatus('error');
          return;
        }

        // 1. Acquire video stream: reuse externalStreamRef.current if provided, else request getUserMedia
        let stream: MediaStream;
        if (externalStreamRef.current) {
          stream = externalStreamRef.current;
          mediaStreamRef.current = stream;
          streamFromOptionsRef.current = true;
        } else {
          streamFromOptionsRef.current = false;
          recordGetUserMediaCall('video');
          try {
            const constraints: MediaStreamConstraints = {
              video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30, min: 15 },
                facingMode: 'user',
                ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
              },
              audio: false,
            };
            stream = await navigator.mediaDevices.getUserMedia(constraints);
            mediaStreamRef.current = stream;
          } catch (mediaErr: unknown) {
            const message =
              mediaErr instanceof Error && mediaErr.name === 'NotAllowedError'
                ? 'Camera permission denied. Please allow camera access in your browser settings.'
                : mediaErr instanceof Error && mediaErr.name === 'NotFoundError'
                ? 'No physical webcam detected on this device.'
                : 'No active webcam detected or device is busy with another application.';
            setError(message);
            setStatus('error');
            return;
          }
        }

        const tracks = stream.getVideoTracks();
        if (tracks.length === 0) {
          if (!streamFromOptionsRef.current) {
            stream.getTracks().forEach((track) => track.stop());
          }
          setError('No video track found on acquired camera stream.');
          setStatus('error');
          return;
        }

        const activeTrack = tracks[0];
        const label = activeTrack.label || '';

        // Virtual Camera Blocklist Check (§3.2)
        if (isVirtualCamera(label, allowPhoneCamera)) {
          if (!streamFromOptionsRef.current) {
            stream.getTracks().forEach((track) => track.stop());
          }
          setError(VIRTUAL_CAMERA_REJECTION_MESSAGE);
          setStatus('error');
          await updateDeviceList();
          return;
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.playsInline = true;
          videoRef.current.muted = true;
          await videoRef.current.play().catch(() => {});
        }

        // Setup Hardware Watchdog (§3.3)
        if (watchdogRef.current) {
          watchdogRef.current.destroy();
        }
        watchdogRef.current = new CameraWatchdog(activeTrack, videoRef.current, {
          onIntegrityEvent: (event) => {
            if (onIntegrityEventRef.current) {
              onIntegrityEventRef.current(event);
            }
            if (event.type === 'track_ended') {
              setError('Camera feed disconnected or permission revoked.');
              setStatus('error');
            } else if (event.type === 'device_changed') {
              updateDeviceList();
            }
          },
        });

        setActiveCameraLabel(label || 'Physical Camera');
        setIsPhysicalVerified(true);
        await updateDeviceList();

        // 2. Initialize MediaPipe Models
        const { face, pose } = await initializeLandmarkers();
        faceLandmarkerRef.current = face;
        poseLandmarkerRef.current = pose;

        startTimeRef.current = performance.now();
        lastVideoTimeRef.current = -1;
        frameCountRef.current = 0;
        lastFpsUpdateRef.current = performance.now();
        setStatus('running');

        // Create downsampler canvas for 64x36 passive pixel analysis (§4.1)
        if (typeof document !== 'undefined') {
          const c = document.createElement('canvas');
          c.width = 64;
          c.height = 36;
          downsamplerCanvasRef.current = c;
        }

        const scheduleNextFrame = () => {
          const video = videoRef.current;
          if (video && typeof (video as any).requestVideoFrameCallback === 'function') {
            rvfcHandleRef.current = (video as any).requestVideoFrameCallback(() => {
              renderLoop();
            });
          } else {
            animationFrameIdRef.current = requestAnimationFrame(renderLoop);
          }
        };

        // 3. Process video loop throttled to ~30 FPS with rvfc
        const renderLoop = () => {
          const video = videoRef.current;
          if (!video || video.paused || video.ended || !faceLandmarkerRef.current) {
            scheduleNextFrame();
            return;
          }

          const now = performance.now();

          // Throttle by checking video.currentTime advancement
          if (video.currentTime !== lastVideoTimeRef.current) {
            lastVideoTimeRef.current = video.currentTime;
            frameCountRef.current++;

            if (watchdogRef.current) {
              watchdogRef.current.recordFrameDelivered();
            }

            if (now - lastFpsUpdateRef.current >= 1000) {
              measuredFpsRef.current = frameCountRef.current;
              frameCountRef.current = 0;
              lastFpsUpdateRef.current = now;
            }

            // Run FaceLandmarker inference
            const faceResult = faceLandmarkerRef.current.detectForVideo(video, now);
            const hasFace = faceResult.faceLandmarks.length > 0;

            let headPose: HeadPose = { yaw: 0, pitch: 0, roll: 0 };
            let lookingAtCamera = false;
            let expression: ExpressionMetrics = { smile: 0, brow_furrow: 0, mouth_open: 0 };
            const blendshapeDict: Record<string, number> = {};

            if (hasFace) {
              const rawLandmarks = faceResult.faceLandmarks[0] as LandmarkPoint[];
              headPose = computeHeadPose(rawLandmarks);

              // Extract blendshapes
              if (faceResult.faceBlendshapes && faceResult.faceBlendshapes.length > 0) {
                for (const category of faceResult.faceBlendshapes[0].categories) {
                  blendshapeDict[category.categoryName] = category.score;
                }
              }

              lookingAtCamera = isLookingAtCamera(blendshapeDict, headPose);

              expression = {
                smile: blendshapeDict['mouthSmileLeft'] || blendshapeDict['mouthSmileRight'] || 0,
                brow_furrow: blendshapeDict['browDownLeft'] || blendshapeDict['browDownRight'] || 0,
                mouth_open: blendshapeDict['jawOpen'] || 0,
              };

              calibrationLandmarksRef.current = rawLandmarks as Landmark3D[];
            }

            // Downsample frame to 64x36 for passive anti-spoof analysis (§4.1)
            let downsampledPixels: Uint8ClampedArray | undefined;
            let meanLum: number | undefined;

            if (downsamplerCanvasRef.current && video.videoWidth > 0 && video.videoHeight > 0) {
              const dCtx = downsamplerCanvasRef.current.getContext('2d', { willReadFrequently: true });
              if (dCtx) {
                dCtx.drawImage(video, 0, 0, 64, 36);
                const imgData = dCtx.getImageData(0, 0, 64, 36);
                const dArray = new Uint8ClampedArray(64 * 36);
                let lumSum = 0;
                for (let i = 0; i < 64 * 36; i++) {
                  const r = imgData.data[i * 4];
                  const g = imgData.data[i * 4 + 1];
                  const b = imgData.data[i * 4 + 2];
                  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
                  dArray[i] = lum;
                  lumSum += lum;
                }
                downsampledPixels = dArray;
                meanLum = lumSum / (64 * 36);
              }
            }

            // Run Passive Anti-Spoof Detection (§4.1)
            const antiSpoofFlags = antiSpoofDetectorRef.current.processFrame({
              timestamp: now,
              faceCount: faceResult.faceLandmarks.length,
              landmarks: hasFace ? (faceResult.faceLandmarks[0] as Landmark3D[]) : null,
              blendshapes: blendshapeDict,
              headPose,
              downsampledPixels,
              meanLuminance: meanLum,
            });

            if (antiSpoofFlags.length > 0) {
              setActiveIntegrityFlags(antiSpoofFlags);
              for (const flag of antiSpoofFlags) {
                if (onAntiSpoofFlagRef.current) {
                  onAntiSpoofFlagRef.current(flag);
                }
              }
            } else if (activeIntegrityFlags.length > 0) {
              setActiveIntegrityFlags([]);
            }

            // Active Liveness Challenge Evaluation (§4.2)
            if (challengeStatus === 'in_progress' && challengeList.length > 0) {
              const currentStep = challengeList[currentStepIndex];
              if (currentStep) {
                const evalResult = challengeEvaluatorRef.current.evaluateFrame(
                  currentStep.action,
                  headPose,
                  blendshapeDict
                );

                if (evalResult.passed) {
                  if (currentStepIndex + 1 < challengeList.length) {
                    const nextIndex = currentStepIndex + 1;
                    setCurrentStepIndex(nextIndex);
                    challengeEvaluatorRef.current.reset();

                    if (challengeTimerRef.current) clearTimeout(challengeTimerRef.current);
                    challengeTimerRef.current = setTimeout(() => {
                      setChallengeStatus('failed');
                    }, challengeList[nextIndex].timeoutMs);
                  } else {
                    // All steps in sequence completed!
                    if (challengeTimerRef.current) clearTimeout(challengeTimerRef.current);
                    setChallengeStatus('passed');
                  }
                }
              }
            }

            // Run PoseLandmarker inference throttled to 10-15 FPS (every ~80ms)
            let rawPosture = lastPostureScoreRef.current;
            if (poseLandmarkerRef.current && (now - lastPoseTimeRef.current >= 80)) {
              lastPoseTimeRef.current = now;
              const poseResult = poseLandmarkerRef.current.detectForVideo(video, now);
              if (poseResult.landmarks && poseResult.landmarks.length > 0) {
                const posePoints = poseResult.landmarks[0] as LandmarkPoint[];
                rawPosture = computePostureScore(
                  posePoints,
                  aggregatorRef.current.getBaseline(),
                  null
                );
                lastPostureScoreRef.current = rawPosture;

                // Collect calibration samples if calibration is active
                if (posePoints.length >= 13) {
                  const ls = posePoints[11];
                  const rs = posePoints[12];
                  const width = Math.hypot(rs.x - ls.x, rs.y - ls.y);
                  calibrationFramesRef.current.shoulderWidths.push(width);
                  calibrationFramesRef.current.noseYs.push(posePoints[0].y);
                  calibrationFramesRef.current.yaws.push(headPose.yaw);
                  calibrationFramesRef.current.pitches.push(headPose.pitch);
                }
              }
            }

            // Add frame to MetricAggregator
            const frameSnapshot: FrameMetricSnapshot = {
              timestamp: now,
              face_present: hasFace,
              looking_at_camera: lookingAtCamera,
              raw_posture_score: rawPosture,
              head_pose: headPose,
              expression,
              pose_keypoint_variance: 0.001,
            };
            aggregatorRef.current.addFrame(frameSnapshot);

            // Emit 1 Hz Telemetry Packet if 1 second has elapsed
            const elapsedSec = Math.floor((now - startTimeRef.current) / 1000);
            if (aggregatorRef.current.shouldEmit(elapsedSec)) {
              const packet = aggregatorRef.current.emitPacket(
                elapsedSec,
                measuredFpsRef.current
              );
              setLatestPacket(packet);
              setLatestMetrics({
                eyeContactRatio: packet.face_present ? packet.eye_contact_ratio : null,
                postureScore: packet.face_present ? packet.posture_score : null,
                headPose: packet.face_present ? packet.head_pose : null,
                expression: packet.face_present ? packet.expression : null,
                distractionFlags: packet.distraction_flags,
                fps: packet.fps,
                facePresent: packet.face_present,
              });

              if (onTelemetryPacketRef.current) {
                onTelemetryPacketRef.current(packet);
              }
            }
          }

          scheduleNextFrame();
        };

        scheduleNextFrame();
      } catch (err: unknown) {
        console.error('Failed to start MediaPipe vision hook:', err);
        setError(err instanceof Error ? err.message : 'Unknown vision pipeline failure');
        setStatus('error');
      }
    },
    [
      activeIntegrityFlags.length,
      allowPhoneCamera,
      challengeList,
      challengeStatus,
      currentStepIndex,
      initializeLandmarkers,
      stop,
      updateDeviceList,
    ]
  );

  const start = useCallback(() => startWithDeviceId(selectedDeviceId), [
    startWithDeviceId,
    selectedDeviceId,
  ]);

  const selectCamera = useCallback(
    async (deviceId: string) => {
      setSelectedDeviceId(deviceId);
      await startWithDeviceId(deviceId);
    },
    [startWithDeviceId]
  );

  useEffect(() => {
    if (autoStart) {
      start();
    }
    return () => {
      stop();
    };
  }, [autoStart, start, stop, externalStream]);

  const activeChallenge =
    challengeStatus === 'in_progress' && challengeList[currentStepIndex]
      ? challengeList[currentStepIndex]
      : null;

  return {
    status,
    error,
    videoRef,
    canvasRef,
    latestPacket,
    latestMetrics,
    isCalibrating,
    calibrationProgress,
    availableCameras,
    activeCameraLabel,
    isPhysicalVerified,
    activeIntegrityFlags,
    activeChallenge,
    challengeStatus,
    startCalibration,
    selectCamera,
    startChallenge,
    resetChallenge,
    start,
    stop,
  };
}
