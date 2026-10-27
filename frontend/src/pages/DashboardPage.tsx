import React, { useState, useEffect } from 'react';
import {
  Key,
  LogOut,
  Send,
  AlertTriangle,
  CheckCircle,
  Copy,
  Check,
  FileText,
  PlayCircle,
  Layers,
  Video,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/context/AuthContext';
import { apiClient, ApiError } from '@/lib/api';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { ResumeUploadDropzone, ResumeData } from '@/components/interview/ResumeUploadDropzone';
import { InterviewConfigurator, SessionData } from '@/components/interview/InterviewConfigurator';
import { PreInterviewSetup } from '@/components/interview/PreInterviewSetup';
import { InterviewRoom } from '@/components/interview/InterviewRoom';
import { useMediaStream } from '@/context/CameraStreamContext';

export default function DashboardPage(): React.ReactElement {
  const { user, token, logout, fetchProfile } = useAuth();
  const { stopAll } = useMediaStream();
  const [selectedResume, setSelectedResume] = useState<ResumeData | null>(null);
  const [activeSession, setActiveSession] = useState<SessionData | null>(null);
  const [setupSession, setSetupSession] = useState<SessionData | null>(null);
  const [_sessionDurationMinutes, setSessionDurationMinutes] = useState<number>(20);
  const [activeRoomSession, setActiveRoomSession] = useState<SessionData | null>(null);
  const [sessionsList, setSessionsList] = useState<SessionData[]>([]);
  const [resumesList, setResumesList] = useState<ResumeData[]>([]);
  const [_isLoadingData, setIsLoadingData] = useState(false);

  // Security test sandbox state
  const [testResult, setTestResult] = useState<{
    endpoint: string;
    status: number;
    data: unknown;
    timestamp: string;
    isError?: boolean;
  } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);

  // Load candidate's existing resumes and sessions
  useEffect(() => {
    async function loadCandidateData() {
      setIsLoadingData(true);
      try {
        const [resumes, sessions] = await Promise.all([
          apiClient.get<ResumeData[]>('/api/v1/resumes').catch(() => []),
          apiClient.get<SessionData[]>('/api/v1/sessions').catch(() => []),
        ]);
        setResumesList(resumes);
        if (resumes.length > 0 && !selectedResume) {
          setSelectedResume(resumes[0]);
        }
        setSessionsList(sessions);
      } finally {
        setIsLoadingData(false);
      }
    }
    loadCandidateData();
  }, []);

  const handleResumeParsed = (resume: ResumeData) => {
    setSelectedResume(resume);
    setResumesList((prev) => [resume, ...prev.filter((r) => r.id !== resume.id)]);
  };

  const handleSessionCreated = (session: SessionData) => {
    setActiveSession(session);
    setSetupSession(session);
    setSessionsList((prev) => [session, ...prev]);
  };

  const testWithToken = async () => {
    setIsTesting(true);
    try {
      const data = await fetchProfile();
      setTestResult({
        endpoint: 'GET /api/v1/auth/me (With Bearer Token)',
        status: 200,
        data,
        timestamp: new Date().toLocaleTimeString(),
        isError: false,
      });
    } catch (err) {
      const errorData = err instanceof ApiError ? err.data : { error: 'Unknown error' };
      const status = err instanceof ApiError ? err.status : 500;
      setTestResult({
        endpoint: 'GET /api/v1/auth/me (With Bearer Token)',
        status,
        data: errorData,
        timestamp: new Date().toLocaleTimeString(),
        isError: true,
      });
    } finally {
      setIsTesting(false);
    }
  };

  const testWithoutToken = async () => {
    setIsTesting(true);
    try {
      const response = await fetch('/api/v1/auth/me', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      setTestResult({
        endpoint: 'GET /api/v1/auth/me (WITHOUT Authorization Header)',
        status: response.status,
        data,
        timestamp: new Date().toLocaleTimeString(),
        isError: response.status !== 200,
      });
    } catch {
      setTestResult({
        endpoint: 'GET /api/v1/auth/me (WITHOUT Authorization Header)',
        status: 401,
        data: { detail: 'Could not validate credentials' },
        timestamp: new Date().toLocaleTimeString(),
        isError: true,
      });
    } finally {
      setIsTesting(false);
    }
  };

  const copyToken = () => {
    if (token) {
      navigator.clipboard.writeText(token);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    }
  };

  // If in pre-interview equipment & duration setup, render PreInterviewSetup
  if (setupSession) {
    return (
      <PreInterviewSetup
        role={setupSession.role}
        seniority={setupSession.seniority}
        onStartInterview={(config) => {
          setSessionDurationMinutes(config.durationMinutes);
          setActiveRoomSession(setupSession);
          setSetupSession(null);
        }}
        onCancel={() => setSetupSession(null)}
      />
    );
  }

  // If in live interview room, render the InterviewRoom component
  if (activeRoomSession) {
    return (
      <InterviewRoom
        session={activeRoomSession}
        token={token || ''}
        durationMinutes={_sessionDurationMinutes}
        onExit={() => {
          stopAll();
          setActiveRoomSession(null);
        }}
      />
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto py-8 px-4 space-y-8">
      {/* Candidate Profile Header Card */}
      <Card className="border-slate-800 bg-slate-900/90 shadow-xl backdrop-blur-md">
        <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 font-bold text-xl shadow-inner">
              {user?.full_name?.charAt(0).toUpperCase() || 'C'}
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-2xl font-bold text-white tracking-tight">
                  {user?.full_name}
                </h2>
                <Badge variant="success" className="font-mono text-xs">
                  {user?.role}
                </Badge>
              </div>
              <p className="text-sm text-slate-400 font-mono mt-0.5">{user?.email}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={logout}
              className="text-rose-400 border-rose-900/60 bg-rose-950/20 hover:bg-rose-900/40 hover:text-rose-300"
            >
              <LogOut className="h-4 w-4 mr-1.5" />
              Sign Out
            </Button>
          </div>
        </CardHeader>

        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
            <span className="text-xs text-slate-400 font-medium">Candidate ID</span>
            <p className="text-xs font-mono text-slate-200 truncate" title={user?.id}>
              {user?.id}
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
            <span className="text-xs text-slate-400 font-medium">Active Resumes</span>
            <div className="flex items-center gap-1.5 text-xs text-slate-200">
              <FileText className="h-3.5 w-3.5 text-indigo-400" />
              <span>{resumesList.length} uploaded document(s)</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
            <span className="text-xs text-slate-400 font-medium">Interview Sessions</span>
            <div className="flex items-center gap-1.5 text-xs text-emerald-400">
              <Layers className="h-3.5 w-3.5 text-emerald-400" />
              <span>{sessionsList.length} created session(s)</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* PHASE 3 & 4: Resume Ingestion & Interview Configurator Grid */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Layers className="h-5 w-5 text-indigo-400" />
            Interview Preparation & Grounding
          </h2>
          <Badge variant="outline" className="border-indigo-500/40 text-indigo-300 bg-indigo-950/40">
            Phase 3 & 4: Computer Vision & Telemetry
          </Badge>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column: Resume Ingestion */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-1.5">
              <FileText className="h-4 w-4 text-indigo-400" />
              1. Resume Upload & PDF Parsing (pdfplumber)
            </h3>
            <ErrorBoundary fallbackTitle="Resume Ingestion Error">
              <ResumeUploadDropzone
                onParsed={handleResumeParsed}
                selectedResume={selectedResume}
              />
            </ErrorBoundary>
          </div>

          {/* Right Column: Interview Session Configuration */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-1.5">
              <PlayCircle className="h-4 w-4 text-indigo-400" />
              2. Target Role, Seniority & Difficulty
            </h3>
            <InterviewConfigurator
              selectedResume={selectedResume}
              onSessionCreated={handleSessionCreated}
            />
          </div>
        </div>
      </section>

      {/* Active Created Session Alert */}
      {activeSession && (
        <Card className="border-emerald-700/80 bg-emerald-950/20 backdrop-blur-md animate-in fade-in">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-emerald-400" />
                <CardTitle className="text-base text-white">
                  Interview Session Active
                </CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="success" className="font-mono text-xs">
                  Status: {activeSession.status}
                </Badge>
                <Button
                  size="sm"
                  onClick={() => setSetupSession(activeSession)}
                  className="h-8 bg-indigo-600 hover:bg-indigo-700 text-white text-xs gap-1.5 cursor-pointer"
                >
                  <Video className="h-3.5 w-3.5" />
                  Configure & Enter Live Room
                </Button>
              </div>
            </div>
            <CardDescription className="text-slate-300 text-xs">
              Session UUID: <span className="font-mono text-emerald-300">{activeSession.id}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-slate-300">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 py-2 border-y border-emerald-900/60 font-mono">
              <div>Role: <span className="text-white">{activeSession.role}</span></div>
              <div>Seniority: <span className="text-white">{activeSession.seniority}</span></div>
              <div>Difficulty: <span className="text-white">{activeSession.difficulty}</span></div>
              <div>Created: <span className="text-white">{new Date(activeSession.created_at).toLocaleTimeString()}</span></div>
            </div>
            <p className="text-slate-400 text-xs pt-1">
              Phase 4 Telemetry streaming active over WebSocket at <code>/api/v1/telemetry/ws</code>.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Candidate Sessions List */}
      {sessionsList.length > 0 && (
        <Card className="border-slate-800 bg-slate-900/60">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base text-white">Your Interview Sessions</CardTitle>
              <span className="text-xs text-slate-500 font-mono">{sessionsList.length} session(s) in MongoDB</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-slate-800/80 text-xs font-mono">
              {sessionsList.map((sess) => (
                <div key={sess.id} className="py-2.5 flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <div className="text-white font-medium">
                      {sess.seniority} {sess.role}
                    </div>
                    <div className="text-slate-500 text-[11px]">
                      Session ID: {sess.id}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-slate-400">{sess.difficulty}</span>
                    <Badge variant={sess.status === 'CREATED' ? 'outline' : 'success'} className="text-[10px]">
                      {sess.status}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSetupSession(sess)}
                      className="h-7 px-2.5 text-xs text-indigo-300 border-indigo-800 hover:bg-indigo-950/60 gap-1 cursor-pointer"
                    >
                      <Video className="h-3 w-3" />
                      Configure & Start
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Security Barrier Sandbox Inspector */}
      <Card className="border-indigo-900/60 bg-indigo-950/20 backdrop-blur-md">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-indigo-400">
              <Key className="h-5 w-5" />
              <CardTitle className="text-lg">Security & Token Inspector Sandbox</CardTitle>
            </div>
            <Badge variant="outline" className="border-indigo-700/60 text-indigo-300 bg-indigo-950/40">
              Active Authorization Check
            </Badge>
          </div>
          <CardDescription className="text-slate-300">
            Verify candidate token authorization. Test accessing <code>/api/v1/auth/me</code> with Bearer token (expect 200 OK) or without token (expect 401 Unauthorized).
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                <Key className="h-3.5 w-3.5 text-indigo-400" />
                Active Access Token
              </span>
              <button
                type="button"
                onClick={copyToken}
                className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
              >
                {copiedToken ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-400" />
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    <span>Copy Token</span>
                  </>
                )}
              </button>
            </div>
            <div className="p-3 bg-slate-950/90 rounded-lg border border-slate-800 text-xs font-mono text-slate-400 break-all select-all">
              {token || 'No token active'}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              onClick={testWithToken}
              disabled={isTesting}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium gap-2 shadow-lg shadow-emerald-600/20"
            >
              <Send className="h-4 w-4" />
              Test With Token (Expect 200 OK)
            </Button>

            <Button
              variant="outline"
              onClick={testWithoutToken}
              disabled={isTesting}
              className="border-rose-800/80 text-rose-300 bg-rose-950/20 hover:bg-rose-900/40 gap-2"
            >
              <AlertTriangle className="h-4 w-4 text-rose-400" />
              Test Without Token (Confirm 401 Unauthorized)
            </Button>
          </div>

          {testResult && (
            <div className="space-y-2 animate-in fade-in">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 flex items-center gap-1.5">
                  {testResult.status === 200 ? (
                    <CheckCircle className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-rose-400" />
                  )}
                  <span className="font-medium text-white">{testResult.endpoint}</span>
                </span>
                <span className="text-slate-500 font-mono">Tested at {testResult.timestamp}</span>
              </div>

              <div
                className={`p-4 rounded-xl border text-xs font-mono overflow-x-auto ${
                  testResult.status === 200
                    ? 'bg-slate-950/90 border-emerald-900/60 text-emerald-300'
                    : 'bg-slate-950/90 border-rose-900/60 text-rose-300'
                }`}
              >
                <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2 font-semibold">
                  <span>HTTP Response Status:</span>
                  <span
                    className={`px-2 py-0.5 rounded text-xs ${
                      testResult.status === 200
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                        : 'bg-rose-950 text-rose-300 border border-rose-800'
                    }`}
                  >
                    {testResult.status} {testResult.status === 200 ? 'OK' : 'UNAUTHORIZED'}
                  </span>
                </div>
                <pre className="whitespace-pre-wrap">{JSON.stringify(testResult.data, null, 2)}</pre>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
