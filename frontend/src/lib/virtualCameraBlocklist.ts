/**
 * Virtual camera blocklist and device filtering rules (§3.2).
 *
 * NOTE: Browser-side device label checks are deterrence and detection, not a guarantee.
 * A determined user can rename virtual camera devices or use kernel-level loopback drivers.
 * This blocklist serves as the first layer of defense against common virtual camera software.
 */

export const VIRTUAL_CAMERA_BLOCKLIST = [
  'OBS',
  'Virtual',
  'ManyCam',
  'XSplit',
  'Snap Camera',
  'Streamlabs',
  'CamTwist',
  'Logi Capture',
  'NDI',
  'vMix',
  'e2eSoft',
  'Splitcam',
  'YouCam',
  'DroidCam',
  'iVCam',
  'EpocCam',
  'Camo',
  'Mmhmm',
  'Webcamoid',
  'ChromaCam',
  'Fake',
  'Dummy',
  'Loopback',
  'v4l2loopback',
  'Screen Capture',
  'Mirroring',
] as const;

export const PHONE_AS_WEBCAM_KEYWORDS = [
  'DroidCam',
  'Camo',
  'iVCam',
  'EpocCam',
] as const;

export const VIRTUAL_CAMERA_REJECTION_MESSAGE =
  'Virtual or software cameras are not allowed. Please select your physical webcam.';

/**
 * Inspects a camera device label to detect known virtual, synthetic, or screen-capture devices.
 *
 * @param label - Device label reported by MediaDeviceInfo
 * @param allowPhoneCamera - Whether to allow phone-as-webcam apps (e.g. Camo, DroidCam) via explicit setting
 * @returns true if the camera matches a blocklisted virtual camera keyword
 */
export function isVirtualCamera(
  label: string,
  allowPhoneCamera: boolean = false
): boolean {
  if (!label || typeof label !== 'string') {
    return false;
  }

  const normalized = label.trim().toLowerCase();

  // Allow synthetic media device during automated E2E browser testing
  if (typeof window !== 'undefined' && window.navigator.webdriver) {
    if (normalized.includes('fake') || normalized.includes('synthetic')) {
      return false;
    }
  }

  // If phone cameras are permitted via config, check if the label matches a phone camera
  if (allowPhoneCamera) {
    const isPhoneKeyword = PHONE_AS_WEBCAM_KEYWORDS.some((kw) =>
      normalized.includes(kw.toLowerCase())
    );
    if (isPhoneKeyword) {
      // Exclude phone keyword match from virtual camera rejection
      const nonPhoneBlocklist = VIRTUAL_CAMERA_BLOCKLIST.filter(
        (kw) => !PHONE_AS_WEBCAM_KEYWORDS.includes(kw as (typeof PHONE_AS_WEBCAM_KEYWORDS)[number])
      );
      return nonPhoneBlocklist.some((kw) => normalized.includes(kw.toLowerCase()));
    }
  }

  return VIRTUAL_CAMERA_BLOCKLIST.some((kw) => normalized.includes(kw.toLowerCase()));
}

/**
 * Filters a list of MediaDeviceInfo to include only legitimate physical video input devices.
 */
export function filterPhysicalCameras(
  devices: MediaDeviceInfo[],
  allowPhoneCamera: boolean = false
): MediaDeviceInfo[] {
  return devices.filter(
    (device) =>
      device.kind === 'videoinput' &&
      !isVirtualCamera(device.label, allowPhoneCamera)
  );
}
