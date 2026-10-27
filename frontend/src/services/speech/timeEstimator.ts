/**
 * Time budget and question range estimation utilities.
 */

export interface QuestionEstimate {
  minQuestions: number;
  maxQuestions: number;
  avgTurnSecondsMin: number;
  avgTurnSecondsMax: number;
  displayString: string;
}

/**
 * Computes estimated question count based on interview duration in minutes.
 * Uses 75 to 120 seconds per turn (average question + speech answer + latency).
 * Also accounts for 45 seconds wrap-up reserve.
 */
export function estimateQuestionRange(durationMinutes: number, wrapUpReserveSec = 45): QuestionEstimate {
  const totalSeconds = Math.max(300, durationMinutes * 60);
  const activeSeconds = Math.max(120, totalSeconds - wrapUpReserveSec);

  // Faster pacing (~75s per question) yields max questions
  const maxQuestions = Math.max(3, Math.floor(activeSeconds / 75));
  // Deliberate pacing (~120s per question) yields min questions
  const minQuestions = Math.max(2, Math.floor(activeSeconds / 120));

  return {
    minQuestions,
    maxQuestions,
    avgTurnSecondsMin: 75,
    avgTurnSecondsMax: 120,
    displayString: `About ${minQuestions} to ${maxQuestions} questions`,
  };
}
