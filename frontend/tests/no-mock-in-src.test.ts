import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * CI / Verification check to guarantee no dummy, mock, simulated, or hardcoded
 * vision or telemetry behavior exists in frontend/src production code.
 */

const BANNED_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /Math\.random\s*\(/, description: 'Math.random() is forbidden in production source code' },
  { pattern: /generateSimulatedSample/, description: 'Simulated sample generators are forbidden' },
  { pattern: /startSimulation/, description: 'Simulation mode starters are forbidden' },
  { pattern: /handleSimulateStrongAnswer/, description: 'Simulate Answer handlers are forbidden' },
  { pattern: /Simulate Answer/i, description: '"Simulate Answer" UI buttons are forbidden' },
  { pattern: /Simulator Mode/i, description: '"Simulator Mode" toggles are forbidden' },
  { pattern: /77%\s*eye/i, description: 'Hardcoded 77% eye alignment metric is forbidden' },
  { pattern: /17\.3\s*BPM/i, description: 'Hardcoded 17.3 BPM blink rate metric is forbidden' },
  { pattern: /27%\s*tension/i, description: 'Hardcoded 27% tension metric is forbidden' },
  { pattern: /fakeCamera/i, description: 'Fake camera generators are forbidden' },
  { pattern: /dummyMetrics/i, description: 'Dummy metrics are forbidden' },
];

function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
    } else {
      // Exclude test files, storybook, or type declaration files
      if (!file.includes('.test.') && !file.includes('.spec.') && !file.endsWith('.d.ts')) {
        arrayOfFiles.push(fullPath);
      }
    }
  });

  return arrayOfFiles;
}

describe('R1 Security Verification: Zero Banned Dummy/Mock Vision Patterns in src/', () => {
  const srcDir = path.resolve(__dirname, '../src');
  const srcFiles = getAllFiles(srcDir);

  it('scans all src files and verifies zero banned patterns exist', () => {
    const violations: Array<{ file: string; line: number; rule: string; snippet: string }> = [];

    srcFiles.forEach((filePath) => {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        BANNED_PATTERNS.forEach(({ pattern, description }) => {
          if (pattern.test(line)) {
            violations.push({
              file: path.relative(srcDir, filePath),
              line: index + 1,
              rule: description,
              snippet: line.trim(),
            });
          }
        });
      });
    });

    if (violations.length > 0) {
      console.error('BANNED PATTERNS FOUND IN PRODUCTION CODE:\n', violations);
    }

    expect(violations).toHaveLength(0);
  });
});
