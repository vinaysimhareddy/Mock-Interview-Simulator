import { test, expect } from '@playwright/test';
import path from 'path';

const ARTIFACT_DIR = 'C:/Users/pvina/.gemini/antigravity/brain/ba572b47-fc46-4a67-bd82-24f6e40abbf3';

test.describe('U3: Design System, Tokens, Welcome & Ready Screens', () => {
  test('Welcome screen at 1440px (desktop, dark theme) with consent gating', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?welcome=true');

    // Verify Welcome hero & elements
    await expect(page.locator('text=Welcome to Your Technical Interview')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=What to Expect')).toBeVisible();
    await expect(page.locator('text=Preparation Checklist')).toBeVisible();
    await expect(page.locator('text=Privacy & On-Device Processing')).toBeVisible();

    // Verify continue button is initially disabled without consent
    const continueBtn = page.locator('button:has-text("Continue to Device Check")');
    await expect(continueBtn).toBeDisabled();

    // Take screenshot of Welcome screen at 1440px (dark theme)
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'u3_welcome_1440_dark.png'),
      fullPage: true,
    });

    // Check consent checkbox
    const consentCheckbox = page.locator('#interview-consent');
    await consentCheckbox.check({ force: true });
    await expect(continueBtn).toBeEnabled();
  });

  test('Welcome screen at 390px (mobile viewport)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/?welcome=true');

    await expect(page.locator('text=Welcome to Your Technical Interview')).toBeVisible({ timeout: 10000 });

    // Verify mobile layout without horizontal overflow
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);

    // Take screenshot of Welcome screen at 390px
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'u3_welcome_390.png'),
      fullPage: true,
    });
  });

  test('Welcome screen in Light Theme & Theme Toggle verification', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?welcome=true');

    await expect(page.locator('text=Welcome to Your Technical Interview')).toBeVisible({ timeout: 10000 });

    // Click theme toggle button
    const themeBtn = page.locator('button[title="Toggle Theme"]');
    await themeBtn.click();

    // Verify html class changed to light
    const isLight = await page.evaluate(() => document.documentElement.classList.contains('light'));
    expect(isLight).toBe(true);

    // Take screenshot of Welcome screen in light mode
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'u3_welcome_1440_light.png'),
      fullPage: true,
    });
  });

  test('Pre-start Ready screen at 1440px and 390px', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?ready=true');

    await expect(page.locator('text=Ready to Begin')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Start Interview')).toBeVisible();
    await expect(page.locator('text=15 minutes')).toBeVisible();

    // Take screenshot of Ready screen at 1440px
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'u3_ready_1440.png'),
      fullPage: true,
    });

    // Mobile Ready screen at 390px
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'u3_ready_390.png'),
      fullPage: true,
    });
  });
});

