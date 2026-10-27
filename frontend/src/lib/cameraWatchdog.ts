/**
 * Real-time camera track health monitoring and frame-delivery watchdog (§3.3).
 *
 * Continuously monitors:
 * 1. Track lifecycle events ('ended', 'mute', 'unmute').
 * 2. Hardware device changes ('devicechange' on mediaDevices).
 * 3. 1 Hz polling of track.readyState, track.enabled, and track.getSettings().
 * 4. Frame-delivery watchdog: flags 'frozen_feed' if frames fail to advance for > 1.5 s.
 */

export type CameraIntegrityEventType =
  | 'track_ended'
  | 'track_muted'
  | 'track_unmuted'
  | 'device_changed'
  | 'settings_changed'
  | 'frozen_feed'
  | 'feed_resumed'
  | 'tab_hidden'
  | 'tab_restored'
  | 'system_suspended';

export interface CameraIntegrityEvent {
  type: CameraIntegrityEventType;
  timestamp: number;
  details?: Record<string, unknown>;
}

export interface CameraWatchdogOptions {
  onIntegrityEvent: (event: CameraIntegrityEvent) => void;
  frozenThresholdMs?: number; // default: 1500 ms
  pollIntervalMs?: number;    // default: 1000 ms
}

export class CameraWatchdog {
  private track: MediaStreamTrack;
  private videoElement: HTMLVideoElement | null;
  private options: Required<CameraWatchdogOptions>;
  private isDestroyed: boolean = false;

  // Baseline settings for change detection
  private initialSettings: MediaTrackSettings;

  // Polling & watchdog timers
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private lastTickTime: number = Date.now();

  // Frame delivery state
  private lastFrameTime: number = Date.now();
  private lastVideoCurrentTime: number = -1;
  private isFeedFrozen: boolean = false;
  private rvfcHandle: number | null = null;
  private isTabCurrentlyHidden: boolean = false;
  private tabHiddenStartTime: number = 0;

  // Event listener references for clean cleanup
  private onTrackEndedHandler = () => this.handleTrackEnded();
  private onTrackMutedHandler = () => this.handleTrackMuted();
  private onTrackUnmutedHandler = () => this.handleTrackUnmuted();
  private onDeviceChangeHandler = () => this.handleDeviceChange();
  private onVisibilityChangeHandler = () => this.handleVisibilityChange();
  private onFreezeHandler = () => this.handleFreeze();
  private onResumeHandler = () => this.handleResume();

  constructor(
    track: MediaStreamTrack,
    videoElement: HTMLVideoElement | null,
    options: CameraWatchdogOptions
  ) {
    this.track = track;
    this.videoElement = videoElement;
    this.options = {
      onIntegrityEvent: options.onIntegrityEvent,
      frozenThresholdMs: options.frozenThresholdMs ?? 1500,
      pollIntervalMs: options.pollIntervalMs ?? 1000,
    };

    this.initialSettings = typeof track.getSettings === 'function' ? track.getSettings() : {};

    this.attachListeners();
    this.startPolling();
    this.startFrameWatchdog();
  }

