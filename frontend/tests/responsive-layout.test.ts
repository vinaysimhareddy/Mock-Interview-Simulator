import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Responsive Layout & Error UX (F5)', () => {
  const preInterviewSetupPath = path.resolve(__dirname, '../src/components/interview/PreInterviewSetup.tsx');
  const setupContent = fs.readFileSync(preInterviewSetupPath, 'utf-8');

  it('camera container has responsive aspect-video and overflow-hidden styles', () => {
    expect(setupContent).toContain('aspect-video');
    expect(setupContent).toContain('overflow-hidden');
    expect(setupContent).toContain('rounded-xl');
  });

  it('camera placeholder text has break-words and center alignment to prevent clipping', () => {
    expect(setupContent).toContain('break-words');
    expect(setupContent).toContain('text-center');
    expect(setupContent).toContain('max-w-xs');
  });

  it('video element is styled with mirror transform and full coverage', () => {
    expect(setupContent).toContain('-scale-x-100');
    expect(setupContent).toContain('w-full');
    expect(setupContent).toContain('h-full');
    expect(setupContent).toContain('object-cover');
  });

  it('integrates PermissionHelpModal for blocked camera/mic permissions', () => {
    expect(setupContent).toContain('PermissionHelpModal');
    expect(setupContent).toContain('Permission Help');
  });
});
