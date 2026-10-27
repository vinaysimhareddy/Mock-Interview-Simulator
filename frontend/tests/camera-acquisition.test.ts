import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isVirtualCamera,
  filterPhysicalCameras,
  VIRTUAL_CAMERA_BLOCKLIST,
  PHONE_AS_WEBCAM_KEYWORDS,
} from '../src/lib/virtualCameraBlocklist';
import {
  CameraWatchdog,
  CameraIntegrityEvent,
} from '../src/lib/cameraWatchdog';

describe('Virtual Camera Blocklist (§3.2)', () => {
  it('blocks all known virtual, synthetic, or loopback camera labels', () => {
    const virtualNames = [
      'OBS Virtual Camera',
      'obs virtual camera (64bit)',
      'ManyCam Virtual Webcam',
      'XSplit Broadcaster Video',
      'Snap Camera HD',
      'Streamlabs Desktop Virtual Camera',
      'Logi Capture Video Source',
      'v4l2loopback dummy device',
      'Fake Video Device 1',
      'Dummy Camera Stream',
      'vMix Video',
      'NDI Video Stream',
      'Webcamoid Virtual Video',
      'Screen Capture Mirroring',
    ];

    for (const name of virtualNames) {
      expect(isVirtualCamera(name)).toBe(true);
    }
  });

  it('allows legitimate physical webcams and built-in laptop cameras', () => {
    const physicalNames = [
      'Integrated Camera (04f2:b614)',
      'FaceTime HD Camera',
      'Logitech HD Pro Webcam C920',
      'USB 2.0 HD UVC WebCam',
      'Brio 4K Stream Edition',
      'HP Wide Vision HD Camera',
      'Dell Integrated Webcam',
      'Microsoft LifeCam HD-3000',
    ];

    for (const name of physicalNames) {
      expect(isVirtualCamera(name)).toBe(false);
    }
  });

  it('blocks phone-as-webcam apps by default', () => {
    expect(isVirtualCamera('DroidCam Source 1', false)).toBe(true);
    expect(isVirtualCamera('Camo Video Hub', false)).toBe(true);
    expect(isVirtualCamera('iVCam Video Device', false)).toBe(true);
    expect(isVirtualCamera('EpocCam Camera', false)).toBe(true);
  });

  it('allows phone-as-webcam apps when allowPhoneCamera is explicitly enabled', () => {
    expect(isVirtualCamera('DroidCam Source 1', true)).toBe(false);
    expect(isVirtualCamera('Camo Video Hub', true)).toBe(false);
    expect(isVirtualCamera('iVCam Video Device', true)).toBe(false);
    expect(isVirtualCamera('EpocCam Camera', true)).toBe(false);

    // But OBS and generic virtual cameras remain strictly blocked even with phone cameras allowed
    expect(isVirtualCamera('OBS Virtual Camera', true)).toBe(true);
    expect(isVirtualCamera('ManyCam Video', true)).toBe(true);
    expect(isVirtualCamera('v4l2loopback loop', true)).toBe(true);
  });

  it('filterPhysicalCameras removes virtual devices and non-video devices', () => {
    const mockDevices: MediaDeviceInfo[] = [
      {
        deviceId: '1',
        groupId: 'g1',
        kind: 'videoinput',
        label: 'Integrated Camera (04f2:b614)',
        toJSON: () => ({}),
      },
      {
        deviceId: '2',
        groupId: 'g2',
        kind: 'videoinput',
        label: 'OBS Virtual Camera',
        toJSON: () => ({}),
      },
      {
        deviceId: '3',
        groupId: 'g3',
        kind: 'audioinput',
        label: 'Internal Microphone',
        toJSON: () => ({}),
      },
      {
        deviceId: '4',
        groupId: 'g4',
        kind: 'videoinput',
        label: 'Logitech C920 HD Pro',
        toJSON: () => ({}),
      },
    ];

    const filtered = filterPhysicalCameras(mockDevices);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((d) => d.deviceId)).toEqual(['1', '4']);
  });
});

