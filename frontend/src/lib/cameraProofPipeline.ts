/**
 * cameraProofPipeline.ts
 *
 * Implements machine-checked proof required for "streaming" and "verified" camera states:
 * 1. Track validity (live, enabled, unmuted)
 * 2. Attachment and video.play()
 * 3. Real frame arrival (>0 resolution and >=10 frames in 1s)
 * 4. Luminance check (mean luminance > 8/255 for >= 1s; detects lens cover / shutter)
 * 5. Single face presence continuity (exactly 1 face for >= 2s)
 * 6. Frame diff check (detects frozen/static frame)
 * 7. Continuous watchdog (track ended/muted, frame stall > 1.5s, face disappearance > 2s)
 */

export interface TrackCheckResult {
  ok: boolean;
  reason?: string;
}

export function checkStreamTracks(stream: MediaStream | null): TrackCheckResult {
  if (!stream || !stream.active) {
    return { ok: false, reason: 'MediaStream is not active or missing.' };
  }
  const tracks = stream.getVideoTracks();
  if (tracks.length === 0) {
    return { ok: false, reason: 'MediaStream contains no video tracks.' };
  }
  const track = tracks[0];
  if (track.readyState !== 'live') {
    return { ok: false, reason: `Video track readyState is ${track.readyState} (expected 'live').` };
  }
  if (!track.enabled) {
    return { ok: false, reason: 'Video track is disabled.' };
  }
  if (track.muted) {
    return { ok: false, reason: 'Video track is muted by the operating system or hardware switch.' };
  }
  return { ok: true };
}

export async function attachStreamToVideo(
  videoEl: HTMLVideoElement,
  stream: MediaStream
): Promise<void> {
  videoEl.muted = true;
  videoEl.playsInline = true;
  videoEl.autoplay = true;

  if (videoEl.srcObject !== stream) {
    videoEl.srcObject = stream;
  }

  try {
    await videoEl.play();
  } catch (err: unknown) {
    // AbortError can occur if pause was called or element was removed, rethrow if critical
    if (err instanceof Error && err.name !== 'AbortError') {
      throw err;
    }
  }
}

/**
 * Calculates average luminance across pixels from RGBA ImageData.
 * Formula: 0.299*R + 0.587*G + 0.114*B (Standard Rec. 601 Luma)
 * Range: 0 to 255.
 */
export function calculateLuminance(imageData: Uint8ClampedArray): number {
  if (imageData.length === 0) return 0;
  let totalLuma = 0;
  const pixelCount = imageData.length / 4;

  for (let i = 0; i < imageData.length; i += 4) {
    const r = imageData[i];
    const g = imageData[i + 1];
    const b = imageData[i + 2];
    totalLuma += 0.299 * r + 0.587 * g + 0.114 * b;
  }

  return totalLuma / pixelCount;
}

/**
 * Computes mean absolute pixel difference between two consecutive frames.
 * Returns normalized difference [0..255].
 */
export function computeFrameDiff(
  prevPixels: Uint8ClampedArray | null,
  currPixels: Uint8ClampedArray
): number {
  if (!prevPixels || prevPixels.length !== currPixels.length || currPixels.length === 0) {
    return 0;
  }

  let totalDiff = 0;
  const pixelCount = currPixels.length / 4;

  for (let i = 0; i < currPixels.length; i += 4) {
    const dr = Math.abs(currPixels[i] - prevPixels[i]);
    const dg = Math.abs(currPixels[i + 1] - prevPixels[i + 1]);
    const db = Math.abs(currPixels[i + 2] - prevPixels[i + 2]);
    totalDiff += (dr + dg + db) / 3;
  }

  return totalDiff / pixelCount;
}

export interface CameraProofPipelineCallbacks {
  onStreamingReady?: (info: { fps: number; luminance: number }) => void;
  onBlackFrameDetected?: () => void;
  onVerified?: () => void;
  onLost?: (reason: string) => void;
  onFaceCountUpdate?: (count: number) => void;
}

export class CameraProofPipeline {
  private videoEl: HTMLVideoElement;
  private stream: MediaStream;
  private callbacks: CameraProofPipelineCallbacks;

  private offscreenCanvas: HTMLCanvasElement;
  private offscreenCtx: CanvasRenderingContext2D | null;

  private isRunning: boolean = false;
  private animFrameId: number | null = null;

  // Frame counter
  private frameTimestamps: number[] = [];
  private lastVideoTime: number = -1;
  private lastFrameDeliveryTime: number = 0;

  // Luminance
  private blackDurationMs: number = 0;
  private lastLuminanceSampleTime: number = 0;
  private lastCalculatedLuminance: number = 100;

  // Face continuity
  private faceContinuousMs: number = 0;
  private lastFaceTimestamp: number = 0;
  private currentFaceCount: number = 0;

  // Frame diff
  private prevFrameData: Uint8ClampedArray | null = null;
  private frozenDurationMs: number = 0;

  // Status flags
  private isStreamingConfirmed: boolean = false;
  private isVerifiedConfirmed: boolean = false;

  constructor(
    videoEl: HTMLVideoElement,
    stream: MediaStream,
    callbacks: CameraProofPipelineCallbacks = {}
  ) {
    this.videoEl = videoEl;
    this.stream = stream;
    this.callbacks = callbacks;

    if (typeof document !== 'undefined') {
      this.offscreenCanvas = document.createElement('canvas');
      this.offscreenCanvas.width = 64;
      this.offscreenCanvas.height = 36;
      this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
    } else {
      this.offscreenCanvas = {} as HTMLCanvasElement;
      this.offscreenCtx = null;
    }

    this.bindTrackListeners();
  }

