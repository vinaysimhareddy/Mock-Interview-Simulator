import { useCallback, useEffect, useRef, useState } from 'react';
import { ClientWSMessage, ServerWSMessage, TelemetrySample } from '../lib/types';
import { computeTelemetryHmac, sha256Hex } from '../lib/hmacSignature';

export type WebSocketConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export interface UseWebSocketInterviewOptions {
  sessionId: string | null;
  token: string | null;
  onMessage?: (message: ServerWSMessage) => void;
  onSessionReady?: (sessionId: string) => void;
  onInterviewComplete?: (evaluationId: string) => void;
  autoConnect?: boolean;
}

export interface UseWebSocketInterviewReturn {
  status: WebSocketConnectionStatus;
  isConnected: boolean;
  reconnectCount: number;
  error: string | null;
  ackedPacketCount: number;
  hmacKey: string | null;
  send: (message: ClientWSMessage) => boolean;
  sendTelemetry: (
    sample: TelemetrySample,
    meta?: { cameraLabel?: string; deviceId?: string }
  ) => Promise<boolean>;
  disconnect: () => void;
  connect: () => void;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY_MS = 1000;

export function useWebSocketInterview({
  sessionId,
  token,
  onMessage,
  onSessionReady,
  onInterviewComplete,
  autoConnect = true,
}: UseWebSocketInterviewOptions): UseWebSocketInterviewReturn {
  const [status, setStatus] = useState<WebSocketConnectionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [reconnectCount, setReconnectCount] = useState<number>(0);
  const [ackedPacketCount, setAckedPacketCount] = useState<number>(0);
  const [hmacKey, setHmacKey] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageQueueRef = useRef<ClientWSMessage[]>([]);
  const isManuallyClosedRef = useRef<boolean>(false);
  const hmacKeyRef = useRef<string | null>(null);
  const seqRef = useRef<number>(0);

  // Keep latest callbacks in refs to avoid stale closures
  const onMessageRef = useRef(onMessage);
  const onSessionReadyRef = useRef(onSessionReady);
  const onInterviewCompleteRef = useRef(onInterviewComplete);

  useEffect(() => {
    onMessageRef.current = onMessage;
    onSessionReadyRef.current = onSessionReady;
    onInterviewCompleteRef.current = onInterviewComplete;
  }, [onMessage, onSessionReady, onInterviewComplete]);

  const disconnect = useCallback(() => {
    isManuallyClosedRef.current = true;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.close(1000, 'Client closed session');
      socketRef.current = null;
    }
    setStatus('disconnected');
  }, []);

