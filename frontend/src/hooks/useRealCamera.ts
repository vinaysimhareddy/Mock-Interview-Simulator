import { useState, useEffect, useRef, useCallback } from 'react';
import {
  isVirtualCamera,
  filterPhysicalCameras,
  VIRTUAL_CAMERA_REJECTION_MESSAGE,
} from '../lib/virtualCameraBlocklist';
import { CameraWatchdog, CameraIntegrityEvent } from '../lib/cameraWatchdog';

export interface UseRealCameraOptions {
  autoStart?: boolean;
  allowPhoneCamera?: boolean;
  onIntegrityEvent?: (event: CameraIntegrityEvent) => void;
}

export type CameraLifecycleStatus =
  | 'idle'
  | 'acquiring'
  | 'ready'
  | 'error'
  | 'muted'
  | 'ended'
  | 'frozen';

export interface UseRealCameraReturn {
  stream: MediaStream | null;
  videoTrack: MediaStreamTrack | null;
  status: CameraLifecycleStatus;
  error: string | null;
  availableCameras: MediaDeviceInfo[];
  activeCameraLabel: string;
  selectedCameraId: string;
  selectCamera: (deviceId: string) => Promise<void>;
  start: () => Promise<void>;
  stop: () => void;
  recordFrameDelivered: () => void;
  isVirtualBlocked: boolean;
}

export const REAL_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, min: 15 },
    facingMode: 'user',
  },
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
};

