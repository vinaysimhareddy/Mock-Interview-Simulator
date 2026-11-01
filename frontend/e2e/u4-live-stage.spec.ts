import { test, expect } from '@playwright/test';
import path from 'path';

const ARTIFACT_DIR = 'C:/Users/pvina/.gemini/antigravity/brain/ba572b47-fc46-4a67-bd82-24f6e40abbf3';

test.describe('U4: Live Interview Stage (Core Immersive Screen)', () => {
  test('Live stage at 1440px (Desktop): Calm layout and complete absence of forbidden developer HUD/metrics', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?live=true');

    // 1. Verify Top Bar elements
    await expect(page.locator('header')).toBeVisible();
    await expect(page.getByText('AI Interviewer', { exact: true })).toBeVisible();
    await expect(page.locator('text=Full Stack Engineer')).toBeVisible();
    await expect(page.locator('text=Camera & mic active: monitoring posture & eye contact')).toBeVisible();
    await expect(page.locator('button:has-text("End interview")')).toBeVisible();

    // 2. Verify Center Stage: Animated AI Interviewer Orb & Question Caption
    const orb = page.locator('[aria-label^="AI Interviewer"]');
    await expect(orb).toBeVisible();

    const questionRegion = page.locator('[role="region"][aria-label="Interview Question"]');
    await expect(questionRegion).toBeVisible();

    // 3. Verify Bottom Controls
    await expect(page.locator('button:has-text("Show Self-View")')).toBeVisible();
    await expect(page.locator('button:has-text("Having trouble?")')).toBeVisible();
    await expect(page.locator('button:has-text("Pause")')).toBeVisible();

    // 4. CRITICAL INVARIANT: Verify ZERO forbidden metrics/HUD elements are in normal candidate view
    await expect(page.locator('text=Live Behavior Telemetry')).not.toBeVisible();
    await expect(page.locator('text=acked')).not.toBeVisible();
    await expect(page.getByText('Eye Contact', { exact: true })).not.toBeVisible();
    await expect(page.getByText('Posture Score', { exact: true })).not.toBeVisible();
    await expect(page.locator('text=Face Presence')).not.toBeVisible();
    await expect(page.locator('text=Head Pose')).not.toBeVisible();
    await expect(page.locator('text=Answer Score')).not.toBeVisible();
    await expect(page.locator('text=Stop Dictation')).not.toBeVisible();
    await expect(page.locator('text=Play Audio (TTS)')).not.toBeVisible();
    await expect(page.locator('text=Submit Answer & Proceed')).not.toBeVisible();
    await expect(page.locator('textarea')).not.toBeVisible();

    // 5. Capture Desktop Screenshot
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'u4_live_stage_1440.png'),
      fullPage: true,
    });
  });

  test('Live stage at 390px (Mobile viewport): Responsive without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/?live=true');

    // Verify elements are visible
    await expect(page.locator('[aria-label^="AI Interviewer"]')).toBeVisible();
    await expect(page.locator('[role="region"][aria-label="Interview Question"]')).toBeVisible();
    await expect(page.locator('button:has-text("Pause")')).toBeVisible();

    // Verify no horizontal overflow
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);

    // Capture Mobile Screenshot
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'u4_live_stage_390.png'),
      fullPage: true,
    });
  });

  test('Self-View PiP toggle behavior', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?live=true');

    const toggleBtn = page.locator('button:has-text("Show Self-View")');
    await expect(toggleBtn).toBeVisible();

    // Initially PiP is hidden
    await expect(page.locator('text=On-device local processing • Not recorded')).not.toBeVisible();

    // Click toggle to open PiP
    await toggleBtn.click();
    await expect(page.locator('button:has-text("Hide Self-View")')).toBeVisible();
    await expect(page.locator('text=On-device local processing • Not recorded')).toBeVisible();

    // Click again to close PiP
    await page.locator('button:has-text("Hide Self-View")').click();
    await expect(page.locator('button:has-text("Show Self-View")')).toBeVisible();
  });

  test('Developer HUD (?debug=1): Only rendered when debug flag is provided', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?live=true&debug=1');

    // Debug HUD must now be present
    await expect(page.locator('text=DEBUG TELEMETRY HUD')).toBeVisible();
    await expect(page.getByText('FPS', { exact: true })).toBeVisible();

    // Capture Debug HUD Screenshot
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'u4_live_stage_debug_1440.png'),
      fullPage: true,
    });
  });
});
