/**
 * visionManager.ts
 *
 * Singleton manager for MediaPipe FaceLandmarker and PoseLandmarker models (§2.2).
 * Features:
 * - Single initialization across renders / StrictMode mounts
 * - Background preloading and Cache API asset caching
 * - GPU delegate with automatic 5s timeout fallback to CPU ("compatibility mode")
 * - Lazy PoseLandmarker initialization (setup only loads FaceLandmarker)
 * - Timing marks recorded for diagnostics panel
 */

import { FaceLandmarker, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

export interface VisionDiagnostics {
  timeToStreamMs: number | null;
  timeToModelReadyMs: number | null;
  timeToFirstDetectionMs: number | null;
  delegateUsed: 'GPU' | 'CPU' | null;
  isCompatibilityMode: boolean;
  preloaded: boolean;
}

const diagnosticsState: VisionDiagnostics = {
  timeToStreamMs: null,
  timeToModelReadyMs: null,
  timeToFirstDetectionMs: null,
  delegateUsed: null,
  isCompatibilityMode: false,
  preloaded: false,
};

let filesetResolverPromise: Promise<unknown> | null = null;
let faceLandmarkerPromise: Promise<FaceLandmarker> | null = null;
let poseLandmarkerPromise: Promise<PoseLandmarker> | null = null;
let sharedFaceLandmarker: FaceLandmarker | null = null;
let sharedPoseLandmarker: PoseLandmarker | null = null;

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const FACE_MODEL_PATH = '/models/face_landmarker.task';
const POSE_MODEL_PATH = '/models/pose_landmarker_lite.task';
const CACHE_NAME = 'mediapipe-vision-cache-v1';

/**
 * Preload vision model files and cache them locally using Cache API / memory.
 * Invoked as soon as setup opens, in parallel with device permission request.
 */
export async function preloadVisionModels(): Promise<void> {
  if (diagnosticsState.preloaded) return;

  try {
    // 1. Resolve WASM fileset in background
    getFilesetResolver().catch(() => {});

    // 2. Pre-fetch model asset if Cache API is available
    if (typeof window !== 'undefined' && 'caches' in window) {
      const cache = await caches.open(CACHE_NAME);
      const match = await cache.match(FACE_MODEL_PATH);
      if (!match) {
        fetch(FACE_MODEL_PATH)
          .then((res) => {
            if (res.ok) cache.put(FACE_MODEL_PATH, res);
          })
          .catch(() => {});
      }
    }
    diagnosticsState.preloaded = true;
  } catch {
    // Non-blocking prefetch guard
  }
}

/**
 * Returns shared FilesetResolver promise (singleton).
 */
export function getFilesetResolver(): Promise<any> {
  if (!filesetResolverPromise) {
    filesetResolverPromise = FilesetResolver.forVisionTasks(WASM_URL);
  }
  return filesetResolverPromise;
}

/**
 * Obtains the singleton FaceLandmarker.
 * Attempts GPU delegate first; if GPU fails or takes > 5s, falls back to CPU automatically.
 */
export async function getSharedFaceLandmarker(): Promise<FaceLandmarker> {
  if (
    typeof window !== 'undefined' &&
    (window as unknown as { __VISION_TEST_LANDMARKER__?: FaceLandmarker }).__VISION_TEST_LANDMARKER__
  ) {
    return (window as unknown as { __VISION_TEST_LANDMARKER__: FaceLandmarker }).__VISION_TEST_LANDMARKER__;
  }

  if (sharedFaceLandmarker) {
    return sharedFaceLandmarker;
  }

  if (faceLandmarkerPromise) {
    return faceLandmarkerPromise;
  }

  faceLandmarkerPromise = (async () => {
    const startTime = performance.now();
    const visionWasm = await getFilesetResolver();

    const createModel = async (delegate: 'GPU' | 'CPU') => {
      return await FaceLandmarker.createFromOptions(visionWasm, {
        baseOptions: {
          modelAssetPath: FACE_MODEL_PATH,
          delegate,
        },
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        runningMode: 'VIDEO',
        numFaces: 1,
      });
    };

    // Attempt GPU with a 5s race timeout
    let landmarker: FaceLandmarker;
    try {
      const gpuTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('GPU delegate init timeout (>5s)')), 5000)
      );

      landmarker = await Promise.race([createModel('GPU'), gpuTimeout]);
      diagnosticsState.delegateUsed = 'GPU';
      diagnosticsState.isCompatibilityMode = false;
    } catch (gpuErr) {
      console.warn('FaceLandmarker GPU init failed or timed out, falling back to CPU:', gpuErr);
      landmarker = await createModel('CPU');
      diagnosticsState.delegateUsed = 'CPU';
      diagnosticsState.isCompatibilityMode = true;
    }

    const duration = performance.now() - startTime;
    diagnosticsState.timeToModelReadyMs = Math.round(duration);
    sharedFaceLandmarker = landmarker;
    return landmarker;
  })();

  return faceLandmarkerPromise;
}

/**
 * Lazily obtains singleton PoseLandmarker (only needed in interview room).
 */
export async function getSharedPoseLandmarker(): Promise<PoseLandmarker> {
  if (sharedPoseLandmarker) {
    return sharedPoseLandmarker;
  }

  if (poseLandmarkerPromise) {
    return poseLandmarkerPromise;
  }

  poseLandmarkerPromise = (async () => {
    const visionWasm = await getFilesetResolver();
    const delegate = diagnosticsState.isCompatibilityMode ? 'CPU' : 'GPU';

    try {
      const pose = await PoseLandmarker.createFromOptions(visionWasm, {
        baseOptions: {
          modelAssetPath: POSE_MODEL_PATH,
          delegate,
        },
        runningMode: 'VIDEO',
        numPoses: 1,
      });
      sharedPoseLandmarker = pose;
      return pose;
    } catch {
      // Fallback to CPU if GPU failed
      const pose = await PoseLandmarker.createFromOptions(visionWasm, {
        baseOptions: {
          modelAssetPath: POSE_MODEL_PATH,
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
      });
      sharedPoseLandmarker = pose;
      return pose;
    }
  })();

  return poseLandmarkerPromise;
}

/**
 * Records diagnostic timing marks.
 */
export function recordVisionTiming(
  key: keyof Omit<VisionDiagnostics, 'delegateUsed' | 'isCompatibilityMode' | 'preloaded'>,
  durationMs: number
): void {
  diagnosticsState[key] = Math.round(durationMs);
}

/**
 * Read current vision diagnostics snapshot.
 */
export function getVisionDiagnostics(): Readonly<VisionDiagnostics> {
  return { ...diagnosticsState };
}

/**
 * Resets shared instances (used primarily for test cleanup).
 */
export function resetVisionManager(): void {
  if (sharedFaceLandmarker) {
    try {
      sharedFaceLandmarker.close();
    } catch {}
    sharedFaceLandmarker = null;
  }
  if (sharedPoseLandmarker) {
    try {
      sharedPoseLandmarker.close();
    } catch {}
    sharedPoseLandmarker = null;
  }
  filesetResolverPromise = null;
  faceLandmarkerPromise = null;
  poseLandmarkerPromise = null;
  diagnosticsState.timeToStreamMs = null;
  diagnosticsState.timeToModelReadyMs = null;
  diagnosticsState.timeToFirstDetectionMs = null;
  diagnosticsState.delegateUsed = null;
  diagnosticsState.isCompatibilityMode = false;
  diagnosticsState.preloaded = false;
}
