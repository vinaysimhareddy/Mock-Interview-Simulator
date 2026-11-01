import React from 'react';
import { AlertTriangle, CheckCircle2, RotateCcw, Home, ShieldAlert, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export interface InterviewAbortedProps {
  role: string;
  seniority: string;
  reason?: 'aborted_face_not_visible' | 'aborted_camera_lost' | 'user_ended' | string;
  onReturnHome: () => void;
  onRestartSession?: () => void;
}

export function InterviewAborted({
  role,
  seniority,
  reason = 'user_ended',
  onReturnHome,
  onRestartSession,
}: InterviewAbortedProps): React.ReactElement {
  const getReasonDetails = () => {
    switch (reason) {
      case 'aborted_face_not_visible':
        return {
          title: 'Face Absence Policy Triggered',
          description:
            'Your face was not detected in the camera frame for 30 consecutive seconds after two automated warnings.',
          tip: 'Ensure your room is well lit from the front, your webcam is centered at eye level, and avoid stepping away from the camera during an active interview.',
        };
      case 'aborted_camera_lost':
        return {
          title: 'Camera Feed Interrupted',
          description:
            'The physical camera stream was disconnected or obstructed and was not restored within the 30-second recovery grace window.',
          tip: 'Check that your webcam cable is firmly plugged in, close any other applications that might lock the camera (such as Zoom or Teams), and retry.',
        };
      case 'user_ended':
        return {
          title: 'Session Concluded Early',
          description:
            'You chose to conclude the interview session before completing all adaptive questions.',
          tip: 'You can begin a fresh interview session whenever you are ready.',
        };
      default:
        return {
          title: 'Interview Concluded Early',
          description:
            typeof reason === 'string' && reason.length > 0
              ? reason
              : 'The interview session was concluded before completion.',
          tip: 'You can return to the dashboard and configure a new session when convenient.',
        };
    }
  };

  const details = getReasonDetails();

  return (
    <div className="min-h-[80vh] w-full flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-300">
      <Card className="w-full max-w-xl border-border bg-card/95 shadow-2xl backdrop-blur-xl rounded-3xl overflow-hidden border">
        {/* Subtle accent top border */}
        <div className="h-1.5 w-full bg-gradient-to-r from-amber-500 via-rose-500 to-amber-500" />

        <CardContent className="p-6 sm:p-10 flex flex-col items-center text-center space-y-6">
          {/* Status Icon */}
          <div className="h-20 w-20 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-inner">
            <ShieldAlert className="h-10 w-10 text-amber-400 stroke-[2.2]" />
          </div>

          {/* Heading */}
          <div className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Interview Ended
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground max-w-md mx-auto leading-relaxed">
              {details.title}
            </p>
          </div>

          {/* Session Info Pill */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-muted/60 border border-border text-xs text-muted-foreground font-medium">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            <span>Target Role:</span>
            <span className="text-foreground font-semibold">
              {seniority} {role}
            </span>
          </div>

          {/* Specific Reason & Advice Card */}
          <div className="w-full p-4 sm:p-5 rounded-2xl bg-amber-950/20 border border-amber-900/40 text-left space-y-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="text-xs font-semibold text-amber-300 block">
                  Why this happened:
                </span>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {details.description}
                </p>
              </div>
            </div>

            <div className="pt-2 border-t border-amber-900/40 text-[11px] text-muted-foreground">
              <span className="text-amber-300 font-medium mr-1.5">Tip for next session:</span>
              <span>{details.tip}</span>
            </div>
          </div>

          {/* What Was Saved (§3.7) */}
          <div className="w-full p-4 rounded-2xl bg-muted/40 border border-border text-left space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              <span>What was saved</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed pl-6">
              All responses, answer transcripts, and biometric telemetry signals recorded prior to this point have been safely stored with your candidate record.
            </p>
          </div>

          {/* Actions */}
          <div className="w-full space-y-3 pt-2">
            <Button
              onClick={onReturnHome}
              className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm rounded-full gap-2 shadow-lg shadow-primary/20 cursor-pointer transition-transform active:scale-[0.99]"
            >
              <Home className="h-4 w-4" />
              <span>Back to Dashboard</span>
            </Button>

            {onRestartSession && (
              <Button
                variant="outline"
                onClick={onRestartSession}
                className="w-full h-11 border-border bg-card hover:bg-muted/40 text-foreground font-medium text-xs rounded-full gap-2 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5 text-primary" />
                <span>Start New Interview Session</span>
              </Button>
            )}
          </div>

          {/* Calming reassurance */}
          <p className="text-[11px] text-muted-foreground/80 flex items-center justify-center gap-1.5 pt-1">
            <Sparkles className="h-3 w-3 text-primary/70" />
            <span>You can practice or restart interviews as many times as you like.</span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

