# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: frontend\e2e\u3-design-system.spec.ts >> U3: Design System, Tokens, Welcome & Ready Screens >> Welcome screen at 390px (mobile viewport)
- Location: frontend\e2e\u3-design-system.spec.ts:33:3

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/?welcome=true", waiting until "load"

```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | import path from 'path';
  3  | 
  4  | const ARTIFACT_DIR = 'C:/Users/pvina/.gemini/antigravity/brain/ba572b47-fc46-4a67-bd82-24f6e40abbf3';
  5  | 
  6  | test.describe('U3: Design System, Tokens, Welcome & Ready Screens', () => {
  7  |   test('Welcome screen at 1440px (desktop, dark theme) with consent gating', async ({ page }) => {
  8  |     await page.setViewportSize({ width: 1440, height: 900 });
  9  |     await page.goto('/?welcome=true');
  10 | 
  11 |     // Verify Welcome hero & elements
  12 |     await expect(page.locator('text=Welcome to Your Technical Interview')).toBeVisible({ timeout: 10000 });
  13 |     await expect(page.locator('text=What to Expect')).toBeVisible();
  14 |     await expect(page.locator('text=Preparation Checklist')).toBeVisible();
  15 |     await expect(page.locator('text=Privacy & On-Device Processing')).toBeVisible();
  16 | 
  17 |     // Verify continue button is initially disabled without consent
  18 |     const continueBtn = page.locator('button:has-text("Continue to Device Check")');
  19 |     await expect(continueBtn).toBeDisabled();
  20 | 
  21 |     // Take screenshot of Welcome screen at 1440px (dark theme)
  22 |     await page.screenshot({
  23 |       path: path.join(ARTIFACT_DIR, 'u3_welcome_1440_dark.png'),
  24 |       fullPage: true,
  25 |     });
  26 | 
  27 |     // Check consent checkbox
  28 |     const consentCheckbox = page.locator('#interview-consent');
  29 |     await consentCheckbox.check({ force: true });
  30 |     await expect(continueBtn).toBeEnabled();
  31 |   });
  32 | 
  33 |   test('Welcome screen at 390px (mobile viewport)', async ({ page }) => {
  34 |     await page.setViewportSize({ width: 390, height: 844 });
> 35 |     await page.goto('/?welcome=true');
     |                ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  36 | 
  37 |     await expect(page.locator('text=Welcome to Your Technical Interview')).toBeVisible({ timeout: 10000 });
  38 | 
  39 |     // Verify mobile layout without horizontal overflow
  40 |     const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  41 |     const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  42 |     expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
  43 | 
  44 |     // Take screenshot of Welcome screen at 390px
  45 |     await page.screenshot({
  46 |       path: path.join(ARTIFACT_DIR, 'u3_welcome_390.png'),
  47 |       fullPage: true,
  48 |     });
  49 |   });
  50 | 
  51 |   test('Welcome screen in Light Theme & Theme Toggle verification', async ({ page }) => {
  52 |     await page.setViewportSize({ width: 1440, height: 900 });
  53 |     await page.goto('/?welcome=true');
  54 | 
  55 |     await expect(page.locator('text=Welcome to Your Technical Interview')).toBeVisible({ timeout: 10000 });
  56 | 
  57 |     // Click theme toggle button
  58 |     const themeBtn = page.locator('button[title="Toggle Theme"]');
  59 |     await themeBtn.click();
  60 | 
  61 |     // Verify html class changed to light
  62 |     const isLight = await page.evaluate(() => document.documentElement.classList.contains('light'));
  63 |     expect(isLight).toBe(true);
  64 | 
  65 |     // Take screenshot of Welcome screen in light mode
  66 |     await page.screenshot({
  67 |       path: path.join(ARTIFACT_DIR, 'u3_welcome_1440_light.png'),
  68 |       fullPage: true,
  69 |     });
  70 |   });
  71 | 
  72 |   test('Pre-start Ready screen at 1440px and 390px', async ({ page }) => {
  73 |     await page.setViewportSize({ width: 1440, height: 900 });
  74 |     await page.goto('/?ready=true');
  75 | 
  76 |     await expect(page.locator('text=Ready to Begin')).toBeVisible({ timeout: 10000 });
  77 |     await expect(page.locator('text=Start Interview')).toBeVisible();
  78 |     await expect(page.locator('text=15 minutes')).toBeVisible();
  79 | 
  80 |     // Take screenshot of Ready screen at 1440px
  81 |     await page.screenshot({
  82 |       path: path.join(ARTIFACT_DIR, 'u3_ready_1440.png'),
  83 |       fullPage: true,
  84 |     });
  85 | 
  86 |     // Mobile Ready screen at 390px
  87 |     await page.setViewportSize({ width: 390, height: 844 });
  88 |     await page.screenshot({
  89 |       path: path.join(ARTIFACT_DIR, 'u3_ready_390.png'),
  90 |       fullPage: true,
  91 |     });
  92 |   });
  93 | });
  94 | 
```