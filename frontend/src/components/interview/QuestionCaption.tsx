import React, { useEffect, useState } from 'react';

interface QuestionCaptionProps {
  questionText: string;
  isAiSpeaking: boolean;
  className?: string;
}

export function QuestionCaption({
  questionText,
  isAiSpeaking,
  className = '',
}: QuestionCaptionProps): React.ReactElement {
  const [displayedWordsCount, setDisplayedWordsCount] = useState<number>(0);
  const words = React.useMemo(() => {
    return questionText ? questionText.trim().split(/\s+/) : [];
  }, [questionText]);

  // Progressive reveal while AI is speaking
  useEffect(() => {
    if (!words.length) {
      setDisplayedWordsCount(0);
      return;
    }

    if (!isAiSpeaking) {
      // If AI finished or audio not active, show the entire question
      setDisplayedWordsCount(words.length);
      return;
    }

    // When new question arrives and AI begins speaking, progressively reveal words
    setDisplayedWordsCount(1);
    // Typical reading/speaking pace ~ 3.5 words per second -> ~280ms per word
    const interval = setInterval(() => {
      setDisplayedWordsCount((prev) => {
        if (prev >= words.length) {
          clearInterval(interval);
          return prev;
        }
        return prev + 1;
      });
    }, 240);

    return () => clearInterval(interval);
  }, [words, isAiSpeaking]);

  if (!questionText) {
    return (
      <div
        className={`w-full max-w-3xl mx-auto text-center px-4 sm:px-6 py-6 select-text transition-all duration-300 ${className}`}
        aria-live="polite"
        role="region"
        aria-label="Interview Question"
      >
        <p className="text-xl sm:text-2xl text-slate-500 font-medium italic animate-pulse">
          Synthesizing tailored question...
        </p>
      </div>
    );
  }

  return (
    <div
      className={`w-full max-w-3xl mx-auto text-center px-4 sm:px-6 select-text transition-all duration-300 ${className}`}
      aria-live="polite"
      role="region"
      aria-label="Interview Question"
    >
      <h2 className="text-2xl sm:text-3xl lg:text-[32px] font-semibold text-slate-100 dark:text-slate-100 light:text-slate-900 leading-[1.4] tracking-normal transition-colors duration-200">
        {words.map((word, idx) => {
          const isRevealed = idx < displayedWordsCount;
          return (
            <span
              key={`${idx}-${word}`}
              className={`inline-block mr-1.5 transition-all duration-200 ${
                isRevealed
                  ? 'opacity-100 translate-y-0 text-slate-100 dark:text-slate-100 light:text-slate-900'
                  : 'opacity-0 translate-y-1 text-slate-600 dark:text-slate-600'
              }`}
            >
              {word}
            </span>
          );
        })}
      </h2>
    </div>
  );
}
