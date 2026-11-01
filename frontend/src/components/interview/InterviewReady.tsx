import React, { useState } from 'react';
import {
  Sparkles,
  Clock,
  Play,
  ArrowLeft,
  CheckCircle2,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SessionData } from './InterviewConfigurator';

export interface InterviewReadyProps {
  session: SessionData;
  durationMinutes: number;
  interviewerName?: string;
  onStart: () => void;
  onBack: () => void;
}

export function InterviewReady({
  session,
  durationMinutes,
  interviewerName = 'AI Interviewer',
  onStart,
  onBack,
}: InterviewReadyProps): React.ReactElement {
  const [isUnlocking, setIsUnlocking] = useState<boolean>(false);

  const handleStartClick = async () => {
    setIsUnlocking(true);
    try {
      // Audio unlock gesture: activate audio context and test speechSynthesis if available
      if (typeof window !== 'undefined') {
        const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioContextClass) {
          const ctx = new AudioContextClass();
          if (ctx.state === 'suspended') {
            await ctx.resume().catch(() => {});
          }
          await ctx.close().catch(() => {});
        }
        if ('speechSynthesis' in window) {
          window.speechSynthesis.resume();
        }
      }
    } catch {
      // Non-blocking gesture unlock guard
    } finally {
      onStart();
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto py-12 px-4 sm:px-6 space-y-6 animate-in fade-in duration-300">
      {/* Back action */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="text-xs text-muted-foreground hover:text-foreground rounded-full -ml-2"
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
          Back to Setup
        </Button>
        <Badge variant="outline" className="text-xs font-mono border-primary/30 text-primary">
          Step 3 of 3: Launch
        </Badge>
      </div>

      {/* Main Ready Card */}
      <Card className="border-border bg-card shadow-2xl rounded-3xl overflow-hidden text-center">
        <div className="p-8 sm:p-10 space-y-6">
          {/* Animated Avatar / Glow */}
          <div className="relative mx-auto w-24 h-24 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-primary/30 to-indigo-500/20 blur-xl animate-pulse" />
            <div className="relative h-20 w-20 rounded-full bg-gradient-to-tr from-primary to-indigo-600 flex items-center justify-center text-white shadow-xl shadow-primary/30">
              <Sparkles className="h-9 w-9" />
            </div>
          </div>

          {/* Heading */}
          <div className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">
              Ready to Begin
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground max-w-md mx-auto">
              Your equipment is verified and your {interviewerName} is prepared.
            </p>
          </div>

          {/* Interview Details Summary Box */}
          <div className="grid grid-cols-2 gap-3 max-w-md mx-auto text-left">
            <div className="p-3.5 rounded-2xl bg-muted/40 border border-border space-y-1">
              <span className="text-[11px] text-muted-foreground uppercase font-semibold tracking-wider block">
                Target Role
              </span>
              <p className="text-xs sm:text-sm font-bold text-foreground truncate">
                {session.seniority} {session.role}
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-muted/40 border border-border space-y-1">
              <span className="text-[11px] text-muted-foreground uppercase font-semibold tracking-wider block">
                Duration
              </span>
              <p className="text-xs sm:text-sm font-bold text-foreground flex items-center gap-1.5 font-mono">
                <Clock className="h-3.5 w-3.5 text-primary" />
                {durationMinutes} minutes
              </p>
            </div>
          </div>

          {/* Key Quick Reminders */}
          <div className="space-y-2.5 max-w-md mx-auto text-xs text-muted-foreground text-left py-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
              <span>Questions are read aloud and shown as text captions.</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
              <span>Answer naturally by speaking. There is no typing flow.</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
              <span>A 3-second natural silence ends your answer turn.</span>
            </div>
          </div>

          {/* Big Start Button (Audio unlock gesture) */}
          <div className="pt-4 max-w-md mx-auto space-y-3">
            <Button
              size="lg"
              onClick={handleStartClick}
              disabled={isUnlocking}
              className="w-full h-14 rounded-full text-base font-bold gap-3 shadow-xl shadow-primary/25 hover:shadow-primary/40 active:scale-[0.98] transition-all cursor-pointer"
            >
              <Play className="h-5 w-5 fill-current" />
              <span>Start Interview</span>
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Clicking Start activates the live voice engine and begins Question 1.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
