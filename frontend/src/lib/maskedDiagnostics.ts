/**
 * maskedDiagnostics.ts
 *
 * Generates user-shareable diagnostic snapshot for customer support (§M3).
 * Masks device identifiers/hardware names and never logs secrets or PII.
 */

export interface GenerateMaskedDiagnosticsOptions {
  errorName?: string;
  errorMessage?: string;
  cause?: string;
  audioContextState?: string;
  devices?: MediaDeviceInfo[];
  userAgent?: string;
  speechRecognitionSupported?: boolean;
}

export function detectOS(userAgent: string): string {
  if (userAgent.includes('Win')) return 'Windows';
  if (userAgent.includes('Mac')) return 'macOS';
  if (userAgent.includes('Linux')) return 'Linux';
  if (userAgent.includes('Android')) return 'Android';
  if (userAgent.includes('iPhone') || userAgent.includes('iPad')) return 'iOS';
  return 'Unknown OS';
}

export function detectBrowser(userAgent: string): string {
  const edgeMatch = userAgent.match(/Edg\/(\d+(\.\d+)*)/);
  if (edgeMatch) return `Microsoft Edge ${edgeMatch[1]}`;

  const chromeMatch = userAgent.match(/Chrome\/(\d+(\.\d+)*)/);
  if (chromeMatch) return `Google Chrome ${chromeMatch[1]}`;

  const firefoxMatch = userAgent.match(/Firefox\/(\d+(\.\d+)*)/);
  if (firefoxMatch) return `Mozilla Firefox ${firefoxMatch[1]}`;

  const safariMatch = userAgent.match(/Version\/(\d+(\.\d+)*).*Safari/);
  if (safariMatch) return `Apple Safari ${safariMatch[1]}`;

  return userAgent.slice(0, 40) || 'Unknown Browser';
}

export function maskDeviceLabel(label: string, index: number, kind: MediaDeviceKind): string {
  if (!label || label.trim().length === 0) {
    return `${kind === 'audioinput' ? 'Microphone' : kind === 'videoinput' ? 'Camera' : 'Speaker'} ${index + 1} (Unlabeled)`;
  }
  // Keep general category/brand prefix, mask specific serials or long model tails
  const parts = label.trim().split(/\s+/);
  const prefix = parts.slice(0, 2).join(' ');
  return `${prefix} [Masked Device ${index + 1}]`;
}

export function generateMaskedDiagnostics(options: GenerateMaskedDiagnosticsOptions = {}): string {
  const ua = options.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown');
  const os = detectOS(ua);
  const browser = detectBrowser(ua);

  const speechSupported =
    options.speechRecognitionSupported ??
    (typeof window !== 'undefined' &&
      Boolean(
        window.SpeechRecognition ||
          (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
      ));

  const devices = options.devices || [];
  const audioCount = devices.filter((d) => d.kind === 'audioinput').length;
  const videoCount = devices.filter((d) => d.kind === 'videoinput').length;
  const audioOutputCount = devices.filter((d) => d.kind === 'audiooutput').length;

  const maskedDevices = devices.map((d, i) => {
    const maskedLabel = maskDeviceLabel(d.label, i, d.kind);
    const maskedId = d.deviceId ? `${d.deviceId.slice(0, 4)}***` : 'unassigned';
    return `  - [${d.kind}] ${maskedLabel} (id: ${maskedId})`;
  });

  return [
    `=== Interview Diagnostic Report ===`,
    `Timestamp: ${new Date().toISOString()}`,
    `Error Name: ${options.errorName || 'None'}`,
    `Error Message: ${options.errorMessage || 'None'}`,
    `Identified Cause: ${options.cause || 'Unknown'}`,
    `Operating System: ${os}`,
    `Browser: ${browser}`,
    `AudioContext State: ${options.audioContextState || 'Not Initialized'}`,
    `SpeechRecognition Supported: ${speechSupported ? 'YES' : 'NO'}`,
    `Device Summary: ${devices.length} total (${audioCount} audio inputs, ${videoCount} cameras, ${audioOutputCount} speakers)`,
    `Connected Devices (Masked):`,
    ...(maskedDevices.length > 0 ? maskedDevices : ['  - No devices enumerated or permission pending']),
    `===================================`,
  ].join('\n');
}

