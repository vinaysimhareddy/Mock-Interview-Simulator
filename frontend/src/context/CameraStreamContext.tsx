import React, { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react';
import { filterPhysicalCameras } from '../lib/virtualCameraBlocklist';
import { recordGetUserMediaCall } from '../lib/diagnosticsCollector';

export interface MediaStreamContextType {
  // Video Stream & Device Info
  stream: MediaStream | null;
  videoStream: MediaStream | null;
  activeTrack: MediaStreamTrack | null;
  selectedDeviceId: string;
  activeCameraLabel: string;
  availableCameras: MediaDeviceInfo[];
  refCount: number;
  acquireCamera: (deviceId?: string) => Promise<MediaStream>;
  releaseCamera: () => void;
  setSelectedDeviceId: (id: string) => void;
  refreshCameras: () => Promise<MediaDeviceInfo[]>;

  // Audio Stream & Device Info
  audioStream: MediaStream | null;
  activeAudioTrack: MediaStreamTrack | null;
  selectedMicDeviceId: string;
  activeMicLabel: string;
  availableMicrophones: MediaDeviceInfo[];
  setSelectedMicDeviceId: (id: string) => void;
  refreshMicrophones: () => Promise<MediaDeviceInfo[]>;
  setAudioStream: (stream: MediaStream | null) => void;
  acquireAudio: (deviceId?: string) => Promise<MediaStream>;
  releaseAudio: () => void;

  // Session Handover & Teardown
  retainForInterview: () => void;
  isRetainedForInterview: boolean;
  stopAll: () => void;
}

export type CameraStreamContextType = MediaStreamContextType;

const MediaStreamContext = createContext<MediaStreamContextType | null>(null);

export interface MediaStreamProviderProps {
  children: React.ReactNode;
}

export function MediaStreamProvider({ children }: MediaStreamProviderProps): React.ReactElement {
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [audioStream, setAudioStreamState] = useState<MediaStream | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [selectedMicDeviceId, setSelectedMicDeviceId] = useState<string>('');
  const [activeCameraLabel, setActiveCameraLabel] = useState<string>('');
  const [activeMicLabel, setActiveMicLabel] = useState<string>('');
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [availableMicrophones, setAvailableMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [refCount, setRefCount] = useState<number>(0);
  const [isRetainedForInterview, setIsRetainedForInterview] = useState<boolean>(false);

  const videoStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const refCountRef = useRef<number>(0);
  const audioRefCountRef = useRef<number>(0);
  const isRetainedRef = useRef<boolean>(false);
  const currentDeviceIdRef = useRef<string>('');
  const currentMicDeviceIdRef = useRef<string>('');

  const refreshCameras = useCallback(async (): Promise<MediaDeviceInfo[]> => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return [];
    }
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const physical = filterPhysicalCameras(all, false);
      setAvailableCameras(physical);
      return physical;
    } catch {
      return [];
    }
  }, []);

  const refreshMicrophones = useCallback(async (): Promise<MediaDeviceInfo[]> => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return [];
    }
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const mics = all.filter((d) => d.kind === 'audioinput');
      setAvailableMicrophones(mics);
      return mics;
    } catch {
      return [];
    }
  }, []);

  // Listen for device changes (plug/unplug) to dynamically update available devices
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.addEventListener) {
      return;
    }
    const handleDeviceChange = async () => {
      try {
        await refreshCameras();
        await refreshMicrophones();
      } catch {
        // Device enumeration error handled silently
      }
    };
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [refreshCameras, refreshMicrophones]);

  const acquireCamera = useCallback(async (requestedDeviceId?: string): Promise<MediaStream> => {
    const targetId = requestedDeviceId ?? currentDeviceIdRef.current;

    // If stream is active and same device requested, increment ref count and reuse
    if (
      videoStreamRef.current &&
      videoStreamRef.current.active &&
      videoStreamRef.current.getVideoTracks().length > 0 &&
      videoStreamRef.current.getVideoTracks()[0].readyState === 'live' &&
      (!targetId || currentDeviceIdRef.current === targetId)
    ) {
      refCountRef.current += 1;
      setRefCount(refCountRef.current);
      return videoStreamRef.current;
    }

    // Stop existing video stream if switching device
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach((t) => t.stop());
      videoStreamRef.current = null;
    }

    const constraints: MediaStreamConstraints = {
      video: targetId
        ? { deviceId: { ideal: targetId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
        : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: false,
    };

    const newStream = await navigator.mediaDevices.getUserMedia(constraints);
    recordGetUserMediaCall('video');
    videoStreamRef.current = newStream;
    refCountRef.current = 1;
    currentDeviceIdRef.current = targetId;

    const track = newStream.getVideoTracks()[0];
    const label = track?.label || 'Webcam';
    setActiveCameraLabel(label);
    setVideoStream(newStream);
    setRefCount(1);

    await refreshCameras();
    return newStream;
  }, [refreshCameras]);

  const releaseCamera = useCallback(() => {
    if (refCountRef.current > 0) {
      refCountRef.current -= 1;
      setRefCount(refCountRef.current);
    }

    // Only shut down tracks if not retained for active interview handover
    if (refCountRef.current <= 0 && !isRetainedRef.current && videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach((t) => t.stop());
      videoStreamRef.current = null;
      currentDeviceIdRef.current = '';
      setVideoStream(null);
      setActiveCameraLabel('');
    }
  }, []);

  const setAudioStream = useCallback((stream: MediaStream | null) => {
    audioStreamRef.current = stream;
    setAudioStreamState(stream);
    if (stream) {
      const track = stream.getAudioTracks()[0];
      if (track) {
        setActiveMicLabel(track.label || 'Microphone');
      }
    } else {
      setActiveMicLabel('');
    }
  }, []);

  const acquireAudio = useCallback(async (requestedDeviceId?: string): Promise<MediaStream> => {
    const targetId = requestedDeviceId ?? currentMicDeviceIdRef.current;

    // If stream is active and same device requested, reuse
    if (
      audioStreamRef.current &&
      audioStreamRef.current.active &&
      audioStreamRef.current.getAudioTracks().length > 0 &&
      audioStreamRef.current.getAudioTracks()[0].readyState === 'live' &&
      (!targetId || currentMicDeviceIdRef.current === targetId)
    ) {
      audioRefCountRef.current += 1;
      return audioStreamRef.current;
    }

    // Stop existing audio stream if switching device or re-acquiring
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;
    }

    const tryGetUserMedia = async (constraints: MediaStreamConstraints): Promise<MediaStream> => {
      return await navigator.mediaDevices.getUserMedia(constraints);
    };

    // Primary constraints: ideal deviceId (never exact), standard voice enhancements
    const primaryConstraints: MediaStreamConstraints = {
      audio: targetId
        ? {
            deviceId: { ideal: targetId },
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }
        : {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
      video: false,
    };

    let stream: MediaStream | null = null;

    try {
      stream = await tryGetUserMedia(primaryConstraints);
    } catch (err: unknown) {
      const errorName = err instanceof Error ? err.name : '';

      // Fallback 1: If NotReadableError, wait 500ms and retry once (releases a transient device lock)
      if (errorName === 'NotReadableError') {
        await new Promise((r) => setTimeout(r, 500));
        try {
          stream = await tryGetUserMedia(primaryConstraints);
        } catch (retryErr: unknown) {
          const retryErrName = retryErr instanceof Error ? retryErr.name : '';
          if (retryErrName !== 'OverconstrainedError' && retryErrName !== 'NotFoundError') {
            throw retryErr;
          }
        }
      }

      // Fallback 2: If OverconstrainedError or NotFoundError with targetId, retry without deviceId
      if (!stream) {
        if (
          errorName === 'OverconstrainedError' ||
          (targetId && (errorName === 'ConstraintNotSatisfiedError' || errorName === 'NotFoundError'))
        ) {
          try {
            stream = await tryGetUserMedia({
              audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
              video: false,
            });
          } catch {
            // Final fallback to bare audio: true
            stream = await tryGetUserMedia({ audio: true, video: false });
          }
        } else if (errorName !== 'NotAllowedError' && errorName !== 'SecurityError') {
          // Fallback to bare audio: true for general device driver compatibility
          try {
            stream = await tryGetUserMedia({ audio: true, video: false });
          } catch {
            throw err;
          }
        } else {
          throw err;
        }
      }
    }

    recordGetUserMediaCall('audio');
    audioStreamRef.current = stream;
    audioRefCountRef.current = 1;
    currentMicDeviceIdRef.current = targetId;

    const track = stream.getAudioTracks()[0];
    const label = track?.label || 'Microphone';
    setActiveMicLabel(label);
    setAudioStreamState(stream);
    setSelectedMicDeviceId(targetId || track?.getSettings()?.deviceId || '');

    // Refresh devices now that permission is granted and device labels are unlocked
    await refreshMicrophones();

    return stream;
  }, [refreshMicrophones]);

  const releaseAudio = useCallback(() => {
    if (audioRefCountRef.current > 0) {
      audioRefCountRef.current -= 1;
    }

    // Only shut down tracks if not retained for active interview handover
    if (audioRefCountRef.current <= 0 && !isRetainedRef.current && audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;
      currentMicDeviceIdRef.current = '';
      setAudioStreamState(null);
      setActiveMicLabel('');
    }
  }, []);

  const retainForInterview = useCallback(() => {
    isRetainedRef.current = true;
    setIsRetainedForInterview(true);
  }, []);

  const stopAll = useCallback(() => {
    isRetainedRef.current = false;
    setIsRetainedForInterview(false);
    refCountRef.current = 0;
    audioRefCountRef.current = 0;
    setRefCount(0);

    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach((t) => t.stop());
      videoStreamRef.current = null;
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;
    }

    setVideoStream(null);
    setAudioStreamState(null);
    currentDeviceIdRef.current = '';
    currentMicDeviceIdRef.current = '';
    setActiveCameraLabel('');
    setActiveMicLabel('');
  }, []);

  // Cleanup on unmount of the entire provider (e.g. app close)
  useEffect(() => {
    return () => {
      if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach((t) => t.stop());
        videoStreamRef.current = null;
      }
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((t) => t.stop());
        audioStreamRef.current = null;
      }
    };
  }, []);

  const activeTrack = videoStream?.getVideoTracks()[0] ?? null;
  const activeAudioTrack = audioStream?.getAudioTracks()[0] ?? null;

  return (
    <MediaStreamContext.Provider
      value={{
        stream: videoStream,
        videoStream,
        activeTrack,
        selectedDeviceId,
        activeCameraLabel,
        availableCameras,
        refCount,
        acquireCamera,
        releaseCamera,
        setSelectedDeviceId,
        refreshCameras,
        audioStream,
        activeAudioTrack,
        selectedMicDeviceId,
        activeMicLabel,
        availableMicrophones,
        setSelectedMicDeviceId,
        refreshMicrophones,
        setAudioStream,
        acquireAudio,
        releaseAudio,
        retainForInterview,
        isRetainedForInterview,
        stopAll,
      }}
    >
      {children}
    </MediaStreamContext.Provider>
  );
}

// Backward-compatible alias
export const CameraStreamProvider = MediaStreamProvider;

export function useMediaStream(): MediaStreamContextType {
  const ctx = useContext(MediaStreamContext);
  if (!ctx) {
    throw new Error('useMediaStream must be used within a MediaStreamProvider');
  }
  return ctx;
}

// Backward-compatible alias
export const useCameraStream = useMediaStream;