  private attachListeners(): void {
    if (this.track && typeof this.track.addEventListener === 'function') {
      this.track.addEventListener('ended', this.onTrackEndedHandler);
      this.track.addEventListener('mute', this.onTrackMutedHandler);
      this.track.addEventListener('unmute', this.onTrackUnmutedHandler);
    }

    if (
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.addEventListener === 'function'
    ) {
      navigator.mediaDevices.addEventListener('devicechange', this.onDeviceChangeHandler);
    }

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', this.onVisibilityChangeHandler);
      document.addEventListener('freeze', this.onFreezeHandler);
      document.addEventListener('resume', this.onResumeHandler);
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pageshow', this.onResumeHandler);
    }
  }

  private handleTrackEnded(): void {
    if (this.isDestroyed) return;
    this.emitEvent('track_ended', { readyState: this.track.readyState });
  }

  private handleTrackMuted(): void {
    if (this.isDestroyed) return;
    this.emitEvent('track_muted', { muted: this.track.muted });
  }

  private handleTrackUnmuted(): void {
    if (this.isDestroyed) return;
    this.lastFrameTime = Date.now();
    if (this.isFeedFrozen) {
      this.isFeedFrozen = false;
      this.emitEvent('feed_resumed', { reason: 'track_unmuted' });
    }
    this.emitEvent('track_unmuted', { muted: this.track.muted });
  }

  private handleDeviceChange(): void {
    if (this.isDestroyed) return;
    this.emitEvent('device_changed', { currentDeviceId: this.initialSettings.deviceId });
  }

  private handleVisibilityChange(): void {
    if (this.isDestroyed || typeof document === 'undefined') return;
    if (document.hidden) {
      if (!this.isTabCurrentlyHidden) {
        this.isTabCurrentlyHidden = true;
        this.tabHiddenStartTime = Date.now();
        this.emitEvent('tab_hidden', {
          hiddenAt: this.tabHiddenStartTime,
          reason: 'tab_unfocused_or_minimized',
        });
      }
    } else {
      if (this.isTabCurrentlyHidden) {
        this.isTabCurrentlyHidden = false;
        const duration = Date.now() - this.tabHiddenStartTime;
        this.emitEvent('tab_restored', {
          restoredAt: Date.now(),
          durationHiddenMs: duration,
        });
        // Reset frame timer after tab restored
        this.recordFrameDelivered();
      }
    }
  }

  private handleFreeze(): void {
    if (this.isDestroyed) return;
    this.emitEvent('system_suspended', { reason: 'page_freeze_or_lid_closed' });
  }

  private handleResume(): void {
    if (this.isDestroyed) return;
    this.lastTickTime = Date.now();
    this.recordFrameDelivered();
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      if (this.isDestroyed) return;

      // 1. Ready state check
      if (this.track.readyState === 'ended') {
        this.emitEvent('track_ended', { readyState: 'ended' });
        return;
      }

      // 2. Track enabled check
      if (!this.track.enabled) {
        this.emitEvent('track_muted', { enabled: false });
      }

      // 3. Settings drift check
      if (typeof this.track.getSettings === 'function') {
        const current = this.track.getSettings();
        const changed: Record<string, { expected: unknown; actual: unknown }> = {};

        if (this.initialSettings.deviceId && current.deviceId && current.deviceId !== this.initialSettings.deviceId) {
          changed.deviceId = { expected: this.initialSettings.deviceId, actual: current.deviceId };
        }
        if (
          this.initialSettings.width &&
          current.width &&
          Math.abs(current.width - this.initialSettings.width) > 50
        ) {
          changed.width = { expected: this.initialSettings.width, actual: current.width };
        }
        if (
          this.initialSettings.height &&
          current.height &&
          Math.abs(current.height - this.initialSettings.height) > 50
        ) {
          changed.height = { expected: this.initialSettings.height, actual: current.height };
        }
        if (
          this.initialSettings.frameRate &&
          current.frameRate &&
          Math.abs(current.frameRate - this.initialSettings.frameRate) > 10
        ) {
          changed.frameRate = { expected: this.initialSettings.frameRate, actual: current.frameRate };
        }

        if (Object.keys(changed).length > 0) {
          this.emitEvent('settings_changed', changed);
          // Update baseline to prevent spamming
          this.initialSettings = current;
        }
      }
    }, this.options.pollIntervalMs);
  }

  private startFrameWatchdog(): void {
    // If requestVideoFrameCallback is available on HTMLVideoElement, use high-precision callback
    const hasRVFC =
      this.videoElement &&
      'requestVideoFrameCallback' in this.videoElement &&
      typeof this.videoElement.requestVideoFrameCallback === 'function';

    const scheduleRVFC = () => {
      if (this.isDestroyed || !this.videoElement || !hasRVFC || !this.videoElement.requestVideoFrameCallback) return;
      this.rvfcHandle = this.videoElement.requestVideoFrameCallback(() => {
        this.recordFrameDelivered();
        scheduleRVFC();
      });
    };

    if (hasRVFC) {
      scheduleRVFC();
    }

    // Interval watchdog checking frame progression and system suspension
    this.watchdogTimer = setInterval(() => {
      if (this.isDestroyed) return;

      // Check wall-clock leap (system sleep / lid closed / thread suspend)
      const now = Date.now();
      const tickDelta = now - this.lastTickTime;
      this.lastTickTime = now;
      if (tickDelta > 2500) {
        this.emitEvent('system_suspended', {
          reason: 'wall_clock_leap',
          leapMs: tickDelta,
        });
      }

      // Fallback check using video.currentTime
      if (this.videoElement && !this.videoElement.paused && !this.videoElement.ended) {
        const currentPos = this.videoElement.currentTime;
        if (currentPos !== this.lastVideoCurrentTime && currentPos > 0) {
          this.lastVideoCurrentTime = currentPos;
          this.recordFrameDelivered();
        }
      }

      const elapsedSinceLastFrame = Date.now() - this.lastFrameTime;
      if (elapsedSinceLastFrame > this.options.frozenThresholdMs) {
        if (!this.isFeedFrozen) {
          this.isFeedFrozen = true;
          this.emitEvent('frozen_feed', {
            elapsedMs: elapsedSinceLastFrame,
            thresholdMs: this.options.frozenThresholdMs,
          });
        }
      }
    }, 250);
  }

  /**
   * Called whenever a new video frame is received by video element or MediaPipe loop.
   */
  public recordFrameDelivered(): void {
    this.lastFrameTime = Date.now();
    if (this.isFeedFrozen) {
      this.isFeedFrozen = false;
      this.emitEvent('feed_resumed', { resumedAt: this.lastFrameTime });
    }
  }

  private emitEvent(type: CameraIntegrityEventType, details?: Record<string, unknown>): void {
    this.options.onIntegrityEvent({
      type,
      timestamp: Date.now(),
      details,
    });
  }

  public destroy(): void {
    this.isDestroyed = true;

    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.watchdogTimer !== null) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (
      this.rvfcHandle !== null &&
      this.videoElement &&
      'cancelVideoFrameCallback' in this.videoElement &&
      typeof this.videoElement.cancelVideoFrameCallback === 'function'
    ) {
      this.videoElement.cancelVideoFrameCallback(this.rvfcHandle);
      this.rvfcHandle = null;
    }

    if (this.track && typeof this.track.removeEventListener === 'function') {
      this.track.removeEventListener('ended', this.onTrackEndedHandler);
      this.track.removeEventListener('mute', this.onTrackMutedHandler);
      this.track.removeEventListener('unmute', this.onTrackUnmutedHandler);
    }

    if (
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.removeEventListener === 'function'
    ) {
      navigator.mediaDevices.removeEventListener('devicechange', this.onDeviceChangeHandler);
    }

    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', this.onVisibilityChangeHandler);
      document.removeEventListener('freeze', this.onFreezeHandler);
      document.removeEventListener('resume', this.onResumeHandler);
    }

    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('pageshow', this.onResumeHandler);
    }
  }
}
