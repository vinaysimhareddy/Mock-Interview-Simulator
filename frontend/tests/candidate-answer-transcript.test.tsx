import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import fs from 'fs';
import path from 'path';
import { CandidateAnswerTranscript } from '../src/components/interview/CandidateAnswerTranscript';
import { SpeechErrorInfo } from '../src/services/speech/speechErrors';

describe('Q6: CandidateAnswerTranscript Live Answer UI', () => {
  const componentPath = path.resolve(
    __dirname,
    '../src/components/interview/CandidateAnswerTranscript.tsx'
  );
  const interviewRoomPath = path.resolve(
    __dirname,
    '../src/components/interview/InterviewRoom.tsx'
  );

  const fileContent = fs.readFileSync(componentPath, 'utf-8');
  const roomContent = fs.readFileSync(interviewRoomPath, 'utf-8');

  it('verifies CandidateAnswerTranscript is integrated into InterviewRoom below stage', () => {
    expect(roomContent).toContain('CandidateAnswerTranscript');
    expect(roomContent).toContain('transcript={transcript}');
    expect(roomContent).toContain('interimTranscript={interimTranscript}');
    expect(roomContent).toContain('onSubmit={executeAnswerSubmission}');
    expect(roomContent).toContain('onClearAndRetry={clearTranscript}');
  });

  it('verifies Candidate Captions / Transcript defaults to ON in InterviewRoom', () => {
    // Verified default state is true (not requiring users to discover toggle)
    expect(roomContent).toContain("localStorage.getItem('SHOW_CANDIDATE_CAPTIONS')");
    expect(roomContent).toContain('return true; // Default to ON');
  });

  it('renders listening state with active listening badge and waveform equalizer', () => {
    const html = renderToString(
      <CandidateAnswerTranscript
        transcript=""
        interimTranscript=""
        isListening={true}
        isCandidateSpeaking={false}
        isAiSpeaking={false}
        isSubmitting={false}
        audioLevel={0.35}
        silenceProgress={0}
        isSpeechSupported={true}
        onSubmit={() => {}}
        onClearAndRetry={() => {}}
      />
    );

    expect(html).toContain('Listening for answer...');
    expect(html).toContain('candidate-live-transcript');
    expect(html).toContain('Speak clearly into your microphone');
  });

  it('renders finalized transcript and interim speech distinctly', () => {
    const html = renderToString(
      <CandidateAnswerTranscript
        transcript="I deployed FastAPI microservices with Redis caching"
        interimTranscript="and PostgreSQL database clustering"
        isListening={true}
        isCandidateSpeaking={true}
        isAiSpeaking={false}
        isSubmitting={false}
        audioLevel={0.65}
        silenceProgress={0}
        isSpeechSupported={true}
        onSubmit={() => {}}
        onClearAndRetry={() => {}}
      />
    );

    // Finalized text in solid foreground
    expect(html).toContain('I deployed FastAPI microservices with Redis caching');
    // Interim streaming speech in italic
    expect(html).toContain('and PostgreSQL database clustering');
    // Speaking state indicator
    expect(html).toContain('Speaking');
    // Word counter badge
    expect(html).toContain('words');
    expect(html).toContain('11');
    // Submit answer button is enabled
    expect(html).toContain('Submit Answer');
  });

  it('renders silence countdown progress bar when silence is detected post-speech', () => {
    const html = renderToString(
      <CandidateAnswerTranscript
        transcript="We implemented connection pooling with max overflow 10."
        interimTranscript=""
        isListening={true}
        isCandidateSpeaking={false}
        isAiSpeaking={false}
        isSubmitting={false}
        audioLevel={0.05}
        silenceProgress={0.65} // 65% progress toward auto-submit
        isSpeechSupported={true}
        onSubmit={() => {}}
        onClearAndRetry={() => {}}
      />
    );

    expect(html).toContain('Pause detected');
    expect(html).toContain('Auto-submitting in');
    expect(html).toContain('style="width:65%"');
  });

  it('renders actionable error guidance and manual input fallback when speech recognition fails', () => {
    const mockError: SpeechErrorInfo = {
      title: 'Speech Recognition Network Error',
      explanation: 'Browser speech recognition requires an active internet connection to reach Google speech servers.',
      recoveryStep: 'Check your internet connection or type your answer below.',
    };

    const html = renderToString(
      <CandidateAnswerTranscript
        transcript=""
        interimTranscript=""
        isListening={false}
        isCandidateSpeaking={false}
        isAiSpeaking={false}
        isSubmitting={false}
        audioLevel={0}
        silenceProgress={0}
        isSpeechSupported={true}
        sttError={mockError}
        onSubmit={() => {}}
        onClearAndRetry={() => {}}
      />
    );

    expect(html).toContain('Speech Recognition Network Error');
    expect(html).toContain('Browser speech recognition requires an active internet connection');
    expect(html).toContain('Recovery:');
    expect(html).toContain('Check your internet connection or type your answer below.');
    // Manual textarea fallback is rendered
    expect(html).toContain('manual-answer-input');
    expect(html).toContain('Type your response here if microphone recognition is unavailable');
  });

  it('verifies control elements: Clear & Retry and Submit Answer buttons in source contract', () => {
    expect(fileContent).toContain('Clear & Retry');
    expect(fileContent).toContain('data-testid="submit-answer-button"');
    expect(fileContent).toContain('data-testid="live-transcript-container"');
    expect(fileContent).toContain('data-testid="manual-answer-input"');
    expect(fileContent).toContain('scrollRef.current.scrollTop = scrollRef.current.scrollHeight');
  });
});
