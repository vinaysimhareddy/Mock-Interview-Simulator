import React, { useState } from 'react';
import {
  Sparkles,
  Clock,
  Mic,
  Laptop,
  Compass,
  CheckCircle2,
  ShieldCheck,
  ChevronRight,
  Headphones,
  Sun,
  Wifi,
  Volume2,
  Eye,
  ArrowLeft,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useTheme } from '@/context/ThemeContext';

export interface InterviewWelcomeProps {
  role: string;
  seniority: string;
  durationMinutes: number;
  interviewerName?: string;
  onContinue: () => void;
  onBack: () => void;
}

export function InterviewWelcome({
  role,
  seniority,
  durationMinutes,
  interviewerName = 'AI Interviewer',
  onContinue,
  onBack,
}: InterviewWelcomeProps): React.ReactElement {
  const [hasConsented, setHasConsented] = useState<boolean>(false);
  const { resolvedTheme, toggleTheme } = useTheme();

  const checklistItems = [
    {
      icon: <Laptop className="h-4 w-4 text-primary" />,
      title: 'Modern Browser & Device',
      description: 'Use a desktop or laptop with Google Chrome or Microsoft Edge for optimal speech recognition and vision tracking.',
    },
    {
      icon: <Volume2 className="h-4 w-4 text-primary" />,
      title: 'Quiet, Private Setting',
      description: 'Find a calm room free of background conversations and machinery noise.',
    },
    {
      icon: <Sun className="h-4 w-4 text-primary" />,
      title: 'Even Front Lighting',
      description: 'Ensure natural or soft front lighting so your face is clearly visible. Avoid strong backlighting.',
    },
    {
      icon: <Headphones className="h-4 w-4 text-primary" />,
      title: 'Headphones Recommended',
      description: 'Wearing headphones prevents audio echo and allows the voice turn engine to detect your speech reliably.',
    },
    {
      icon: <Wifi className="h-4 w-4 text-primary" />,
      title: 'Stable Connection',
      description: 'Ensure a consistent broadband or Wi-Fi connection for real-time WebSocket session synchronization.',
    },
    {
      icon: <Mic className="h-4 w-4 text-primary" />,
      title: 'Speak Naturally with Pauses',
      description: 'Speak in full thoughts. A short pause (3 seconds) signals that you have completed your response.',
    },
  ];

  return (
    <div className="w-full max-w-4xl mx-auto py-8 px-4 sm:px-6 space-y-8 animate-in fade-in duration-300">
      {/* Top Header / Navigation */}
      <div className="flex items-center justify-between pb-2 border-b border-border/60">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="text-xs text-muted-foreground hover:text-foreground rounded-full -ml-2"
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
          Back to Dashboard
        </Button>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs font-mono border-primary/30 text-primary">
            Step 1 of 3: Orientation
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleTheme}
            className="h-8 w-8 p-0 rounded-full text-muted-foreground hover:text-foreground"
            title="Toggle Theme"
          >
            {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Main Welcome Hero Card */}
      <Card className="border-border bg-card shadow-xl overflow-hidden rounded-3xl">
        <div className="p-6 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="h-10 w-10 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary shadow-inner">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">
                    Welcome to Your Technical Interview
                  </h1>
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    Prepared for <span className="font-semibold text-foreground">{seniority} {role}</span>
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-xs font-medium text-primary">
                <Clock className="h-3.5 w-3.5" />
                <span>{durationMinutes} min session</span>
              </div>
            </div>
          </div>

          {/* Section 1: What to Expect */}
          <div className="space-y-3 pt-2">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              What to Expect
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-4 rounded-2xl bg-muted/40 border border-border/70 space-y-1.5">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Mic className="h-4 w-4 text-primary" />
                  Voice Conversation
                </span>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Questions are delivered aloud by your {interviewerName}, and you respond by speaking naturally. No typing is required.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-muted/40 border border-border/70 space-y-1.5">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Compass className="h-4 w-4 text-primary" />
                  Adaptive Questions
                </span>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  The AI dynamically probes deeper based on specific concepts, tools, and technical decisions you highlight in your answers.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-muted/40 border border-border/70 space-y-1.5">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  Unbiased Assessment
                </span>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  No scores, grades, or critiques are revealed mid-interview. Your complete performance report is generated after completion.
                </p>
              </div>
            </div>
          </div>

          {/* Section 2: Preparation Checklist */}
          <div className="space-y-3 pt-2">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Preparation Checklist
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {checklistItems.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 p-3.5 rounded-2xl bg-muted/30 border border-border/50 hover:border-border transition-colors"
                >
                  <div className="p-2 rounded-xl bg-background border border-border shrink-0 mt-0.5">
                    {item.icon}
                  </div>
                  <div className="space-y-0.5">
                    <h3 className="text-xs font-semibold text-foreground">{item.title}</h3>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section 3: Privacy Notice & Required Consent */}
          <div className="p-5 rounded-2xl bg-primary/5 border border-primary/20 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/30 text-primary shrink-0 mt-0.5">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-xs sm:text-sm font-bold text-foreground">
                  Privacy & On-Device Processing
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Your camera and microphone are on during the interview. Camera monitoring and facial analysis run entirely on your device. Spoken answers are transcribed using your browser’s speech recognition service. Only numeric behavior signals and the transcribed text of your answers are saved. No raw audio or video recordings are stored on our servers.
                </p>
              </div>
            </div>

            {/* Required Consent Checkbox */}
            <div className="pt-2 border-t border-primary/15 flex items-start gap-3">
              <Checkbox
                id="interview-consent"
                checked={hasConsented}
                onCheckedChange={setHasConsented}
                className="mt-0.5"
              />
              <label
                htmlFor="interview-consent"
                className="text-xs text-foreground font-medium leading-relaxed cursor-pointer select-none"
              >
                I understand that my camera and microphone will be active for local privacy-preserving assessment, and I consent to start this interview session.
              </label>
            </div>
          </div>

          {/* Action Row */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-3 border-t border-border">
            <p className="text-[11px] text-muted-foreground text-center sm:text-left">
              Next step: Device verification and camera setup.
            </p>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              <Button
                variant="outline"
                onClick={onBack}
                className="w-full sm:w-auto rounded-full text-xs h-10 px-5"
              >
                Cancel
              </Button>
              <Button
                onClick={onContinue}
                disabled={!hasConsented}
                className="w-full sm:w-auto rounded-full text-xs font-semibold h-10 px-7 gap-2 shadow-lg shadow-primary/20 transition-all disabled:opacity-40"
              >
                <span>Continue to Device Check</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
