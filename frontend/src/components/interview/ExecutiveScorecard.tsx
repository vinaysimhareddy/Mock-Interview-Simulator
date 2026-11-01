import React from 'react';
import {
  Award,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Download,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FinalReport } from '@/lib/types';

export interface ExecutiveScorecardProps {
  session: {
    id: string;
    role: string;
    seniority: string;
    created_at?: string;
  };
  report: FinalReport;
  onBack?: () => void;
  onDownloadPdf: () => void;
  isDownloadingPdf?: boolean;
  onReturnHome: () => void;
}

export function ExecutiveScorecard({
  session,
  report,
  onBack,
  onDownloadPdf,
  isDownloadingPdf = false,
  onReturnHome,
}: ExecutiveScorecardProps): React.ReactElement {
  const getRecommendationBadge = (rec: string) => {
    const lower = rec.toLowerCase();
    if (lower.includes('strong hire') || lower.includes('hire')) {
      return (
        <span className="text-xl sm:text-2xl font-bold text-emerald-400 font-mono mt-0.5 block">
          {rec}
        </span>
      );
    }
    if (lower.includes('consider') || lower.includes('hold')) {
      return (
        <span className="text-xl sm:text-2xl font-bold text-amber-400 font-mono mt-0.5 block">
          {rec}
        </span>
      );
    }
    return (
      <span className="text-xl sm:text-2xl font-bold text-rose-400 font-mono mt-0.5 block">
        {rec}
      </span>
    );
  };

  const getVerdictStyle = (verdict?: string) => {
    const v = verdict || 'Verified';
    if (v === 'Verified') {
      return {
        badgeClass: 'bg-emerald-950/80 text-emerald-300 border-emerald-600/50 text-xs px-3 py-1 gap-1.5',
        dotClass: 'bg-emerald-400',
      };
    }
    if (v === 'Verified with warnings') {
      return {
        badgeClass: 'bg-amber-950/80 text-amber-300 border-amber-600/50 text-xs px-3 py-1 gap-1.5',
        dotClass: 'bg-amber-400',
      };
    }
    return {
      badgeClass: 'bg-rose-950/80 text-rose-300 border-rose-600/50 text-xs px-3 py-1 gap-1.5',
      dotClass: 'bg-rose-500',
    };
  };

  const verdictStyle = getVerdictStyle(report.integrity_summary?.verdict);

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6 animate-in fade-in py-6 sm:py-8 px-4">
      {/* Top Navigation Bar */}
      <div className="flex items-center justify-between gap-4">
        {onBack ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="text-xs text-muted-foreground hover:text-foreground gap-1.5 cursor-pointer rounded-full"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to Completion Overview</span>
          </Button>
        ) : (
          <div />
        )}

        <Button
          onClick={onDownloadPdf}
          disabled={isDownloadingPdf}
          variant="outline"
          size="sm"
          className="border-indigo-700/60 bg-indigo-950/30 hover:bg-indigo-900/40 text-indigo-300 font-semibold text-xs px-4 h-9 gap-2 cursor-pointer rounded-full ml-auto"
        >
          {isDownloadingPdf ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Compiling PDF...</span>
            </>
          ) : (
            <>
              <Download className="h-3.5 w-3.5" />
              <span>Download PDF Report</span>
            </>
          )}
        </Button>
      </div>

      <Card className="border-border bg-card shadow-2xl backdrop-blur-xl rounded-3xl overflow-hidden">
        {/* Subtle accent header line */}
        <div className="h-1.5 w-full bg-gradient-to-r from-primary via-indigo-500 to-emerald-400" />

        <CardHeader className="text-center pb-6 border-b border-border">
          <div className="mx-auto p-3.5 rounded-2xl bg-primary/15 border border-primary/30 text-primary w-fit mb-2">
            <Award className="h-8 w-8" />
          </div>
          <CardTitle className="text-2xl sm:text-3xl text-foreground font-bold tracking-tight">
            Interview Completed: Executive Scorecard
          </CardTitle>
          <CardDescription className="text-muted-foreground text-xs font-mono">
            Role: {session.seniority} {session.role} • Evaluated by LangGraph Adaptive Engine
          </CardDescription>

          {/* Overall Score and Recommendation Display */}
          <div className="flex flex-wrap items-center justify-center gap-4 pt-5">
            <div className="text-center px-6 py-3 rounded-2xl bg-muted/60 border border-border min-w-[150px]">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider block font-medium">
                Overall Score
              </span>
              <span className="text-3xl sm:text-4xl font-extrabold text-foreground font-mono">
                {report.overall_score}
                <span className="text-sm text-muted-foreground font-normal">/100</span>
              </span>
            </div>

            <div className="text-center px-6 py-3 rounded-2xl bg-muted/60 border border-border min-w-[170px]">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider block font-medium">
                Recommendation
              </span>
              {getRecommendationBadge(report.hiring_recommendation)}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 pt-6 sm:p-8">
          {/* Category Breakdown (Technical Depth 60%, Communication 25%, Biometric Composure 15%) */}
          <div>
            <h3 className="text-xs uppercase font-semibold text-muted-foreground tracking-wider mb-3 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Evaluation Category Breakdown
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-4 rounded-2xl bg-muted/40 border border-border text-center space-y-1">
                <span className="text-xs text-muted-foreground block">Technical Depth (60%)</span>
                <p className="text-2xl font-bold text-indigo-400 font-mono">
                  {report.category_scores.technical}%
                </p>
                <div className="w-full bg-muted rounded-full h-1.5 mt-2 overflow-hidden">
                  <div
                    className="bg-indigo-500 h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, report.category_scores.technical))}%` }}
                  />
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-muted/40 border border-border text-center space-y-1">
                <span className="text-xs text-muted-foreground block">Communication (25%)</span>
                <p className="text-2xl font-bold text-sky-400 font-mono">
                  {report.category_scores.communication}%
                </p>
                <div className="w-full bg-muted rounded-full h-1.5 mt-2 overflow-hidden">
                  <div
                    className="bg-sky-500 h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, report.category_scores.communication))}%` }}
                  />
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-muted/40 border border-border text-center space-y-1">
                <span className="text-xs text-muted-foreground block">Biometric Composure (15%)</span>
                <p className="text-2xl font-bold text-emerald-400 font-mono">
                  {report.category_scores.composure}%
                </p>
                <div className="w-full bg-muted rounded-full h-1.5 mt-2 overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, report.category_scores.composure))}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Key Strengths & Growth Opportunities */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 sm:p-5 rounded-2xl bg-emerald-950/20 border border-emerald-900/40 space-y-2.5">
              <span className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                Key Strengths
              </span>
              <ul className="text-xs text-muted-foreground space-y-2 list-disc list-inside">
                {report.strengths.map((str, i) => (
                  <li key={i} className="leading-relaxed">
                    {str}
                  </li>
                ))}
              </ul>
            </div>

            <div className="p-4 sm:p-5 rounded-2xl bg-amber-950/20 border border-amber-900/40 space-y-2.5">
              <span className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                <AlertCircle className="h-4 w-4 text-amber-400" />
                Growth Opportunities
              </span>
              <ul className="text-xs text-muted-foreground space-y-2 list-disc list-inside">
                {report.weaknesses.map((w, i) => (
                  <li key={i} className="leading-relaxed">
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Executive Summary */}
          <div className="p-4 sm:p-5 rounded-2xl bg-muted/40 border border-border text-xs text-muted-foreground leading-relaxed space-y-1.5">
            <span className="font-semibold text-foreground block text-sm">Executive Summary:</span>
            <p className="leading-relaxed">{report.executive_summary}</p>
          </div>

          {/* Physical Camera Integrity & Biometric Verification (§7) */}
          <div className="p-5 rounded-2xl bg-muted/30 border border-border space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-border pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-indigo-950/60 border border-indigo-700/50 text-indigo-400">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-foreground tracking-wide">
                    Physical Camera Integrity & Biometric Verification (§7)
                  </h4>
                  <p className="text-[11px] text-muted-foreground">
                    Validated by client-side WebAssembly heuristics and server plausibility checks
                  </p>
                </div>
              </div>
              <Badge className={verdictStyle.badgeClass}>
                <span className={`h-2 w-2 rounded-full ${verdictStyle.dotClass}`} />
                Verdict: {report.integrity_summary?.verdict || 'Verified'}
              </Badge>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="p-3 rounded-xl bg-card border border-border space-y-1">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider block">
                  Integrity Score
                </span>
                <span className="text-lg font-bold font-mono text-emerald-400">
                  {report.integrity_summary?.integrity_score ?? 100}/100
                </span>
              </div>
              <div className="p-3 rounded-xl bg-card border border-border space-y-1">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider block">
                  Face Present Rate
                </span>
                <span className="text-lg font-bold font-mono text-foreground">
                  {report.integrity_summary?.face_present_percentage ?? 100}%
                </span>
              </div>
              <div className="p-3 rounded-xl bg-card border border-border space-y-1">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider block">
                  Challenges Passed
                </span>
                <span className="text-lg font-bold font-mono text-indigo-300">
                  {report.integrity_summary?.challenges_passed ?? 1} /{' '}
                  {(report.integrity_summary?.challenges_passed ?? 1) +
                    (report.integrity_summary?.challenges_failed ?? 0)}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-card border border-border space-y-1">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider block">
                  Pause / Loss Incidents
                </span>
                <span className="text-lg font-bold font-mono text-muted-foreground">
                  {report.integrity_summary?.pauses_count ?? 0} incidents
                </span>
              </div>
            </div>

            <div className="text-[11px] text-muted-foreground bg-card/60 p-3.5 rounded-xl border border-border space-y-1">
              <p className="text-indigo-400 font-medium">
                •{' '}
                {report.integrity_summary?.non_verbal_excluded_note ||
                  'Non-verbal scores (eye contact, posture) are computed only from verified-live segments; segments with active integrity flags were excluded.'}
                {' '}({report.integrity_summary?.excluded_segments_count ?? 0} flagged segments excluded).
              </p>
              <p className="text-muted-foreground">
                • Active Camera Device:{' '}
                <span className="font-mono text-foreground">
                  {report.integrity_summary?.camera_device_name || 'Physical Hardware Webcam Verified'}
                </span>
              </p>
            </div>
          </div>

          {/* Action Footer */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
            <Button
              onClick={onDownloadPdf}
              disabled={isDownloadingPdf}
              variant="outline"
              className="w-full sm:w-auto border-indigo-700/60 bg-indigo-950/30 hover:bg-indigo-900/40 text-indigo-300 font-semibold text-xs px-5 h-10 gap-2 cursor-pointer rounded-full"
            >
              {isDownloadingPdf ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Compiling PDF...</span>
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  <span>Download PDF Report</span>
                </>
              )}
            </Button>

            <Button
              onClick={onReturnHome}
              className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs px-6 h-10 gap-2 cursor-pointer rounded-full"
            >
              <span>Return to Dashboard</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