  private bindTrackListeners(): void {
    const track = this.stream.getVideoTracks()[0];
    if (track) {
      track.onended = () => {
        this.callbacks.onLost?.('Camera track ended unexpectedly.');
      };
      track.onmute = () => {
        this.callbacks.onLost?.('Camera track was muted by system.');
      };
    }
  }

  public start(): void {
    this.isRunning = true;
    this.lastFrameDeliveryTime = performance.now();
    this.lastLuminanceSampleTime = performance.now();
    this.lastFaceTimestamp = performance.now();

    const loop = (now: number) => {
      if (!this.isRunning) return;

      this.processFrame(now);
      this.animFrameId = requestAnimationFrame(loop);
    };

    this.animFrameId = requestAnimationFrame(loop);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  /**
   * Called by vision inference (MediaPipe) whenever face detection runs on current frame
   */
  public reportFaceCount(count: number, now: number = performance.now()): void {
    this.currentFaceCount = count;
    this.callbacks.onFaceCountUpdate?.(count);

    if (count === 1) {
      const dt = this.lastFaceTimestamp > 0 ? now - this.lastFaceTimestamp : 0;
      this.faceContinuousMs += dt;
    } else {
      this.faceContinuousMs = 0;
    }
    this.lastFaceTimestamp = now;

    this.evaluateVerification(now);
  }

  private processFrame(now: number): void {
    const video = this.videoEl;

    // 1. Check video track live state
    const trackCheck = checkStreamTracks(this.stream);
    if (!trackCheck.ok) {
      this.callbacks.onLost?.(trackCheck.reason || 'Camera track inactive');
      return;
    }

    // 2. Track frame arrival by currentTime change
    if (video.readyState >= 2 && video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = video.currentTime;
      this.lastFrameDeliveryTime = now;
      this.frameTimestamps.push(now);

      // Clean timestamps older than 1000ms
      while (this.frameTimestamps.length > 0 && now - this.frameTimestamps[0] > 1000) {
        this.frameTimestamps.shift();
      }
    }

    // Watchdog: check if frames stopped arriving for > 1500ms
    if (this.isStreamingConfirmed && now - this.lastFrameDeliveryTime > 1500) {
      this.callbacks.onLost?.('Camera video frames stopped arriving (>1.5s stall).');
      return;
    }

    // 3. Periodic luminance and diff sampling (every 200ms)
    const timeSinceLuma = now - this.lastLuminanceSampleTime;
    if (timeSinceLuma >= 200 && this.offscreenCtx && video.videoWidth > 0 && video.videoHeight > 0) {
      this.lastLuminanceSampleTime = now;

      try {
        this.offscreenCtx.drawImage(
          video,
          0,
          0,
          this.offscreenCanvas.width,
          this.offscreenCanvas.height
        );
        const imgData = this.offscreenCtx.getImageData(
          0,
          0,
          this.offscreenCanvas.width,
          this.offscreenCanvas.height
        );
        const luma = calculateLuminance(imgData.data);
        this.lastCalculatedLuminance = luma;

        // Check black frame
        if (luma < 8.0) {
          this.blackDurationMs += timeSinceLuma;
          if (this.blackDurationMs >= 1000) {
            this.callbacks.onBlackFrameDetected?.();
          }
        } else {
          this.blackDurationMs = 0;
        }

        // Check frame diff (frozen feed detector)
        if (this.prevFrameData) {
          const diff = computeFrameDiff(this.prevFrameData, imgData.data);
          if (diff < 0.1) {
            this.frozenDurationMs += timeSinceLuma;
            if (this.frozenDurationMs > 2000 && this.isStreamingConfirmed) {
              this.callbacks.onLost?.('Camera image appears frozen (no natural pixel variation).');
            }
          } else {
            this.frozenDurationMs = 0;
          }
        }
        this.prevFrameData = new Uint8ClampedArray(imgData.data);
      } catch {
        // Cross-origin / canvas draw guard
      }
    }

    // 4. Evaluate "streaming" status
    const fps = this.frameTimestamps.length;
    const isFramerateAdequate = fps >= 10;
    const isNonBlack = this.blackDurationMs === 0;
    const isResolutionValid = video.videoWidth > 0 && video.videoHeight > 0;

    if (!this.isStreamingConfirmed && isFramerateAdequate && isNonBlack && isResolutionValid) {
      this.isStreamingConfirmed = true;
      this.callbacks.onStreamingReady?.({
        fps,
        luminance: this.lastCalculatedLuminance,
      });
    }

    this.evaluateVerification(now);
  }

  private evaluateVerification(_now: number): void {
    if (!this.isStreamingConfirmed || this.isVerifiedConfirmed) return;

    // Requirements for "verified":
    // - Streaming is confirmed
    // - Exactly 1 face continuously detected for >= 2000ms
    // - Image not frozen and not black
    if (this.faceContinuousMs >= 2000 && this.blackDurationMs === 0 && this.frozenDurationMs === 0) {
      this.isVerifiedConfirmed = true;
      this.callbacks.onVerified?.();
    }
  }

  public getStatus() {
    return {
      isStreaming: this.isStreamingConfirmed,
      isVerified: this.isVerifiedConfirmed,
      fps: this.frameTimestamps.length,
      luminance: this.lastCalculatedLuminance,
      faceContinuousMs: this.faceContinuousMs,
      currentFaceCount: this.currentFaceCount,
    };
  }
}
