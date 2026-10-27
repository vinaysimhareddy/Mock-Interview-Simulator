import { test, expect } from '@playwright/test';

test.describe('Pre-Interview Verification Gating & Hardware Invariants (§S6)', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept MediaPipe FaceLandmarker in browser context so fake Chromium camera stream
    // produces canonical valid face landmarks for quality evaluation and frame capture.
    await page.addInitScript(() => {
      // Synthetic canonical face landmarks (478 points, centered, normal distance, frontal pose)
      const syntheticLandmarks: Array<{ x: number; y: number; z: number }> = [];
      for (let i = 0; i < 478; i++) {
        // Place key landmarks: 1 (nose tip), 33 (left eye), 263 (right eye), 61 (mouth left), 291 (mouth right), 152 (chin), 10 (top)
        if (i === 1) syntheticLandmarks.push({ x: 0.50, y: 0.45, z: 0.0 });
        else if (i === 33) syntheticLandmarks.push({ x: 0.40, y: 0.38, z: 0.0 });
        else if (i === 263) syntheticLandmarks.push({ x: 0.60, y: 0.38, z: 0.0 });
        else if (i === 61) syntheticLandmarks.push({ x: 0.45, y: 0.55, z: 0.0 });
        else if (i === 291) syntheticLandmarks.push({ x: 0.55, y: 0.55, z: 0.0 });
        else if (i === 10) syntheticLandmarks.push({ x: 0.50, y: 0.25, z: 0.0 });
        else if (i === 152) syntheticLandmarks.push({ x: 0.50, y: 0.65, z: 0.0 });
        else if (i === 199) syntheticLandmarks.push({ x: 0.50, y: 0.60, z: 0.0 });
        else if (i === 133) syntheticLandmarks.push({ x: 0.43, y: 0.38, z: 0.0 });
        else if (i === 362) syntheticLandmarks.push({ x: 0.57, y: 0.38, z: 0.0 });
        else {
          syntheticLandmarks.push({
            x: 0.35 + ((i % 20) / 20) * 0.30,
            y: 0.28 + (Math.floor(i / 20) / 24) * 0.36,
            z: 0.0,
          });
        }
      }

      const syntheticBlendshapes = [
        {
          categories: [
            { categoryName: 'eyeBlinkLeft', score: 0.05 },
            { categoryName: 'eyeBlinkRight', score: 0.05 },
            { categoryName: 'jawOpen', score: 0.02 },
          ],
        },
      ];

      // Expose test FaceLandmarker to visionManager for synthetic fake camera validation
      // @ts-ignore
      window.__VISION_TEST_LANDMARKER__ = {
        detect: () => ({
          faceLandmarks: [syntheticLandmarks],
          faceBlendshapes: syntheticBlendshapes,
          facialTransformationMatrixes: [],
        }),
        detectForVideo: () => ({
          faceLandmarks: [syntheticLandmarks],
          faceBlendshapes: syntheticBlendshapes,
          facialTransformationMatrixes: [],
        }),
        close: () => {},
      };
    });
  });

  test('enforces strict gating, single getUserMedia invariant, face capture, and mic latching', async ({ page }) => {
    page.on('console', (msg) => console.log(`[PAGE LOG] ${msg.type()}: ${msg.text()}`));
    page.on('pageerror', (err) => console.error(`[PAGE ERROR]: ${err.stack || err.message}`));

    // 1. Navigate to pre-interview setup with fake devices enabled
    await page.goto('/?setup=true');

    // 2. Verify Page Header & Initial Invariants
    await expect(page.locator('text=Adaptive Live Interview Setup')).toBeVisible({ timeout: 15000 });

    const startBtn = page.locator('button:has-text("Start 20-Min Interview")');
    await expect(startBtn).toBeVisible();
    await expect(startBtn).toBeDisabled();

    // Liveness is initially locked
    await expect(page.locator('text=Locked').first()).toBeVisible();

    // 3. Verify Video Stream & Enable Camera
    const video = page.locator('video');
    await expect(video).toBeAttached();

    const enableCameraBtn = page.locator('button:has-text("Enable Camera")');
    if (await enableCameraBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await enableCameraBtn.click();
    }

    // Wait for camera to finish requesting/streaming and reach ready_to_capture or capture controls
    const captureFaceBtn = page.locator('button:has-text("Capture Face"), button:has-text("Capturing in")');
    await expect(captureFaceBtn).toBeVisible({ timeout: 15000 });

    // Click capture button or wait for captured preview if auto-capture triggered
    const confirmFaceBtn = page.locator('button:has-text("Confirm Face")');
    const isAlreadyCaptured = await confirmFaceBtn.isVisible().catch(() => false);
    if (!isAlreadyCaptured) {
      await expect(captureFaceBtn).toBeEnabled({ timeout: 10000 });
      await captureFaceBtn.click();
    }

    // 4. Verify Captured Still Frame Preview & Confirmation Workflow (§S3)
    await expect(page.locator('text=Review captured frame')).toBeVisible({ timeout: 10000 });
    await expect(confirmFaceBtn).toBeVisible();
    await confirmFaceBtn.click({ force: true });

    // Camera is now verified and liveness is unlocked
    await expect(page.locator('text=Face verified and saved in memory')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=3 quick actions to prove human presence')).toBeVisible();

    // 5. Open & Verify Diagnostics Modal (§S6)
    const diagBtn = page.locator('button:has-text("Run Diagnostics")');
    await expect(diagBtn).toBeVisible();
    await diagBtn.click();

    await expect(page.locator('text=System & Hardware Diagnostics')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Stage Timings & Vision Delegate (§S6)')).toBeVisible();
    await expect(page.locator('text=Hardware Acquisition Counts (Single-Request Invariant)')).toBeVisible();
    await expect(page.locator('text=✓ Single-Request Invariant')).toBeVisible();
    await expect(page.locator('text=Real-Time Machine Proofs & Face Alignment')).toBeVisible();

    // Close Diagnostics Modal
    const closeDiagBtn = page.locator('button:has-text("Close")');
    await closeDiagBtn.click();
    await expect(page.locator('text=System & Hardware Diagnostics')).not.toBeVisible();

    // 6. Microphone Calibration & Latched Verification (§S4)
    const connectMicBtn = page.locator('button:has-text("Connect Mic")');
    await expect(connectMicBtn).toBeVisible();
    await connectMicBtn.click();

    // In fake-device mode, Chromium supplies audio input. Wait for mic to calibrate and verify speech.
    // In automated testing with Chromium fake device (continuous sine or silence), simulate cumulative speech if needed
    await page.evaluate(() => {
      // Simulate cumulative voiced audio accumulation directly to verify latched UI state transition
      const ev = new CustomEvent('__E2E_VOICED_SPEECH_ACCUMULATED__');
      window.dispatchEvent(ev);
    });

    // Verify Microphone shows verified
    // If waiting for fake audio stream to latch:
    const micVerifiedBadge = page.locator('text=Clear voice detected ✓');
    const isMicAlreadyVerified = await micVerifiedBadge.isVisible().catch(() => false);
    if (!isMicAlreadyVerified) {
      // Check for prompt sentence
      await expect(page.locator("text=Say: 'My name is ___ and I'm ready for the interview'").or(micVerifiedBadge)).toBeVisible();
    }

    // 7. Speaker Spoken Code Verification
    const playSpeakerBtn = page.locator('button:has-text("Play Test Code")');
    if (await playSpeakerBtn.isVisible()) {
      await playSpeakerBtn.click();
      // Code input field appears
      const codeInput = page.locator('input[placeholder="3-digit code"]');
      await expect(codeInput).toBeVisible({ timeout: 5000 });
      // Enter test code and confirm
      await expect(codeInput).toHaveAttribute('data-expected-code', /^[0-9]{3}$/, { timeout: 5000 });
      const expectedCode = await codeInput.getAttribute('data-expected-code');
      await codeInput.fill(expectedCode || '100');
      const confirmSpeakerBtn = page.locator('button:has-text("Confirm")');
      await confirmSpeakerBtn.click();
    }

    // 8. Liveness Step Completion
    const startLivenessBtn = page.locator('button:has-text("Start Check")');
    await expect(startLivenessBtn).toBeVisible({ timeout: 5000 });
    await startLivenessBtn.click();
    // Pass the 3 steps using gesture simulation in test mode
    for (let step = 0; step < 3; step++) {
      const simPassBtn = page.locator('button:has-text("Simulate Gesture Pass")');
      await expect(simPassBtn).toBeVisible({ timeout: 5000 });
      await simPassBtn.click();
      await page.waitForTimeout(400);
    }

    // 9. Verify Gating Check
    await expect(page.locator('text=3/3 Steps Passed')).toBeVisible({ timeout: 5000 });
    // Invariants check: all 4 cards verified -> start button enabled
    await expect(startBtn).toBeEnabled({ timeout: 5000 });
  });
});
