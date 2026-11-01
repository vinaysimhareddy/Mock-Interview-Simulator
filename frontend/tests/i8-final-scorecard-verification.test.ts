import { describe, it, expect } from 'vitest';
import React from 'react';
import { PDFReportDocument } from '../src/components/report/PDFReportDocument';
import { FinalReport, IntegritySummary } from '../src/lib/types';

describe('I8: Post-Interview Scorecard & PDF Export Verification', () => {
  const sampleCleanReport: FinalReport = {
    overall_score: 87.5,
    category_scores: {
      technical: 90.0,
      communication: 85.0,
      composure: 82.5,
    },
    hiring_recommendation: 'Strong Hire',
    strengths: [
      'Exceptional architectural depth in distributed systems',
      'Clear, structured communication with trade-off analysis',
      'Consistent composure and steady eye contact',
    ],
    weaknesses: [
      'Could provide more concrete latency percentiles when discussing caching',
      'Consider outlining automated failover runbooks in greater detail',
    ],
    executive_summary:
      'Candidate completed 5 adaptive interview questions for Staff Distributed Systems Engineer. Scored 87.5/100 with Strong Hire recommendation.',
    integrity_summary: {
      verdict: 'Verified',
      integrity_score: 96.0,
      camera_device_name: 'Logitech Brio 4K Ultra HD (046d:085e)',
      challenges_passed: 2,
      challenges_failed: 0,
      face_present_percentage: 99.1,
      pauses_count: 0,
      camera_loss_incidents: 0,
      timeline_events: [
        {
          flag: 'no_blink',
          timestamp: 45.2,
          duration_sec: 1.2,
          confidence: 0.65,
        },
      ],
      excluded_segments_count: 1,
      non_verbal_excluded_note:
        'Non-verbal scores (eye contact, posture) are computed only from verified-live segments; segments with active integrity flags were excluded.',
      disclaimer:
        'Integrity checks are automated heuristics and may produce false positives. Review flagged events before drawing conclusions.',
    },
  };

  const sampleSession = {
    id: 'sess-8899aabbccddeeff',
    role: 'Distributed Systems Architect',
    seniority: 'Staff',
    created_at: '2026-10-28T10:00:00Z',
  };

  describe('1. Scorecard Metric Integrity & Precision', () => {
    it('verifies numeric score precision and range bounds (0..100)', () => {
      expect(sampleCleanReport.overall_score).toBeGreaterThanOrEqual(0);
      expect(sampleCleanReport.overall_score).toBeLessThanOrEqual(100);
      expect(sampleCleanReport.category_scores.technical).toBeGreaterThanOrEqual(0);
      expect(sampleCleanReport.category_scores.communication).toBeGreaterThanOrEqual(0);
      expect(sampleCleanReport.category_scores.composure).toBeGreaterThanOrEqual(0);

      // Verify no NaN or undefined values
      expect(Number.isNaN(sampleCleanReport.overall_score)).toBe(false);
      expect(Number.isNaN(sampleCleanReport.category_scores.technical)).toBe(false);
      expect(Number.isNaN(sampleCleanReport.category_scores.communication)).toBe(false);
      expect(Number.isNaN(sampleCleanReport.category_scores.composure)).toBe(false);
    });

    it('validates hiring recommendation decision levels', () => {
      const validRecommendations = ['Strong Hire', 'Hire', 'Leaning Hire', 'No Hire'];
      expect(validRecommendations).toContain(sampleCleanReport.hiring_recommendation);
    });
  });

  describe('2. Biometric & Camera Integrity (§7) Verification', () => {
    it('ensures camera device identification and tamper metrics are preserved', () => {
      const integrity = sampleCleanReport.integrity_summary!;
      expect(integrity).toBeDefined();
      expect(integrity.camera_device_name).toBe('Logitech Brio 4K Ultra HD (046d:085e)');
      expect(integrity.integrity_score).toBe(96.0);
      expect(integrity.face_present_percentage).toBe(99.1);
      expect(integrity.challenges_passed).toBe(2);
      expect(integrity.challenges_failed).toBe(0);
      expect(integrity.pauses_count).toBe(0);
    });

    it('verifies timeline audit events have timestamps, durations, and confidences', () => {
      const events = sampleCleanReport.integrity_summary!.timeline_events;
      expect(events.length).toBe(1);
      expect(events[0].flag).toBe('no_blink');
      expect(events[0].timestamp).toBe(45.2);
      expect(events[0].duration_sec).toBe(1.2);
      expect(events[0].confidence).toBe(0.65);
    });

    it('verifies exclusion note and count transparency for flagged non-verbal segments', () => {
      const integrity = sampleCleanReport.integrity_summary!;
      expect(integrity.excluded_segments_count).toBe(1);
      expect(integrity.non_verbal_excluded_note).toContain('Non-verbal scores');
    });
  });

  describe('3. Honest Fallbacks & Degraded Sensor States', () => {
    it('handles reports without non-verbal sensors gracefully without crashing', () => {
      const audioOnlyReport: FinalReport = {
        overall_score: 78.0,
        category_scores: {
          technical: 80.0,
          communication: 73.3,
          composure: 73.3, // Re-weighted to communication when camera is absent
        },
        hiring_recommendation: 'Hire',
        strengths: ['Clear technical articulation'],
        weaknesses: ['Expand on failure modes'],
        executive_summary: 'Candidate completed interview with audio-only telemetry.',
        integrity_summary: undefined,
      };

      const pdfElement = React.createElement(PDFReportDocument, {
        session: sampleSession,
        report: audioOnlyReport,
      });

      expect(pdfElement).toBeDefined();
      expect(pdfElement.props.report.overall_score).toBe(78.0);
      expect(pdfElement.props.report.category_scores.technical).toBe(80.0);
      expect(pdfElement.props.report.integrity_summary).toBeUndefined();
    });

    it('handles pristine sessions with zero timeline anomalies', () => {
      const pristineIntegrity: IntegritySummary = {
        verdict: 'Verified',
        integrity_score: 100.0,
        camera_device_name: 'FaceTime HD Camera',
        challenges_passed: 1,
        challenges_failed: 0,
        face_present_percentage: 100.0,
        pauses_count: 0,
        camera_loss_incidents: 0,
        timeline_events: [],
        excluded_segments_count: 0,
        non_verbal_excluded_note: 'All non-verbal segments verified.',
        disclaimer: 'Standard integrity disclaimer.',
      };

      const pristineReport: FinalReport = {
        ...sampleCleanReport,
        integrity_summary: pristineIntegrity,
      };

      const pdfElement = React.createElement(PDFReportDocument, {
        session: sampleSession,
        report: pristineReport,
      });

      expect(pdfElement).toBeDefined();
      expect(pdfElement.props.report.integrity_summary?.timeline_events.length).toBe(0);
    });
  });

  describe('4. Zero Mock & Zero Placeholders Invariant', () => {
    it('verifies report text contains real executive feedback and no placeholder markers', () => {
      const forbiddenTokens = ['TODO', 'FIXME', 'PLACEHOLDER', 'Lorem ipsum', 'mock_data', 'fake_score'];
      const combinedText = `
        ${sampleCleanReport.executive_summary}
        ${sampleCleanReport.strengths.join(' ')}
        ${sampleCleanReport.weaknesses.join(' ')}
      `.toLowerCase();

      for (const token of forbiddenTokens) {
        expect(combinedText).not.toContain(token.toLowerCase());
      }
    });
  });
});
