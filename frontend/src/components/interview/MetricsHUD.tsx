import React from 'react';
import {
  AlertTriangle,
  Camera,
  Compass,
  Eye,
  Smile,
  UserCheck,
} from 'lucide-react';
import { Badge } from '../ui/badge';
import { DistractionFlag, ExpressionMetrics, HeadPose } from '../../lib/types';

export interface MetricsHUDProps {
  eyeContactRatio: number | null; // 0..1 or null when face not present
  postureScore: number | null;    // 0..1 or null when face not present
  headPose: HeadPose | null;
  expression: ExpressionMetrics | null;
  distractionFlags: DistractionFlag[];
  fps: number;
  facePresent: boolean;
}

export function MetricsHUD({
  eyeContactRatio,
  postureScore,
  headPose,
  expression,
  distractionFlags,
  fps,
  facePresent,
}: MetricsHUDProps): React.ReactElement {
  const gazePercent = facePresent && eyeContactRatio !== null ? Math.round(eyeContactRatio * 100) : null;
  const posturePercent = facePresent && postureScore !== null ? Math.round(postureScore * 100) : null;

  const getGazeColor = (pct: number | null) => {
    if (pct === null) return 'text-slate-500 border-slate-800 bg-slate-950/60';
    if (pct >= 70) return 'text-emerald-400 border-emerald-500/40 bg-emerald-950/40';
    if (pct >= 40) return 'text-amber-400 border-amber-500/40 bg-amber-950/40';
    return 'text-rose-400 border-rose-500/40 bg-rose-950/40';
  };

  const getPostureColor = (pct: number | null) => {
    if (pct === null) return 'text-slate-500 border-slate-800 bg-slate-950/60';
    if (pct >= 75) return 'text-emerald-400 border-emerald-500/40 bg-emerald-950/40';
    if (pct >= 50) return 'text-amber-400 border-amber-500/40 bg-amber-950/40';
    return 'text-rose-400 border-rose-500/40 bg-rose-950/40';
  };

  return (
    <div className="w-full bg-slate-900/90 backdrop-blur-md rounded-xl border border-slate-800 p-4 space-y-4">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-800 text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <Camera className="h-4 w-4 text-indigo-400" />
          <span className="font-semibold text-slate-200">Local Telemetry (WASM 1 Hz)</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 font-mono text-slate-300">
            {fps} FPS
          </span>
        </div>
        <div className="flex items-center gap-2">
          {facePresent ? (
            <span className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Face Detected
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-amber-400 text-xs font-medium">
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
              Face not detected
            </span>
          )}
        </div>
      </div>

      {/* Primary Metrics Gauges */}
      <div className="grid grid-cols-2 gap-3">
        {/* Eye Contact Ratio */}
        <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5 text-indigo-400" />
              Eye Contact
            </span>
            <span className={`text-xs font-bold px-2 py-0.5 rounded border ${getGazeColor(gazePercent)}`}>
              {gazePercent !== null ? `${gazePercent}%` : '—'}
            </span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                gazePercent === null
                  ? 'bg-slate-700'
                  : gazePercent >= 70
                  ? 'bg-emerald-500'
                  : gazePercent >= 40
                  ? 'bg-amber-500'
                  : 'bg-rose-500'
              }`}
              style={{ width: `${gazePercent ?? 0}%` }}
            />
          </div>
        </div>

        {/* Posture Score */}
        <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 flex items-center gap-1.5">
              <UserCheck className="h-3.5 w-3.5 text-indigo-400" />
              Posture Score
            </span>
            <span className={`text-xs font-bold px-2 py-0.5 rounded border ${getPostureColor(posturePercent)}`}>
              {posturePercent !== null ? `${posturePercent}%` : '—'}
            </span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                posturePercent === null
                  ? 'bg-slate-700'
                  : posturePercent >= 75
                  ? 'bg-emerald-500'
                  : posturePercent >= 50
                  ? 'bg-amber-500'
                  : 'bg-rose-500'
              }`}
              style={{ width: `${posturePercent ?? 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* Secondary Metrics: Head Pose & Facial Expression */}
      <div className="grid grid-cols-2 gap-3 text-xs font-mono">
        {/* Head Pose */}
        <div className="p-2.5 rounded-lg bg-slate-950/40 border border-slate-800/60 text-slate-400">
          <div className="flex items-center gap-1 text-[11px] text-slate-300 mb-1">
            <Compass className="h-3 w-3 text-indigo-400" />
            Head Pose
          </div>
          {facePresent && headPose ? (
            <div className="flex justify-between">
              <span>Yaw: {headPose.yaw > 0 ? `+${headPose.yaw}` : headPose.yaw}°</span>
              <span>Pitch: {headPose.pitch > 0 ? `+${headPose.pitch}` : headPose.pitch}°</span>
            </div>
          ) : (
            <div className="text-slate-500 italic">No head pose detected</div>
          )}
        </div>

        {/* Expression */}
        <div className="p-2.5 rounded-lg bg-slate-950/40 border border-slate-800/60 text-slate-400">
          <div className="flex items-center gap-1 text-[11px] text-slate-300 mb-1">
            <Smile className="h-3 w-3 text-indigo-400" />
            Expression
          </div>
          {facePresent && expression ? (
            <div className="flex justify-between">
              <span>Smile: {Math.round(expression.smile * 100)}%</span>
              <span>Brow: {Math.round(expression.brow_furrow * 100)}%</span>
            </div>
          ) : (
            <div className="text-slate-500 italic">No expression data</div>
          )}
        </div>
      </div>

      {/* Active Distraction Warnings */}
      {distractionFlags.length > 0 && (
        <div className="space-y-1 pt-1">
          <span className="text-[11px] text-amber-400 flex items-center gap-1 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5" />
            Active Distraction Signals
          </span>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {distractionFlags.map((flag) => (
              <Badge
                key={flag}
                variant="destructive"
                className="text-[11px] uppercase tracking-wider bg-rose-950/60 border-rose-800 text-rose-300 py-0.5 px-2"
              >
                {flag.replace('_', ' ')}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
