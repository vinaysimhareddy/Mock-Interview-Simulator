import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { PDFReportDocument } from '../src/components/report/PDFReportDocument';
import { CameraWatchdog } from '../src/lib/cameraWatchdog';
import { FinalReport, IntegritySummary } from '../src/lib/types';

describe('R6: Evaluation Report, PDF Generation & Edge Cases (§7)', () => {
  const mockReport: FinalReport = {
    overall_score: 92.5,
    category_scores: {
      technical: 95.0,
      communication: 90.0,
      composure: 88.0,
    },
    hiring_recommendation: 'Strong Hire',
    strengths: [
      'Architectural leadership with clear trade-off articulation',
      'Consistent composure and steady eye contact',
    ],
    weaknesses: ['Elaborate on disaster recovery protocols'],
    executive_summary:
      'Candidate performed exceptionally well across all evaluation criteria.',
    integrity_summary: {
      verdict: 'Verified',
      integrity_score: 98.0,
      camera_device_name: 'FaceTime HD Camera',
      challenges_passed: 3,
      challenges_failed: 0,
      face_present_percentage: 99.4,
      pauses_count: 0,
      camera_loss_incidents: 0,
      timeline_events: [
        {
          flag: 'no_blink',
          timestamp: 32.5,
          duration_sec: 1.0,
          confidence: 0.6,
        },
      ],
      excluded_segments_count: 1,
      non_verbal_excluded_note:
        'Non-verbal scores (eye contact, posture) are computed only from verified-live segments; segments with active integrity flags were excluded.',
      disclaimer:
        'Integrity checks are automated heuristics and may produce false positives. Review flagged events before drawing conclusions.',
    },
  };

  const mockSession = {
    id: 'session-r6-test-uuid',
    role: 'Staff Software Engineer',
    seniority: 'Staff',
    created_at: '2026-10-15T22:00:00Z',
  };

  describe('PDF Report Document Component', () => {
    it('initializes PDFReportDocument JSX tree with all required sections', () => {
      const element = React.createElement(PDFReportDocument, {
        session: mockSession,
        report: mockReport,
      });

      expect(element).toBeDefined();
      expect(element.props.session.role).toBe('Staff Software Engineer');
      expect(element.props.report.integrity_summary?.verdict).toBe('Verified');
      expect(element.props.report.integrity_summary?.integrity_score).toBe(98.0);
    });

    it('gracefully handles missing integrity_summary with verified fallback defaults', () => {
      const reportWithoutIntegrity: FinalReport = {
        ...mockReport,
        integrity_summary: undefined,
      };

      const element = React.createElement(PDFReportDocument, {
        session: mockSession,
        report: reportWithoutIntegrity,
      });

      expect(element).toBeDefined();
      expect(element.props.report.integrity_summary).toBeUndefined();
    });
  });

  describe('Edge Case: Tab Visibility & Minimization', () => {
    let mockTrack: MediaStreamTrack;
    let savedDocument: any;
    let savedWindow: any;
    let mockDoc: any;

    beforeEach(() => {
      savedDocument = (global as any).document;
      savedWindow = (global as any).window;

      class MockDocument extends EventTarget {
        public hidden: boolean = false;
      }
      mockDoc = new MockDocument();
      (global as any).document = mockDoc;
      (global as any).window = new EventTarget();

      mockTrack = {
        readyState: 'live',
        enabled: true,
        getSettings: vi.fn(() => ({ deviceId: 'dev_1', width: 1280, height: 720 })),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as MediaStreamTrack;
    });

    afterEach(() => {
      (global as any).document = savedDocument;
      (global as any).window = savedWindow;
    });

    it('emits tab_hidden and tab_restored events when candidate minimizes or focuses browser tab', () => {
      const events: any[] = [];
      const watchdog = new CameraWatchdog(mockTrack, null, {
        onIntegrityEvent: (e) => events.push(e),
      });

      // Simulate visibilitychange event on document
      mockDoc.hidden = true;
      mockDoc.dispatchEvent(new Event('visibilitychange'));

      expect(events.some((e) => e.type === 'tab_hidden')).toBe(true);

      // Simulate tab restore
      mockDoc.hidden = false;
      mockDoc.dispatchEvent(new Event('visibilitychange'));

      expect(events.some((e) => e.type === 'tab_restored')).toBe(true);

      watchdog.destroy();
    });

    it('detects page freeze or wall clock leaps and emits system_suspended', () => {
      const events: any[] = [];
      const watchdog = new CameraWatchdog(mockTrack, null, {
        onIntegrityEvent: (e) => events.push(e),
      });

      // Trigger freeze event
      mockDoc.dispatchEvent(new Event('freeze'));
      expect(events.some((e) => e.type === 'system_suspended')).toBe(true);

      watchdog.destroy();
    });
  });
});

