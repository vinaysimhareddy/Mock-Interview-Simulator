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

  // Audio Stream
  audioStream: MediaStream | null;
  setAudioStream: (stream: MediaStream | null) => void;
  acquireAudio: () => Promise<MediaStream>;

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
  const [activeCameraLabel, setActiveCameraLabel] = useState<string>('');
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [refCount, setRefCount] = useState<number>(0);
  const [isRetainedForInterview, setIsRetainedForInterview] = useState<boolean>(false);

  const videoStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const refCountRef = useRef<number>(0);
  const isRetainedRef = useRef<boolean>(false);
  const currentDeviceIdRef = useRef<string>('');

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
  }, []);

  const acquireAudio = useCallback(async (): Promise<MediaStream> => {
    if (
      audioStreamRef.current &&
      audioStreamRef.current.active &&
      audioStreamRef.current.getAudioTracks().length > 0 &&
      audioStreamRef.current.getAudioTracks()[0].readyState === 'live'
    ) {
      return audioStreamRef.current;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    recordGetUserMediaCall('audio');
    audioStreamRef.current = stream;
    setAudioStreamState(stream);
    return stream;
  }, []);

  const retainForInterview = useCallback(() => {
    isRetainedRef.current = true;
    setIsRetainedForInterview(true);
  }, []);

  const stopAll = useCallback(() => {
    isRetainedRef.current = false;
    setIsRetainedForInterview(false);
    refCountRef.current = 0;
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
    setActiveCameraLabel('');
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
        setAudioStream,
        acquireAudio,
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

