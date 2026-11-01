import React from 'react';
import { CheckCircle2, Loader2, FileDown, ArrowRight, Home, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export interface InterviewCompleteProps {
  role: string;
  seniority: string;
  isGeneratingReport?: boolean;
  hasReport?: boolean;
  onViewReport: () => void;
  onDownloadPdf?: () => void;
  isDownloadingPdf?: boolean;
  onReturnHome: () => void;
}

export function InterviewComplete({
  role,
  seniority,
  isGeneratingReport = false,
  hasReport = true,
  onViewReport,
  onDownloadPdf,
  isDownloadingPdf = false,
  onReturnHome,
}: InterviewCompleteProps): React.ReactElement {
  return (
    <div className="min-h-[80vh] w-full flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-300">
      <Card className="w-full max-w-xl border-border bg-card/95 shadow-2xl backdrop-blur-xl rounded-3xl overflow-hidden border">
        {/* Subtle accent top border */}
        <div className="h-1.5 w-full bg-gradient-to-r from-emerald-500 via-primary to-emerald-400" />

        <CardContent className="p-6 sm:p-10 flex flex-col items-center text-center space-y-6">
          {/* Completion Icon */}
          <div className="h-20 w-20 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-inner">
            <CheckCircle2 className="h-10 w-10 text-emerald-400 stroke-[2.2]" />
          </div>

          {/* Heading & Greeting */}
          <div className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Interview Complete
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground max-w-md mx-auto leading-relaxed">
              Thank you for taking the time to speak with our AI Interviewer today.
            </p>
          </div>

          {/* Target Role & Seniority Pill */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-muted/60 border border-border text-xs text-muted-foreground font-medium">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span>Target Role:</span>
            <span className="text-foreground font-semibold">
              {seniority} {role}
            </span>
          </div>

          {/* Report Compilation State Card */}
          {isGeneratingReport || !hasReport ? (
            <div className="w-full p-5 rounded-2xl bg-muted/30 border border-border/80 flex flex-col items-center space-y-3 animate-pulse">
              <div className="flex items-center gap-2 text-primary font-medium text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Generating your executive performance report...</span>
              </div>
              <p className="text-xs text-muted-foreground max-w-sm text-center leading-relaxed">
                Our evaluation engine is analyzing your technical depth, communication clarity, and verified biometric telemetry.
              </p>
              <div className="w-full bg-muted/60 rounded-full h-1.5 overflow-hidden mt-1">
                <div className="h-full bg-primary rounded-full animate-indeterminate-bar w-1/2" />
              </div>
            </div>
          ) : (
            <div className="w-full p-5 rounded-2xl bg-muted/30 border border-border/80 flex flex-col items-center space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="success" className="text-xs px-2.5 py-0.5 gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Scorecard Ready
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground max-w-sm text-center leading-relaxed">
                Your performance scorecard and personalized feedback analysis are ready for review.
              </p>
            </div>
          )}

          {/* Action CTAs */}
          <div className="w-full space-y-3 pt-2">
            <Button
              onClick={onViewReport}
              disabled={isGeneratingReport || !hasReport}
              className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm rounded-full gap-2 shadow-lg shadow-primary/20 cursor-pointer transition-transform active:scale-[0.99]"
            >
              <span>View Executive Report</span>
              <ArrowRight className="h-4 w-4" />
            </Button>

            {onDownloadPdf && (
              <Button
                variant="outline"
                onClick={onDownloadPdf}
                disabled={isGeneratingReport || !hasReport || isDownloadingPdf}
                className="w-full h-11 border-border bg-card hover:bg-muted/40 text-foreground font-medium text-xs rounded-full gap-2 cursor-pointer"
              >
                {isDownloadingPdf ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Compiling PDF...</span>
                  </>
                ) : (
                  <>
                    <FileDown className="h-3.5 w-3.5 text-primary" />
                    <span>Download PDF Report</span>
                  </>
                )}
              </Button>
            )}

            <Button
              variant="ghost"
              onClick={onReturnHome}
              className="w-full h-10 text-muted-foreground hover:text-foreground text-xs rounded-full gap-1.5 cursor-pointer"
            >
              <Home className="h-3.5 w-3.5" />
              <span>Return to Dashboard</span>
            </Button>
          </div>

          {/* Privacy Guarantee Confirmation */}
          <div className="pt-2 flex items-center justify-center gap-2 text-[11px] text-muted-foreground/80 border-t border-border/40 w-full pt-4">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            <span>Hardware camera & microphone tracks have been terminated.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