export function useRealCamera(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  options: UseRealCameraOptions = {}
): UseRealCameraReturn {
  const { autoStart = true, allowPhoneCamera = false, onIntegrityEvent } = options;

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [videoTrack, setVideoTrack] = useState<MediaStreamTrack | null>(null);
  const [status, setStatus] = useState<CameraLifecycleStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [activeCameraLabel, setActiveCameraLabel] = useState<string>('');
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [isVirtualBlocked, setIsVirtualBlocked] = useState<boolean>(false);

  const watchdogRef = useRef<CameraWatchdog | null>(null);

  // Stop active stream and watchdog
  const stop = useCallback(() => {
    if (watchdogRef.current) {
      watchdogRef.current.destroy();
      watchdogRef.current = null;
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setVideoTrack(null);
    setStatus('idle');
  }, [stream, videoRef]);

  // Handle integrity events from watchdog
  const handleWatchdogEvent = useCallback(
    (event: CameraIntegrityEvent) => {
      if (onIntegrityEvent) {
        onIntegrityEvent(event);
      }

      switch (event.type) {
        case 'track_ended':
          setStatus('ended');
          setError('Camera feed disconnected or permission revoked.');
          break;
        case 'track_muted':
          setStatus('muted');
          break;
        case 'track_unmuted':
          setStatus('ready');
          break;
        case 'frozen_feed':
          setStatus('frozen');
          break;
        case 'feed_resumed':
          setStatus('ready');
          break;
        case 'system_suspended':
          setStatus('muted');
          setError('System suspension or laptop lid closure detected. Restoring camera stream.');
          break;
        case 'tab_hidden':
          // Tab placed in background - event forwarded to WebSocket
          break;
        case 'tab_restored':
          if (status === 'frozen') {
            setStatus('ready');
          }
          break;
        case 'device_changed':
          // Re-enumerate devices to detect unplugs
          if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
            navigator.mediaDevices.enumerateDevices().then((devices) => {
              const physical = filterPhysicalCameras(devices, allowPhoneCamera);
              setAvailableCameras(physical);
            });
          }
          break;
        default:
          break;
      }
    },
    [onIntegrityEvent, allowPhoneCamera, status]
  );

  // Enumerate physical devices
  const updateDeviceList = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const physicalCameras = filterPhysicalCameras(allDevices, allowPhoneCamera);
      setAvailableCameras(physicalCameras);
    } catch {
      // Ignore enumeration failure
    }
  }, [allowPhoneCamera]);

  // Acquire camera stream
  const startWithDeviceId = useCallback(
    async (deviceId?: string) => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setError('Media devices API is not supported in this browser environment.');
        setStatus('error');
        return;
      }

      setStatus('acquiring');
      setError(null);
      setIsVirtualBlocked(false);

      try {
        const constraints: MediaStreamConstraints = {
          ...REAL_CAMERA_CONSTRAINTS,
          video: {
            ...(REAL_CAMERA_CONSTRAINTS.video as MediaTrackConstraints),
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          },
        };

        const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        const tracks = mediaStream.getVideoTracks();

        if (tracks.length === 0) {
          mediaStream.getTracks().forEach((t) => t.stop());
          throw new Error('No video track available on acquired media stream.');
        }

        const activeTrack = tracks[0];
        const label = activeTrack.label || '';

        // Virtual Camera Blocklist Check (§3.2)
        if (isVirtualCamera(label, allowPhoneCamera)) {
          // Reject and immediately release hardware
          mediaStream.getTracks().forEach((t) => t.stop());
          setIsVirtualBlocked(true);
          setError(VIRTUAL_CAMERA_REJECTION_MESSAGE);
          setStatus('error');
          await updateDeviceList();
          return;
        }

        // Attach to video element
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          await videoRef.current.play().catch(() => {});
        }

        // Setup Watchdog
        if (watchdogRef.current) {
          watchdogRef.current.destroy();
        }
        watchdogRef.current = new CameraWatchdog(activeTrack, videoRef.current, {
          onIntegrityEvent: handleWatchdogEvent,
        });

        setStream(mediaStream);
        setVideoTrack(activeTrack);
        setActiveCameraLabel(label || 'Physical Camera');
        setSelectedCameraId(activeTrack.getSettings().deviceId || deviceId || '');
        setStatus('ready');

        // Enumerate devices now that labels are unlocked
        await updateDeviceList();
      } catch (err: unknown) {
        const errorMsg =
          err instanceof Error
            ? err.name === 'NotAllowedError'
              ? 'Camera permission denied. Please enable camera access in browser settings.'
              : err.name === 'NotFoundError'
              ? 'No physical webcam detected on this device.'
              : err.name === 'NotReadableError' || err.name === 'TrackStartError'
              ? 'Camera is in use by another application (e.g. Zoom, Teams, Meet). Please close that app and try again.'
              : err.message
            : 'Failed to access camera.';
        setError(errorMsg);
        setStatus('error');
      }
    },
    [allowPhoneCamera, handleWatchdogEvent, updateDeviceList, videoRef]
  );

  const start = useCallback(() => startWithDeviceId(selectedCameraId), [
    startWithDeviceId,
    selectedCameraId,
  ]);

  const selectCamera = useCallback(
    async (deviceId: string) => {
      setSelectedCameraId(deviceId);
      stop();
      await startWithDeviceId(deviceId);
    },
    [startWithDeviceId, stop]
  );

  const recordFrameDelivered = useCallback(() => {
    if (watchdogRef.current) {
      watchdogRef.current.recordFrameDelivered();
    }
  }, []);

  // Monitor dynamic browser permission revocation (§6, R6)
  useEffect(() => {
    let permStatus: PermissionStatus | null = null;
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'camera' as PermissionName })
        .then((statusObj) => {
          permStatus = statusObj;
          statusObj.onchange = () => {
            if (statusObj.state === 'denied') {
              stop();
              setStatus('ended');
              setError('Camera permission was revoked in browser settings.');
              if (onIntegrityEvent) {
                onIntegrityEvent({
                  type: 'track_ended',
                  timestamp: Date.now(),
                  details: { reason: 'permission_revoked_by_user' },
                });
              }
            }
          };
        })
        .catch(() => {});
    }
    return () => {
      if (permStatus) {
        permStatus.onchange = null;
      }
    };
  }, [stop, onIntegrityEvent]);

  // Cleanup on unmount
  useEffect(() => {
    if (autoStart) {
      start();
    }
    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    stream,
    videoTrack,
    status,
    error,
    availableCameras,
    activeCameraLabel,
    selectedCameraId,
    selectCamera,
    start,
    stop,
    recordFrameDelivered,
    isVirtualBlocked,
  };
}
