import { describe, it, expect, vi } from 'vitest';
import {
  checkStreamTracks,
  calculateLuminance,
  computeFrameDiff,
  attachStreamToVideo,
  CameraProofPipeline,
} from '../src/lib/cameraProofPipeline';

describe('Camera Proof Pipeline', () => {
  describe('checkStreamTracks', () => {
    it('rejects null or empty stream', () => {
      expect(checkStreamTracks(null).ok).toBe(false);
      const emptyStream = { active: true, getVideoTracks: () => [] } as unknown as MediaStream;
      expect(checkStreamTracks(emptyStream).ok).toBe(false);
    });

    it('rejects non-live readyState', () => {
      const stream = {
        active: true,
        getVideoTracks: () => [{ readyState: 'ended', enabled: true, muted: false }],
      } as unknown as MediaStream;
      const res = checkStreamTracks(stream);
      expect(res.ok).toBe(false);
      expect(res.reason).toContain('ended');
    });

    it('rejects disabled video track', () => {
      const stream = {
        active: true,
        getVideoTracks: () => [{ readyState: 'live', enabled: false, muted: false }],
      } as unknown as MediaStream;
      const res = checkStreamTracks(stream);
      expect(res.ok).toBe(false);
      expect(res.reason).toContain('disabled');
    });

    it('rejects muted video track', () => {
      const stream = {
        active: true,
        getVideoTracks: () => [{ readyState: 'live', enabled: true, muted: true }],
      } as unknown as MediaStream;
      const res = checkStreamTracks(stream);
      expect(res.ok).toBe(false);
      expect(res.reason).toContain('muted');
    });

    it('accepts live, enabled, unmuted video track', () => {
      const stream = {
        active: true,
        getVideoTracks: () => [{ readyState: 'live', enabled: true, muted: false }],
      } as unknown as MediaStream;
      expect(checkStreamTracks(stream).ok).toBe(true);
    });
  });

  describe('calculateLuminance', () => {
    it('returns 0 for pure black image', () => {
      // 4 pixels of pure black RGBA
      const blackData = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
      expect(calculateLuminance(blackData)).toBe(0);
    });

    it('returns 255 for pure white image', () => {
      const whiteData = new Uint8ClampedArray([
        255, 255, 255, 255, 255, 255, 255, 255,
      ]);
      expect(calculateLuminance(whiteData)).toBeCloseTo(255, 1);
    });

    it('detects shutter / dark lens (luma < 8)', () => {
      const darkData = new Uint8ClampedArray([
        5, 5, 5, 255, 4, 4, 4, 255, 6, 6, 6, 255,
      ]);
      const luma = calculateLuminance(darkData);
      expect(luma).toBeLessThan(8.0);
    });
  });

  describe('computeFrameDiff', () => {
    it('returns 0 for identical frames', () => {
      const frameA = new Uint8ClampedArray([100, 150, 200, 255, 50, 75, 100, 255]);
      const frameB = new Uint8ClampedArray([100, 150, 200, 255, 50, 75, 100, 255]);
      expect(computeFrameDiff(frameA, frameB)).toBe(0);
    });

    it('returns non-zero for natural image change', () => {
      const frameA = new Uint8ClampedArray([100, 150, 200, 255, 50, 75, 100, 255]);
      const frameB = new Uint8ClampedArray([120, 160, 210, 255, 60, 80, 110, 255]);
      expect(computeFrameDiff(frameA, frameB)).toBeGreaterThan(0);
    });
  });

  describe('attachStreamToVideo', () => {
    it('configures video element attributes and calls play()', async () => {
      const playSpy = vi.fn().mockResolvedValue(undefined);
      const fakeVideo = {
        muted: false,
        playsInline: false,
        autoplay: false,
        srcObject: null,
        play: playSpy,
      } as unknown as HTMLVideoElement;

      const fakeStream = {} as MediaStream;
      await attachStreamToVideo(fakeVideo, fakeStream);

      expect(fakeVideo.muted).toBe(true);
      expect(fakeVideo.playsInline).toBe(true);
      expect(fakeVideo.autoplay).toBe(true);
      expect(fakeVideo.srcObject).toBe(fakeStream);
      expect(playSpy).toHaveBeenCalled();
    });
  });

  describe('CameraProofPipeline Face Continuity & Verification', () => {
    it('tracks single face continuity and triggers verified callback at 2000ms', () => {
      const onVerified = vi.fn();
      const onFaceCountUpdate = vi.fn();

      const fakeTrack = {
        readyState: 'live',
        enabled: true,
        muted: false,
        onended: null,
        onmute: null,
      };
      const fakeStream = {
        active: true,
        getVideoTracks: () => [fakeTrack],
      } as unknown as MediaStream;

      const fakeVideo = {
        readyState: 4,
        currentTime: 1.0,
        videoWidth: 640,
        videoHeight: 480,
      } as unknown as HTMLVideoElement;

      const pipeline = new CameraProofPipeline(fakeVideo, fakeStream, {
        onVerified,
        onFaceCountUpdate,
      });

      // Manually simulate streaming confirmed
      // @ts-expect-error accessing private property for unit test
      pipeline.isStreamingConfirmed = true;

      // Report 1 face at t=1000
      pipeline.reportFaceCount(1, 1000);
      expect(onFaceCountUpdate).toHaveBeenCalledWith(1);
      expect(onVerified).not.toHaveBeenCalled();

      // Report 1 face at t=2500 (1500ms elapsed)
      pipeline.reportFaceCount(1, 2500);
      expect(onVerified).not.toHaveBeenCalled();

      // Report 1 face at t=3500 (cumulative 2500ms > 2000ms threshold)
      pipeline.reportFaceCount(1, 3500);
      expect(onVerified).toHaveBeenCalledTimes(1);

      const status = pipeline.getStatus();
      expect(status.isVerified).toBe(true);
      expect(status.faceContinuousMs).toBeGreaterThanOrEqual(2000);
    });

    it('resets face continuity timer if face disappears (count !== 1)', () => {
      const fakeStream = {
        active: true,
        getVideoTracks: () => [{ readyState: 'live', enabled: true, muted: false }],
      } as unknown as MediaStream;
      const fakeVideo = {} as HTMLVideoElement;

      const pipeline = new CameraProofPipeline(fakeVideo, fakeStream);

      pipeline.reportFaceCount(1, 1000);
      pipeline.reportFaceCount(1, 2000); // 1000ms continuous
      expect(pipeline.getStatus().faceContinuousMs).toBe(1000);

      // Face missing
      pipeline.reportFaceCount(0, 2500);
      expect(pipeline.getStatus().faceContinuousMs).toBe(0);

      // Two faces (unauthorized second person)
      pipeline.reportFaceCount(2, 3000);
      expect(pipeline.getStatus().faceContinuousMs).toBe(0);
    });
  });
});
