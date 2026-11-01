import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { ExecutiveScorecard } from '../src/components/interview/ExecutiveScorecard';
import { FinalReport } from '../src/lib/types';

describe('Q7: ExecutiveScorecard Question Coverage & Difficulty Progression UI', () => {
  const sampleReport: FinalReport = {
    overall_score: 84.5,
    category_scores: {
      technical: 86.0,
      communication: 82.0,
      composure: 85.0,
    },
    hiring_recommendation: 'Hire',
    strengths: ['Strong API design knowledge', 'Clear technical explanations'],
    weaknesses: ['Could discuss database deadlocks further'],
    executive_summary: 'Candidate demonstrated solid mid-level backend capabilities.',
    difficulty_progression: [
      {
        question_index: 1,
        difficulty_tier: 2.0,
        difficulty_label: 'Easy-Medium',
        score: 8.5,
        change: 'UPGRADE',
      },
      {
        question_index: 2,
        difficulty_tier: 2.5,
        difficulty_label: 'Medium',
        score: 8.0,
        change: 'UPGRADE',
      },
      {
        question_index: 3,
        difficulty_tier: 3.0,
        difficulty_label: 'Medium',
        score: 7.0,
        change: 'UNCHANGED',
      },
    ],
    question_coverage: [
      {
        question_index: 1,
        question: 'Looking at your background in FastAPI and PostgreSQL, how did you structure connection pooling?',
        candidate_answer: 'I used SQLAlchemy async engine with pool_size=20 and max_overflow=10.',
        planner_action: 'new_topic_from_resume',
        target_topic: 'FastAPI & PostgreSQL',
        source_description: 'Grounded in Resume: FastAPI & PostgreSQL',
        difficulty_tier: 2.0,
        difficulty_label: 'Easy-Medium',
        score: 8.5,
        feedback: 'Great understanding of connection pool configuration and resource limits.',
      },
      {
        question_index: 2,
        question: 'In your application you mentioned Redis caching. How do you handle cache invalidation on profile updates?',
        candidate_answer: 'We invalidate cache keys on write and set a 15-minute TTL.',
        planner_action: 'follow_up_probe',
        target_topic: 'Redis',
        source_description: 'Adaptive follow-up: Redis',
        difficulty_tier: 2.5,
        difficulty_label: 'Medium',
        score: 8.0,
        feedback: 'Solid cache invalidation strategy.',
      },
    ],
  };

  const sampleSession = {
    id: 'test-session-q7',
    role: 'Backend Engineer',
    seniority: 'Mid',
    created_at: new Date().toISOString(),
  };

  it('renders Adaptive Difficulty Progression timeline with tier badges and step changes', () => {
    const html = renderToString(
      <ExecutiveScorecard
        session={sampleSession}
        report={sampleReport}
        onDownloadPdf={() => {}}
        onReturnHome={() => {}}
      />
    );

    expect(html).toContain('Adaptive Difficulty Progression');
    expect(html).toContain('difficulty-progression-timeline');
    expect(html).toMatch(/Q(<!-- -->)?1/);
    expect(html).toContain('Easy-Medium');
    expect(html).toContain('2.0');
    expect(html).toMatch(/Q(<!-- -->)?2/);
    expect(html).toContain('Medium');
    expect(html).toContain('2.5');
    expect(html).toMatch(/Q(<!-- -->)?3/);
    expect(html).toContain('3.0');
  });

  it('renders Question Coverage & RAG Grounding section with source attributions and difficulty tiers', () => {
    const html = renderToString(
      <ExecutiveScorecard
        session={sampleSession}
        report={sampleReport}
        onDownloadPdf={() => {}}
        onReturnHome={() => {}}
      />
    );

    expect(html).toContain('Question Coverage &amp; Grounding Audit');
    expect(html).toContain('question-coverage-section');
    expect(html).toContain('Grounded in Resume: FastAPI &amp; PostgreSQL');
    expect(html).toContain('Adaptive follow-up: Redis');
    expect(html).toContain('I used SQLAlchemy async engine with pool_size=20');
    expect(html).toContain('Great understanding of connection pool configuration');
    expect(html).toContain('8.5');
    expect(html).toContain('8.0');
    expect(html).toContain('/10');
  });
});
