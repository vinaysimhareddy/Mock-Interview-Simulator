import { test, expect } from '@playwright/test';
import path from 'path';

const ARTIFACT_DIR = 'C:/Users/pvina/.gemini/antigravity/brain/ba572b47-fc46-4a67-bd82-24f6e40abbf3';

test.describe('U5: Having Trouble? Help Drawer & Dialogs', () => {
  test('Help Drawer at 1440px (Desktop): Guided checklist, actions & diagnostics', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?live=true');

    // Click "Having trouble?" button in bottom-right
    const helpBtn = page.locator('button:has-text("Having trouble?")');
    await expect(helpBtn).toBeVisible();
    await helpBtn.click();

    // Verify Drawer is visible
    const drawerTitle = page.locator('#help-drawer-title');
    await expect(drawerTitle).toBeVisible();
    await expect(drawerTitle).toHaveText('Having Trouble?');

    // Verify all 5 guided troubleshooting sections exist
    await expect(page.locator('text=Camera Not Working')).toBeVisible();
    await expect(page.locator('text=Microphone Not Working')).toBeVisible();
    await expect(page.locator('text=Can\'t Hear the Interviewer?')).toBeVisible();
    await expect(page.locator('text=Interviewer Frozen or Delayed')).toBeVisible();
    await expect(page.locator('text=Something Else?')).toBeVisible();

    // Verify fix actions exist
    await expect(page.locator('button:has-text("Retry camera")')).toBeVisible();
    await expect(page.locator('button:has-text("Retry microphone")')).toBeVisible();
    await expect(page.locator('button:has-text("Play test sound")')).toBeVisible();
    await expect(page.locator('button:has-text("Repeat question")')).toBeVisible();
    await expect(page.locator('button:has-text("Reconnect")')).toBeVisible();
    await expect(page.locator('button:has-text("Copy diagnostics report")')).toBeVisible();

    // Test Play test sound interaction
    const testSoundBtn = page.locator('button:has-text("Play test sound")');
    await testSoundBtn.click();

    // Test Copy diagnostics report interaction
    const copyBtn = page.locator('button:has-text("Copy diagnostics report")');
    await copyBtn.click();
    await expect(page.locator('text=Copied diagnostics to clipboard!')).toBeVisible();

    // Capture Desktop Screenshot of open Help Drawer
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'u5_help_drawer_1440.png'),
      fullPage: true,
    });

    // Test Resume button closes drawer
    const resumeBtn = page.locator('button:has-text("Resume Interview")');
    await resumeBtn.click();
    await expect(drawerTitle).not.toBeVisible();
  });

  test('Help Drawer at 390px (Mobile viewport): Responsive without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/?live=true');

    // Click "Having trouble?" button
    await page.locator('button:has-text("Having trouble?")').click();
    await expect(page.locator('#help-drawer-title')).toBeVisible();

    // Verify no horizontal overflow
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);

    // Capture Mobile Screenshot
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'u5_help_drawer_390.png'),
      fullPage: true,
    });
  });

  test('Face-Lost Warning Modal: Restyled to new design system at 1440px and 390px', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?face_lost=true');

    // Verify Modal elements
    await expect(page.locator('#face-lost-title')).toBeVisible();
    await expect(page.locator('#face-lost-title')).toHaveText('Please Return to Camera View');
    await expect(page.locator('text=Warning 1 of 2')).toBeVisible();
    await expect(page.locator('text=Auto-abort countdown')).toBeVisible();

    // Capture Desktop Face Lost Modal Screenshot
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'u5_face_lost_warning_1440.png'),
      fullPage: true,
    });

    // Mobile Viewport at 390px
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'u5_face_lost_warning_390.png'),
      fullPage: true,
    });
  });

  test('Camera-Lost Grace Period Modal: Restyled with countdown at 1440px', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?camera_lost=true');

    // Verify Modal elements
    await expect(page.locator('#camera-lost-title')).toBeVisible();
    await expect(page.locator('#camera-lost-title')).toHaveText('Please Restore Your Camera');
    await expect(page.locator('text=Recovery Grace Window')).toBeVisible();
    await expect(page.locator('button:has-text("Restore Camera Feed")')).toBeVisible();

    // Capture Desktop Camera Lost Modal Screenshot
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'u5_camera_lost_1440.png'),
      fullPage: true,
    });
  });
});