  const flushQueue = useCallback(() => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    while (messageQueueRef.current.length > 0) {
      const msg = messageQueueRef.current.shift();
      if (msg) {
        try {
          socketRef.current.send(JSON.stringify(msg));
        } catch (err) {
          console.error('Failed to send queued WebSocket message:', err);
          messageQueueRef.current.unshift(msg);
          break;
        }
      }
    }
  }, []);

  const send = useCallback((message: ClientWSMessage): boolean => {
    // Ensure monotonic sequence is attached if telemetry is sent directly via send()
    if (message.type === 'telemetry') {
      if (!message.integrity || message.integrity.seq === undefined) {
        seqRef.current += 1;
        message.integrity = {
          ...message.integrity,
          seq: seqRef.current,
        };
      }
    }

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      try {
        socketRef.current.send(JSON.stringify(message));
        return true;
      } catch (err) {
        console.error('WebSocket send error:', err);
        messageQueueRef.current.push(message);
        return false;
      }
    } else {
      // Queue while reconnecting / disconnected
      messageQueueRef.current.push(message);
      return false;
    }
  }, []);

  const sendTelemetry = useCallback(
    async (
      sample: TelemetrySample,
      meta?: { cameraLabel?: string; deviceId?: string }
    ): Promise<boolean> => {
      seqRef.current += 1;
      const seq = seqRef.current;

      const cameraLabelHash = meta?.cameraLabel
        ? await sha256Hex(meta.cameraLabel)
        : sample.integrity?.camera_label_hash;
      const deviceIdHash = meta?.deviceId
        ? await sha256Hex(meta.deviceId)
        : sample.integrity?.device_id_hash;

      let hmacSig: string | undefined = undefined;
      const key = hmacKeyRef.current;
      if (key) {
        hmacSig = await computeTelemetryHmac(
          key,
          sample.t,
          seq,
          cameraLabelHash,
          deviceIdHash,
          sample.fps
        );
      }

      const signedPacket: TelemetrySample = {
        ...sample,
        integrity: {
          ...sample.integrity,
          seq,
          hmac: hmacSig,
          camera_label_hash: cameraLabelHash,
          device_id_hash: deviceIdHash,
          measured_fps: sample.fps,
          faces_detected: sample.face_present ? (sample.integrity?.faces_detected ?? 1) : 0,
          flags: sample.integrity?.flags || [],
        },
      };

      return send(signedPacket);
    },
    [send]
  );

  const connect = useCallback(() => {
    if (!sessionId || !token) {
      setError('Cannot connect: session ID and authentication token are required.');
      return;
    }

    if (
      socketRef.current &&
      (socketRef.current.readyState === WebSocket.OPEN ||
        socketRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    isManuallyClosedRef.current = false;
    setStatus(reconnectAttemptsRef.current > 0 ? 'reconnecting' : 'connecting');
    setError(null);
    seqRef.current = 0;
    setAckedPacketCount(0);

    // Compute ws protocol and host
    const isHttps = window.location.protocol === 'https:';
    const wsProto = isHttps ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${wsProto}//${host}/api/v1/ws/interview/${encodeURIComponent(sessionId)}?token=${encodeURIComponent(token)}`;

    try {
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        reconnectAttemptsRef.current = 0;
        setReconnectCount(0);
        setError(null);
      };

      socket.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data) as ServerWSMessage;

          // Heartbeat handling: auto pong to server ping
          if (data.type === 'ping') {
            send({ type: 'pong', timestamp: Date.now() / 1000 });
            return;
          }

          if (data.type === 'session_ready') {
            if (data.hmac_key) {
              hmacKeyRef.current = data.hmac_key;
              setHmacKey(data.hmac_key);
            }
            setStatus('connected');
            flushQueue();
            if (onSessionReadyRef.current) {
              onSessionReadyRef.current(data.session_id);
            }
          } else if (data.type === 'ack') {
            if (data.received_type === 'telemetry') {
              setAckedPacketCount((prev) => prev + 1);
            }
          } else if (data.type === 'interview_complete') {
            if (onInterviewCompleteRef.current) {
              onInterviewCompleteRef.current(data.evaluation_id);
            }
          }

          if (onMessageRef.current) {
            onMessageRef.current(data);
          }
        } catch (err) {
          console.error('Failed to parse incoming WebSocket message:', err);
        }
      };

      socket.onerror = (event) => {
        console.warn('WebSocket connection error:', event);
      };

      socket.onclose = (event: CloseEvent) => {
        socketRef.current = null;

        // Policy violation rejection code 4008
        if (event.code === 4008) {
          const reasonMsg = event.reason || 'Authentication or ownership policy violation (code 4008).';
          setError(reasonMsg);
          setStatus('error');
          return;
        }

        if (isManuallyClosedRef.current) {
          setStatus('disconnected');
          return;
        }

        // Automatic exponential backoff reconnection
        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          const attempt = reconnectAttemptsRef.current + 1;
          reconnectAttemptsRef.current = attempt;
          setReconnectCount(attempt);
          setStatus('reconnecting');

          const jitter = typeof crypto !== 'undefined' && crypto.getRandomValues
            ? (crypto.getRandomValues(new Uint32Array(1))[0] % 500)
            : 250;
          const delay = Math.min(
            BASE_RECONNECT_DELAY_MS * Math.pow(2, attempt - 1) + jitter,
            15000
          );

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else {
          setStatus('error');
          setError(`WebSocket connection closed. Reconnect limit exceeded (${MAX_RECONNECT_ATTEMPTS} attempts).`);
        }
      };
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to instantiate WebSocket');
      setStatus('error');
    }
  }, [sessionId, token, flushQueue, send]);

  useEffect(() => {
    if (autoConnect && sessionId && token) {
      connect();
    }
    return () => {
      disconnect();
    };
  }, [autoConnect, sessionId, token, connect, disconnect]);

  return {
    status,
    isConnected: status === 'connected',
    reconnectCount,
    error,
    ackedPacketCount,
    hmacKey,
    send,
    sendTelemetry,
    disconnect,
    connect,
  };
}
