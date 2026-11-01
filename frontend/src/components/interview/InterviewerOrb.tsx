import React, { useMemo } from 'react';

export type OrbState = 'idle' | 'speaking' | 'listening' | 'thinking';

interface InterviewerOrbProps {
  state: OrbState;
  audioLevel?: number; // 0..1 candidate or AI audio intensity
  isCandidateSpeaking?: boolean;
  className?: string;
}

export function InterviewerOrb({
  state,
  audioLevel = 0,
  isCandidateSpeaking = false,
  className = '',
}: InterviewerOrbProps): React.ReactElement {
  // Check for reduced motion preference
  const prefersReducedMotion = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  // Compute dynamic scale and glow based on state and audio level
  const audioScale = Math.min(1.3, 1 + audioLevel * 0.4);
  const audioGlow = Math.min(40, 15 + audioLevel * 35);

  return (
    <div
      className={`relative flex items-center justify-center select-none ${className}`}
      aria-label={`AI Interviewer (${state})`}
      role="img"
    >
      {/* Outer ambient glow field */}
      <div
        className="absolute rounded-full transition-all duration-300 blur-3xl pointer-events-none"
        style={{
          width: '260px',
          height: '260px',
          background:
            state === 'speaking'
              ? 'radial-gradient(circle, rgba(99, 102, 241, 0.45) 0%, rgba(139, 92, 246, 0.25) 50%, transparent 70%)'
              : state === 'listening'
              ? isCandidateSpeaking
                ? 'radial-gradient(circle, rgba(16, 185, 129, 0.4) 0%, rgba(59, 130, 246, 0.2) 50%, transparent 70%)'
                : 'radial-gradient(circle, rgba(99, 102, 241, 0.25) 0%, rgba(59, 130, 246, 0.15) 50%, transparent 70%)'
              : state === 'thinking'
              ? 'radial-gradient(circle, rgba(168, 85, 247, 0.35) 0%, rgba(99, 102, 241, 0.2) 50%, transparent 70%)'
              : 'radial-gradient(circle, rgba(99, 102, 241, 0.2) 0%, transparent 70%)',
          transform: !prefersReducedMotion && (state === 'speaking' || isCandidateSpeaking)
            ? `scale(${audioScale})`
            : 'scale(1)',
        }}
      />

      {/* Orbiting particles for 'thinking' state */}
      {state === 'thinking' && !prefersReducedMotion && (
        <div className="absolute w-44 h-44 rounded-full border border-indigo-400/20 animate-spin" style={{ animationDuration: '6s' }}>
          <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-indigo-400 shadow-[0_0_12px_rgba(129,140,248,0.9)]" />
          <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-purple-400 shadow-[0_0_8px_rgba(192,132,252,0.8)]" />
        </div>
      )}

      {/* Pulsing ring for 'speaking' or 'listening' */}
      {!prefersReducedMotion && (
        <div
          className={`absolute rounded-full border transition-all duration-300 pointer-events-none ${
            state === 'speaking'
              ? 'w-40 h-40 border-indigo-400/40 animate-ping'
              : state === 'listening' && isCandidateSpeaking
              ? 'w-36 h-36 border-emerald-400/50'
              : 'w-36 h-36 border-indigo-500/20'
          }`}
          style={{
            animationDuration: state === 'speaking' ? '2s' : undefined,
            transform: isCandidateSpeaking ? `scale(${1 + audioLevel * 0.25})` : undefined,
          }}
        />
      )}

      {/* Breathing ring for listening/idle */}
      {!prefersReducedMotion && state === 'listening' && (
        <div className="absolute w-32 h-32 rounded-full border border-indigo-400/30 animate-pulse pointer-events-none" />
      )}

      {/* Core Orb Body */}
      <div
        className={`relative w-28 h-28 sm:w-32 sm:h-32 rounded-full flex items-center justify-center transition-transform duration-200 shadow-2xl overflow-hidden ${
          prefersReducedMotion ? '' : state === 'idle' ? 'animate-[pulse_4s_ease-in-out_infinite]' : ''
        }`}
        style={{
          transform: !prefersReducedMotion && (state === 'speaking' || isCandidateSpeaking)
            ? `scale(${audioScale})`
            : 'scale(1)',
          background:
            state === 'speaking'
              ? 'radial-gradient(circle at 35% 35%, #818cf8 0%, #6366f1 45%, #4338ca 85%)'
              : state === 'listening'
              ? isCandidateSpeaking
                ? 'radial-gradient(circle at 35% 35%, #34d399 0%, #059669 45%, #047857 85%)'
                : 'radial-gradient(circle at 35% 35%, #60a5fa 0%, #3b82f6 45%, #1d4ed8 85%)'
              : state === 'thinking'
              ? 'radial-gradient(circle at 35% 35%, #c084fc 0%, #a855f7 45%, #6d28d9 85%)'
              : 'radial-gradient(circle at 35% 35%, #6366f1 0%, #4f46e5 50%, #312e81 90%)',
          boxShadow: `0 0 ${audioGlow}px ${
            state === 'speaking'
              ? 'rgba(99, 102, 241, 0.6)'
              : state === 'listening' && isCandidateSpeaking
              ? 'rgba(16, 185, 129, 0.6)'
              : 'rgba(99, 102, 241, 0.35)'
          }`,
        }}
      >
        {/* Specular highlight */}
        <div className="absolute top-2 left-3 w-8 h-4 rounded-full bg-white/30 transform -rotate-45 blur-[1px]" />

        {/* Inner dynamic icon / waveform indicator */}
        <div className="relative z-10 flex items-center justify-center gap-1">
          {state === 'thinking' ? (
            <div className="flex gap-1.5 items-center">
              <span className="w-2 h-2 rounded-full bg-white/90 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 rounded-full bg-white/90 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 rounded-full bg-white/90 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          ) : state === 'speaking' ? (
            <div className="flex items-center gap-1 h-6">
              {[0.4, 0.9, 0.6, 1.0, 0.5].map((factor, idx) => (
                <div
                  key={idx}
                  className="w-1 bg-white/90 rounded-full transition-all duration-75"
                  style={{
                    height: prefersReducedMotion ? '12px' : `${Math.max(6, 24 * factor * (0.6 + audioLevel * 0.4))}px`,
                  }}
                />
              ))}
            </div>
          ) : state === 'listening' && isCandidateSpeaking ? (
            <div className="flex items-center gap-1 h-6">
              {[0.5, 0.8, 1.0, 0.7, 0.4].map((factor, idx) => (
                <div
                  key={idx}
                  className="w-1 bg-white/90 rounded-full transition-all duration-75"
                  style={{
                    height: prefersReducedMotion ? '12px' : `${Math.max(6, 24 * factor * (0.5 + audioLevel * 0.5))}px`,
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="w-3 h-3 rounded-full bg-white/70" />
          )}
        </div>
      </div>
    </div>
  );
}

