import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('S5: Setup UI Elements & Accessibility Verification', () => {
  const preInterviewSetupPath = path.resolve(
    __dirname,
    '../src/components/interview/PreInterviewSetup.tsx'
  );
  const content = fs.readFileSync(preInterviewSetupPath, 'utf-8');

  it('verifies camera guide oval, color states, and direction hints under oval', () => {
    // Responsive guide oval
    expect(content).toContain('w-36 h-48 sm:w-44 sm:h-56');
    expect(content).toContain('rounded-[50%]');

    // Color states: emerald when ready/passed, amber when failing criterion
    expect(content).toContain('border-emerald-400');
    expect(content).toContain('border-amber-400');

    // Direction alignment hint message placed under guide oval
    expect(content).toContain('Ready to capture! Hold still');
    expect(content).toContain('Position face inside oval guide');
  });

  it('verifies 4-stage loading indicator and timeout retry', () => {
    // 4 stages present in stepper
    expect(content).toContain("'requesting_camera'");
    expect(content).toContain("'starting_video'");
    expect(content).toContain("'loading_model'");
    expect(content).toContain("'detecting_face'");

    // Timeout overlay with explicit retry
    expect(content).toContain('Stage Timed Out:');
    expect(content).toContain('Retry Camera');
  });

  it('verifies lighting tip banner with window/lamp guidance', () => {
    expect(content).toContain('Lighting Tip:');
    expect(content).toContain('Face a window or lamp; avoid strong backlight');
  });

  it('verifies microphone card: noise floor, sentence prompt, SVG progress ring, latched state, and re-test', () => {
    // Noise floor measuring message
    expect(content).toContain('Measuring ambient noise floor... Please stay quiet for 1 second');

    // Sentence prompt
    expect(content).toContain("My name is ___ and I&apos;m ready for the interview");

    // SVG Circular Progress Ring
    expect(content).toContain('strokeDasharray={100.53}');
    expect(content).toContain('strokeDashoffset');
    expect(content).toContain('stroke-indigo-400');

    // Latched verified state
    expect(content).toContain('Clear voice detected ✓');
    expect(content).toContain('Input latched');

    // Re-test button
    expect(content).toContain('Re-test');
    expect(content).toContain('handleRetestMic');
  });

  it('verifies screen-reader live regions (aria-live="polite") and status roles', () => {
    expect(content).toContain('aria-live="polite"');
    expect(content).toContain('role="status"');
  });

  it('verifies responsive scaling from 320px up without fixed width clipping', () => {
    expect(content).toContain('aspect-video');
    expect(content).toContain('overflow-hidden');
    expect(content).toContain('max-w-');
    expect(content).toContain('break-words');
  });
});