describe('CameraWatchdog (§3.3 Track Health & Frozen Frame Watchdog)', () => {
  type Listener = (e?: unknown) => void;

  class FakeMediaStreamTrack {
    public readyState: MediaStreamTrackState = 'live';
    public enabled: boolean = true;
    public muted: boolean = false;
    private listeners: Record<string, Listener[]> = {};
    private settings: MediaTrackSettings = {
      deviceId: 'cam-physical-01',
      width: 1280,
      height: 720,
      frameRate: 30,
    };

    public addEventListener(event: string, callback: Listener): void {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(callback);
    }

    public removeEventListener(event: string, callback: Listener): void {
      if (this.listeners[event]) {
        this.listeners[event] = this.listeners[event].filter((cb) => cb !== callback);
      }
    }

    public emit(event: string, data?: unknown): void {
      if (this.listeners[event]) {
        for (const cb of this.listeners[event]) {
          cb(data);
        }
      }
    }

    public getSettings(): MediaTrackSettings {
      return { ...this.settings };
    }

    public updateSettings(partial: Partial<MediaTrackSettings>): void {
      this.settings = { ...this.settings, ...partial };
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits track_ended when track fires ended event', () => {
    const fakeTrack = new FakeMediaStreamTrack();
    const events: CameraIntegrityEvent[] = [];

    const watchdog = new CameraWatchdog(fakeTrack as unknown as MediaStreamTrack, null, {
      onIntegrityEvent: (e) => events.push(e),
    });

    fakeTrack.readyState = 'ended';
    fakeTrack.emit('ended');

    expect(events.length).toBe(1);
    expect(events[0].type).toBe('track_ended');

    watchdog.destroy();
  });

  it('emits track_muted and track_unmuted on mute/unmute events', () => {
    const fakeTrack = new FakeMediaStreamTrack();
    const events: CameraIntegrityEvent[] = [];

    const watchdog = new CameraWatchdog(fakeTrack as unknown as MediaStreamTrack, null, {
      onIntegrityEvent: (e) => events.push(e),
    });

    fakeTrack.muted = true;
    fakeTrack.emit('mute');
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('track_muted');

    fakeTrack.muted = false;
    fakeTrack.emit('unmute');
    expect(events.length).toBe(2);
    expect(events[1].type).toBe('track_unmuted');

    watchdog.destroy();
  });

  it('detects settings change during polling (e.g. deviceId swap)', () => {
    const fakeTrack = new FakeMediaStreamTrack();
    const events: CameraIntegrityEvent[] = [];

    const watchdog = new CameraWatchdog(fakeTrack as unknown as MediaStreamTrack, null, {
      onIntegrityEvent: (e) => events.push(e),
      pollIntervalMs: 1000,
    });

    // Change deviceId mid-interview
    fakeTrack.updateSettings({ deviceId: 'cam-different-id' });

    // Advance timer by 1000ms
    vi.advanceTimersByTime(1000);

    const settingsEvents = events.filter((e) => e.type === 'settings_changed');
    expect(settingsEvents.length).toBe(1);
    expect(settingsEvents[0].details?.deviceId).toEqual({
      expected: 'cam-physical-01',
      actual: 'cam-different-id',
    });

    watchdog.destroy();
  });

  it('flags frozen_feed when frames fail to advance for > 1500 ms', () => {
    const fakeTrack = new FakeMediaStreamTrack();
    const events: CameraIntegrityEvent[] = [];

    const watchdog = new CameraWatchdog(fakeTrack as unknown as MediaStreamTrack, null, {
      onIntegrityEvent: (e) => events.push(e),
      frozenThresholdMs: 1500,
    });

    // Keep feeding frames every 100ms for 1 second
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(100);
      watchdog.recordFrameDelivered();
    }
    expect(events.filter((e) => e.type === 'frozen_feed')).toHaveLength(0);

    // Stop feeding frames and advance clock by 1600ms (> 1500ms)
    vi.setSystemTime(Date.now() + 1600);
    vi.advanceTimersByTime(1600);

    const frozenEvents = events.filter((e) => e.type === 'frozen_feed');
    expect(frozenEvents.length).toBe(1);
    expect(frozenEvents[0].type).toBe('frozen_feed');

    // Delivering a new frame should resume the feed
    vi.setSystemTime(Date.now() + 100);
    watchdog.recordFrameDelivered();
    const resumeEvents = events.filter((e) => e.type === 'feed_resumed');
    expect(resumeEvents.length).toBe(1);

    watchdog.destroy();
  });
});
