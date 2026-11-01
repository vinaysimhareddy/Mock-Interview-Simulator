/**
 * Cryptographic HMAC signature generation and verification for 1 Hz telemetry packets (§5.1).
 * Matches backend `HMACManager.compute_signature` format and verification.
 */

/**
 * Computes SHA-256 hex digest of a UTF-8 string.
 */
export async function sha256Hex(text: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generates canonical payload string for telemetry HMAC signature.
 * Format: `${t.toFixed(3)}:${seq}:${camera_label_hash || ''}:${device_id_hash || ''}:${(measured_fps || 0.0).toFixed(2)}`
 */
export function computeCanonicalPayload(
  t: number,
  seq: number,
  cameraLabelHash?: string,
  deviceIdHash?: string,
  measuredFps?: number
): string {
  const tFormatted = t.toFixed(3);
  const fpsFormatted = (measuredFps !== undefined && measuredFps !== null && !isNaN(measuredFps) ? measuredFps : 0.0).toFixed(2);
  const camHash = cameraLabelHash || '';
  const devHash = deviceIdHash || '';
  return `${tFormatted}:${seq}:${camHash}:${devHash}:${fpsFormatted}`;
}

/**
 * Computes HMAC-SHA256 signature over packet canonical parameters using Web Crypto API.
 *
 * @param key Session HMAC key (hex string or secret string)
 * @param t Timestamp in seconds elapsed since interview start
 * @param seq Monotonically increasing sequence number
 * @param cameraLabelHash Optional SHA-256 hash of active camera label
 * @param deviceIdHash Optional SHA-256 hash of active device ID
 * @param measuredFps Measured frames per second
 * @returns 64-character lowercase hex signature
 */
export async function computeTelemetryHmac(
  key: string,
  t: number,
  seq: number,
  cameraLabelHash?: string,
  deviceIdHash?: string,
  measuredFps?: number
): Promise<string> {
  const payload = computeCanonicalPayload(t, seq, cameraLabelHash, deviceIdHash, measuredFps);
  const enc = new TextEncoder();
  const keyBytes = enc.encode(key);
  const payloadBytes = enc.encode(payload);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, payloadBytes);
  const hashArray = Array.from(new Uint8Array(signatureBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verifies HMAC-SHA256 signature against key and packet canonical parameters.
 */
export async function verifyTelemetryHmac(
  key: string,
  signature: string,
  t: number,
  seq: number,
  cameraLabelHash?: string,
  deviceIdHash?: string,
  measuredFps?: number
): Promise<boolean> {
  if (!signature) return false;
  const expected = await computeTelemetryHmac(key, t, seq, cameraLabelHash, deviceIdHash, measuredFps);
  return expected.toLowerCase() === signature.toLowerCase();
}
