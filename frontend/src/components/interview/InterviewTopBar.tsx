import React, { useState } from 'react';
import {
  Sparkles,
  Clock,
  Sun,
  Moon,
  LogOut,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { useTheme } from '@/context/ThemeContext';

export interface InterviewTopBarProps {
  role: string;
  seniority: string;
  remainingSeconds?: number;
  totalDurationMinutes?: number;
  cameraActive?: boolean;
  micActive?: boolean;
  onEndInterview?: () => void;
  onOpenHelp?: () => void;
  showTimer?: boolean;
  interviewerName?: string;
}

export function InterviewTopBar({
  role,
  seniority,
  remainingSeconds = 900,
  totalDurationMinutes: _totalDurationMinutes = 15,
  cameraActive = true,
  micActive = true,
  onEndInterview,
  onOpenHelp: _onOpenHelp,
  showTimer = true,
  interviewerName = 'AI Interviewer',
}: InterviewTopBarProps): React.ReactElement {
  const { resolvedTheme, toggleTheme } = useTheme();
  const [showConfirmEnd, setShowConfirmEnd] = useState<boolean>(false);

  const formatRemaining = (seconds: number) => {
    const mins = Math.floor(Math.max(0, seconds) / 60);
    const secs = Math.max(0, seconds) % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const isLowTime = remainingSeconds <= 120; // 2 min remaining

  return (
    <>
      <header className="w-full border-b border-border/80 bg-background/80 backdrop-blur-md sticky top-0 z-40 px-4 sm:px-6 h-14 flex items-center justify-between transition-colors">
        {/* Left: Brand logo & Candidate Role */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-8 w-8 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary shrink-0">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="flex items-center gap-2 truncate">
            <span className="font-semibold text-sm text-foreground tracking-tight hidden sm:inline">
              {interviewerName}
            </span>
            <span className="text-muted-foreground hidden sm:inline">•</span>
            <span className="text-xs font-medium text-foreground truncate">
              {seniority} {role}
            </span>
          </div>
        </div>

        {/* Center / Right: Timer & Indicators */}
        <div className="flex items-center gap-3 sm:gap-4 shrink-0">
          {/* Remaining-time timer */}
          {showTimer && (
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-medium transition-colors ${
                isLowTime
                  ? 'bg-rose-500/15 border border-rose-500/30 text-rose-400 animate-pulse'
                  : 'bg-muted/60 border border-border text-foreground'
              }`}
              title="Time remaining in current interview session"
            >
              <Clock className="h-3 w-3" />
              <span>{formatRemaining(remainingSeconds)}</span>
            </div>
          )}

          {/* Privacy Camera & Mic Active indicator */}
          <Tooltip
            content={
              <div className="space-y-1">
                <p className="font-semibold text-xs text-white">Privacy-Preserving On-Device CV</p>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  Your camera and microphone are on during the interview. Camera monitoring and facial analysis run entirely on your device. Spoken answers are transcribed using your browser’s speech recognition service. Only numeric behavior signals and the transcribed text of your answers are saved. No raw audio or video recordings are stored on our servers.
                </p>
              </div>
            }
            side="bottom"
          >
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/60 border border-border text-xs cursor-help select-none"
              tabIndex={0}
              aria-label="Camera and microphone active status: Privacy protected"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  cameraActive && micActive
                    ? 'bg-emerald-500 animate-pulse'
                    : 'bg-amber-400'
                }`}
              />
              <span className="text-muted-foreground text-[11px] font-medium hidden md:inline">
                Camera & mic active: monitoring posture & eye contact
              </span>
            </div>
          </Tooltip>

          {/* Light / Dark Theme Toggle */}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleTheme}
            className="h-8 w-8 p-0 rounded-full text-muted-foreground hover:text-foreground"
            title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
            aria-label="Toggle visual theme"
          >
            {resolvedTheme === 'dark' ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </Button>

          {/* End Interview ghost button */}
          {onEndInterview && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowConfirmEnd(true)}
              className="h-8 px-2.5 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full"
            >
              <LogOut className="h-3.5 w-3.5 mr-1" />
              <span className="hidden sm:inline">End interview</span>
            </Button>
          )}
        </div>
      </header>

      {/* Confirmation Dialog for Early Exit */}
      {showConfirmEnd && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-end-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in"
        >
          <div className="w-full max-w-md rounded-2xl bg-card border border-border p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-destructive/15 border border-destructive/30 flex items-center justify-center text-destructive shrink-0">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div>
                <h3 id="confirm-end-title" className="text-base font-bold text-foreground">
                  Conclude Interview Session?
                </h3>
                <p className="text-xs text-muted-foreground">
                  Your responses so far will be evaluated and saved into your final scorecard.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowConfirmEnd(false)}
                className="rounded-full"
              >
                Continue Interview
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setShowConfirmEnd(false);
                  onEndInterview?.();
                }}
                className="rounded-full"
              >
                Conclude Now
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
