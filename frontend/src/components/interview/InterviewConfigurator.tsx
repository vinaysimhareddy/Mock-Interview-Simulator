import React, { useState } from 'react';
import { Target, Award, Gauge, Play, Check } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiClient, ApiError } from '@/lib/api';
import { ResumeData } from './ResumeUploadDropzone';

export interface SessionData {
  id: string;
  user_id: string;
  resume_id?: string;
  role: string;
  seniority: 'Junior' | 'Mid' | 'Senior' | 'Lead';
  difficulty: 'Easy' | 'Medium' | 'Hard' | 'Adaptive';
  status: 'CREATED' | 'IN_PROGRESS' | 'COMPLETED' | 'TERMINATED';
  created_at: string;
}

interface InterviewConfiguratorProps {
  selectedResume: ResumeData | null;
  onSessionCreated: (session: SessionData) => void;
}

const PRESET_ROLES = [
  'Full Stack Engineer',
  'Frontend Engineer',
  'Backend Systems Engineer',
  'Machine Learning Engineer',
  'DevOps / Cloud Architect',
  'Engineering Manager',
];

const SENIORITIES: Array<'Junior' | 'Mid' | 'Senior' | 'Lead'> = [
  'Junior',
  'Mid',
  'Senior',
  'Lead',
];

const DIFFICULTIES: Array<'Easy' | 'Medium' | 'Hard' | 'Adaptive'> = [
  'Easy',
  'Medium',
  'Hard',
  'Adaptive',
];

export function InterviewConfigurator({
  selectedResume,
  onSessionCreated,
}: InterviewConfiguratorProps): React.ReactElement {
  const [role, setRole] = useState('Full Stack Engineer');
  const [customRole, setCustomRole] = useState('');
  const [seniority, setSeniority] = useState<'Junior' | 'Mid' | 'Senior' | 'Lead'>('Mid');
  const [difficulty, setDifficulty] = useState<'Easy' | 'Medium' | 'Hard' | 'Adaptive'>('Adaptive');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const activeRole = customRole.trim() || role;

  const handleCreateSession = async () => {
    setIsCreating(true);
    setCreateError(null);
    try {
      const session = await apiClient.post<SessionData>('/api/v1/sessions', {
        resume_id: selectedResume?.id || null,
        role: activeRole,
        seniority,
        difficulty,
      });
      onSessionCreated(session);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to initialize session.';
      setCreateError(msg);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Card className="border-slate-800 bg-slate-900/90 shadow-xl backdrop-blur-md">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-indigo-400" />
            <CardTitle className="text-lg text-white">Interview Configuration</CardTitle>
          </div>
          <Badge variant="outline" className="border-indigo-500/40 text-indigo-300 bg-indigo-950/40">
            {difficulty === 'Adaptive' ? 'LangGraph Adaptive Engine' : `${difficulty} Mode`}
          </Badge>
        </div>
        <CardDescription className="text-slate-400 text-xs">
          Configure target role, experience seniority, and adaptive AI question progression.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {createError && (
          <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-200 text-xs">
            {createError}
          </div>
        )}

        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
            <Target className="h-3.5 w-3.5 text-indigo-400" />
            Target Role & Specialization
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {PRESET_ROLES.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  setRole(preset);
                  setCustomRole('');
                }}
                className={`px-3 py-2 rounded-lg text-xs font-medium text-left transition-all border ${
                  activeRole === preset && !customRole
                    ? 'border-indigo-500 bg-indigo-600/20 text-white shadow-sm'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                {preset}
              </button>
            ))}
          </div>

          <div className="pt-1">
            <input
              type="text"
              placeholder="Or enter custom role (e.g. Site Reliability Engineer)"
              value={customRole}
              onChange={(e) => setCustomRole(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-950/80 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
            <Award className="h-3.5 w-3.5 text-indigo-400" />
            Target Seniority Level
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {SENIORITIES.map((tier) => (
              <button
                key={tier}
                type="button"
                onClick={() => setSeniority(tier)}
                className={`px-3 py-2.5 rounded-lg text-xs font-semibold transition-all border flex items-center justify-between ${
                  seniority === tier
                    ? 'border-indigo-500 bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                <span>{tier}</span>
                {seniority === tier && <Check className="h-3.5 w-3.5" />}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
            <Gauge className="h-3.5 w-3.5 text-indigo-400" />
            Question Difficulty Dynamics
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {DIFFICULTIES.map((diff) => (
              <button
                key={diff}
                type="button"
                onClick={() => setDifficulty(diff)}
                className={`px-3 py-2.5 rounded-lg text-xs font-semibold transition-all border flex flex-col items-start gap-0.5 ${
                  difficulty === diff
                    ? 'border-indigo-500 bg-indigo-950/60 text-indigo-200 shadow-sm'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span>{diff}</span>
                  {difficulty === diff && <Check className="h-3 w-3 text-indigo-400" />}
                </div>
                <span className="text-[10px] text-slate-500 font-normal">
                  {diff === 'Adaptive'
                    ? 'State machine adjusts'
                    : diff === 'Easy'
                    ? 'Standard fundamentals'
                    : diff === 'Medium'
                    ? 'Practical scenario'
                    : 'High complexity architecture'}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-xs text-slate-400 space-y-0.5">
            <div>
              Ready to interview for:{' '}
              <span className="text-white font-medium">{seniority} {activeRole}</span>
            </div>
            <div>
              Resume:{' '}
              <span className="text-indigo-300 font-mono">
                {selectedResume ? selectedResume.filename : 'No resume attached (General question pool)'}
              </span>
            </div>
          </div>

          <Button
            onClick={handleCreateSession}
            disabled={isCreating}
            className="w-full sm:w-auto h-11 px-6 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-lg shadow-indigo-600/30 gap-2 shrink-0 cursor-pointer"
          >
            {isCreating ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                Initializing...
              </span>
            ) : (
              <>
                <Play className="h-4 w-4 fill-white" />
                Start Live Interview
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
