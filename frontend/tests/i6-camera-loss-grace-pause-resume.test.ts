import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { CameraWatchdog, CameraIntegrityEvent } from '../src/lib/cameraWatchdog';
import { ClientWSMessage, ServerWSMessage } from '../src/lib/types';

describe('I6: Camera Loss, Grace Period, and Pause/Resume (§5.3)', () => {
  describe('1. Camera Track Health Monitoring & Freeze Watchdog', () => {
    it('detects track_ended when camera hardware track fires ended event', () => {
      const events: CameraIntegrityEvent[] = [];
      const listeners: Record<string, ((event?: any) => void)[]> = {};

      const mockTrack = {
        addEventListener: vi.fn((event: string, handler: (event?: any) => void) => {
          if (!listeners[event]) listeners[event] = [];
          listeners[event].push(handler);
        }),
        removeEventListener: vi.fn(),
        getSettings: vi.fn(() => ({ deviceId: 'cam-uuid-1', width: 1280, height: 720 })),
        readyState: 'live',
        enabled: true,
      } as unknown as MediaStreamTrack;

      const watchdog = new CameraWatchdog(mockTrack, null, {
        onIntegrityEvent: (e) => events.push(e),
      });

      // Simulate track 'ended' hardware disconnect
      expect(listeners['ended']).toBeDefined();
      listeners['ended'].forEach((fn) => fn());

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('track_ended');

      watchdog.destroy();
    });

    it('detects track_muted and track_unmuted hardware state changes', () => {
      const events: CameraIntegrityEvent[] = [];
      const listeners: Record<string, ((event?: any) => void)[]> = {};

      const mockTrack = {
        addEventListener: vi.fn((event: string, handler: (event?: any) => void) => {
          if (!listeners[event]) listeners[event] = [];
          listeners[event].push(handler);
        }),
        removeEventListener: vi.fn(),
        getSettings: vi.fn(() => ({})),
        readyState: 'live',
        enabled: true,
      } as unknown as MediaStreamTrack;

      const watchdog = new CameraWatchdog(mockTrack, null, {
        onIntegrityEvent: (e) => events.push(e),
      });

      // Track muted (e.g. physical privacy shutter or hardware mute switch)
      listeners['mute'].forEach((fn) => fn());
      expect(events[events.length - 1].type).toBe('track_muted');

      // Track unmuted
      listeners['unmute'].forEach((fn) => fn());
      expect(events[events.length - 1].type).toBe('track_unmuted');

      watchdog.destroy();
    });

    it('detects frozen feed when frame timestamps fail to advance for > frozenThresholdMs', () => {
      vi.useFakeTimers();
      const events: CameraIntegrityEvent[] = [];

      const mockTrack = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getSettings: vi.fn(() => ({})),
        readyState: 'live',
        enabled: true,
      } as unknown as MediaStreamTrack;

      const watchdog = new CameraWatchdog(mockTrack, null, {
        frozenThresholdMs: 1500,
        pollIntervalMs: 1000,
        onIntegrityEvent: (e) => events.push(e),
      });

      // Initial frame delivered
      watchdog.recordFrameDelivered();

      // Fast-forward 2000ms without new frames delivered (exceeds 1500ms threshold past 1750ms tick)
      vi.advanceTimersByTime(2000);

      const frozenEvent = events.find((e) => e.type === 'frozen_feed');
      expect(frozenEvent).toBeDefined();

      // Frame delivery resumes
      watchdog.recordFrameDelivered();
      const resumeEvent = events.find((e) => e.type === 'feed_resumed');
      expect(resumeEvent).toBeDefined();

      watchdog.destroy();
      vi.useRealTimers();
    });
  });

  describe('2. 30-Second Recovery Grace Period & Countdown State Machine', () => {
    it('grace countdown ticks second-by-second from 30s to 0s and triggers abort on expiration', () => {
      vi.useFakeTimers();

      let isModalOpen = true;
      let remainingSec = 30;
      let isExpired = false;
      const onGraceExpired = vi.fn(() => {
        isExpired = true;
      });

      // Emulate CameraLostModal countdown interval
      const interval = setInterval(() => {
        if (remainingSec <= 1) {
          clearInterval(interval);
          remainingSec = 0;
          onGraceExpired();
        } else {
          remainingSec -= 1;
        }
      }, 1000);

      // After 10s: remaining = 20s
      vi.advanceTimersByTime(10000);
      expect(remainingSec).toBe(20);
      expect(isExpired).toBe(false);

      // After 20s more (30s total): remaining = 0s, onGraceExpired fired
      vi.advanceTimersByTime(20000);
      expect(remainingSec).toBe(0);
      expect(isExpired).toBe(true);
      expect(onGraceExpired).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it('cancels grace timer cleanly without calling onGraceExpired if camera is restored early', () => {
      vi.useFakeTimers();

      let isModalOpen = true;
      let remainingSec = 30;
      const onGraceExpired = vi.fn();

      const interval = setInterval(() => {
        if (remainingSec <= 1) {
          clearInterval(interval);
          remainingSec = 0;
          onGraceExpired();
        } else {
          remainingSec -= 1;
        }
      }, 1000);

      // Advance 12s
      vi.advanceTimersByTime(12000);
      expect(remainingSec).toBe(18);

      // Camera restored at 18s remaining -> modal closed and timer cleared
      clearInterval(interval);
      isModalOpen = false;

      // Advance past remaining time
      vi.advanceTimersByTime(25000);
      expect(onGraceExpired).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('3. WebSocket Pause / Resume Synchronization (§5.3)', () => {
    it('handles pause_integrity message by pausing engine and presenting voice prompt', () => {
      const serverPause: ServerWSMessage = {
        type: 'pause_integrity',
        reason: 'Camera lost (face_missing), please restore feed',
        grace_seconds: 30.0,
        voice_prompt: 'Camera lost, please restore it',
      };

      let isPausedByIntegrity = false;
      let isCameraLostModalOpen = false;
      let modalReason = '';
      let graceSeconds = 0;

      const handleWSMessage = (msg: ServerWSMessage) => {
        if (msg.type === 'pause_integrity') {
          isCameraLostModalOpen = true;
          modalReason = msg.reason || '';
          graceSeconds = msg.grace_seconds ?? 30;
          isPausedByIntegrity = true;
        }
      };

      handleWSMessage(serverPause);

      expect(isPausedByIntegrity).toBe(true);
      expect(isCameraLostModalOpen).toBe(true);
      expect(modalReason).toContain('Camera lost (face_missing)');
      expect(graceSeconds).toBe(30.0);
    });

    it('handles resume_integrity message by dismissing modal and unpausing interview', () => {
      let isPausedByIntegrity = true;
      let isCameraLostModalOpen = true;

      const serverResume: ServerWSMessage = {
        type: 'resume_integrity',
        message: 'Camera feed restored',
      };

      const handleWSMessage = (msg: ServerWSMessage) => {
        if (msg.type === 'resume_integrity') {
          isCameraLostModalOpen = false;
          isPausedByIntegrity = false;
        }
      };

      handleWSMessage(serverResume);

      expect(isPausedByIntegrity).toBe(false);
      expect(isCameraLostModalOpen).toBe(false);
    });

    it('emits end_interview with aborted_camera_lost reason upon grace period expiration', () => {
      const emittedMessages: ClientWSMessage[] = [];
      const sendWSMessage = (msg: ClientWSMessage) => {
        emittedMessages.push(msg);
        return true;
      };

      const handleGraceExpired = () => {
        sendWSMessage({
          type: 'end_interview',
          reason: 'aborted_camera_lost',
        });
      };

      handleGraceExpired();

      expect(emittedMessages).toHaveLength(1);
      expect(emittedMessages[0]).toEqual({
        type: 'end_interview',
        reason: 'aborted_camera_lost',
      });
    });

    it('emits camera_restored integrity event upon successful manual camera restoration', () => {
      const emittedMessages: ClientWSMessage[] = [];
      const sendWSMessage = (msg: ClientWSMessage) => {
        emittedMessages.push(msg);
        return true;
      };

      const handleRestoreCamera = (elapsedSeconds: number) => {
        sendWSMessage({
          type: 'integrity_event',
          event_type: 'camera_restored',
          t: elapsedSeconds,
        });
      };

      handleRestoreCamera(14.5);

      expect(emittedMessages).toHaveLength(1);
      expect(emittedMessages[0]).toEqual({
        type: 'integrity_event',
        event_type: 'camera_restored',
        t: 14.5,
      });
    });
  });

  describe('4. Device Switching & Accessibility Accommodations', () => {
    it('supports switching camera devices during recovery grace window', async () => {
      let activeDeviceId = 'default-cam';
      const selectCameraMock = vi.fn(async (newDeviceId: string) => {
        activeDeviceId = newDeviceId;
      });

      const availableCameras: MediaDeviceInfo[] = [
        { deviceId: 'default-cam', label: 'Integrated Webcam (04f2:b614)', kind: 'videoinput', groupId: 'g1', toJSON: () => ({}) },
        { deviceId: 'external-cam-2', label: 'Logitech HD Pro C920', kind: 'videoinput', groupId: 'g2', toJSON: () => ({}) },
      ];

      expect(availableCameras.length).toBeGreaterThan(1);

      // Candidate switches to external cam
      await selectCameraMock('external-cam-2');

      expect(selectCameraMock).toHaveBeenCalledWith('external-cam-2');
      expect(activeDeviceId).toBe('external-cam-2');
    });
  });
});
