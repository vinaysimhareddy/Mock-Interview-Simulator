import { test, expect } from '@playwright/test';
import path from 'path';

const ARTIFACT_DIR = 'C:/Users/pvina/.gemini/antigravity/brain/ba572b47-fc46-4a67-bd82-24f6e40abbf3';

test.describe('U6: End Screens & Report Handoff (§3.7)', () => {
  test('Interview Complete Screen at 1440px (Desktop): Calm handoff, zero score leakage', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?complete=true');

    // Verify Title and friendly original copy
    const title = page.locator('h1:has-text("Interview Complete")');
    await expect(title).toBeVisible();
    await expect(page.locator('text=Thank you for taking the time to speak with our AI Interviewer today.')).toBeVisible();

    // Verify Target role pill
    await expect(page.locator('text=Senior Full Stack Engineer')).toBeVisible();

    // Verify Scorecard Ready status
    await expect(page.locator('text=Scorecard Ready')).toBeVisible();
    await expect(page.locator('text=Your performance scorecard and personalized feedback analysis are ready for review.')).toBeVisible();

    // Verify action CTAs
    const viewReportBtn = page.locator('button:has-text("View Executive Report")');
    await expect(viewReportBtn).toBeVisible();
    await expect(page.locator('button:has-text("Download PDF Report")')).toBeVisible();
    await expect(page.locator('button:has-text("Return to Dashboard")')).toBeVisible();

    // Verify privacy termination guarantee
    await expect(page.locator('text=Hardware camera & microphone tracks have been terminated.')).toBeVisible();

    // CRITICAL: Verify NO scores, numerical percentages, or critiques are leaked on this preliminary completion screen!
    await expect(page.locator('text=/100')).not.toBeVisible();
    await expect(page.locator('text=Technical Depth')).not.toBeVisible();
    await expect(page.locator('text=Recommendation')).not.toBeVisible();

    // Capture Desktop Screenshot
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'u6_interview_complete_1440.png'),
      fullPage: true,
    });
  });

  test('Interview Complete Screen at 390px (Mobile viewport): Responsive without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/?complete=true');

    await expect(page.locator('h1:has-text("Interview Complete")')).toBeVisible();
    await expect(page.locator('button:has-text("View Executive Report")')).toBeVisible();

    // Verify no horizontal scrolling on mobile
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);

    // Capture Mobile Screenshot
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'u6_interview_complete_390.png'),
      fullPage: true,
    });
  });

  test('Interview Aborted Screen at 1440px and 390px: Friendly explanation and what was saved', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?aborted=true');

    // Verify Aborted Heading and clear reason
    await expect(page.locator('h1:has-text("Interview Ended")')).toBeVisible();
    await expect(page.locator('text=Face Absence Policy Triggered')).toBeVisible();
    await expect(page.locator('text=Your face was not detected in the camera frame for 30 consecutive seconds after two automated warnings.')).toBeVisible();

    // Verify "What was saved" guarantee (§3.7)
    await expect(page.locator('text=What was saved')).toBeVisible();
    await expect(page.locator('text=All responses, answer transcripts, and biometric telemetry signals recorded prior to this point have been safely stored with your candidate record.')).toBeVisible();

    // Verify CTAs
    await expect(page.locator('button:has-text("Back to Dashboard")')).toBeVisible();
    await expect(page.locator('button:has-text("Start New Interview Session")')).toBeVisible();

    // Capture Desktop Screenshot
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'u6_interview_aborted_1440.png'),
      fullPage: true,
    });

    // Mobile Viewport at 390px
    await page.setViewportSize({ width: 390, height: 844 });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);

    // Capture Mobile Screenshot
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'u6_interview_aborted_390.png'),
      fullPage: true,
    });
  });

  test('Executive Scorecard Screen at 1440px: Complete metrics, rubric weights & integrity summary', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?scorecard=true');

    // Verify Title
    await expect(page.locator('text=Interview Completed: Executive Scorecard')).toBeVisible();

    // Verify Overall Score & Recommendation
    await expect(page.locator('text=Overall Score')).toBeVisible();
    await expect(page.locator('text=86')).toBeVisible();
    await expect(page.locator('text=Recommendation')).toBeVisible();
    await expect(page.locator('text=Strong Hire')).toBeVisible();

    // Verify Category Breakdown (60% / 25% / 15%)
    await expect(page.locator('text=Technical Depth (60%)')).toBeVisible();
    await expect(page.locator('text=88%')).toBeVisible();
    await expect(page.locator('text=Communication (25%)')).toBeVisible();
    await expect(page.locator('text=85%')).toBeVisible();
    await expect(page.locator('text=Biometric Composure (15%)')).toBeVisible();
    await expect(page.locator('text=82%')).toBeVisible();

    // Verify Key Strengths & Growth Opportunities
    await expect(page.locator('text=Key Strengths')).toBeVisible();
    await expect(page.locator('text=Growth Opportunities')).toBeVisible();
    await expect(page.locator('text=Executive Summary:')).toBeVisible();

    // Verify Physical Camera Integrity & Biometric Verification (§7)
    await expect(page.locator('text=Physical Camera Integrity & Biometric Verification (§7)')).toBeVisible();
    await expect(page.locator('text=Verdict: Verified')).toBeVisible();
    await expect(page.locator('text=Integrity Score')).toBeVisible();
    await expect(page.locator('text=98/100')).toBeVisible();
    await expect(page.locator('text=Face Present Rate')).toBeVisible();
    await expect(page.locator('text=99.4%')).toBeVisible();
    await expect(page.locator('text=Physical Hardware Webcam Verified (Integrated Camera)')).toBeVisible();

    // Verify Download & Dashboard Buttons
    await expect(page.locator('button:has-text("Download PDF Report")').first()).toBeVisible();
    await expect(page.locator('button:has-text("Return to Dashboard")')).toBeVisible();

    // Capture Desktop Screenshot
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'u6_executive_scorecard_1440.png'),
      fullPage: true,
    });
  });
});

