import React from 'react';
import {
  Server,
  Database,
  Monitor,
  Activity,
  CheckCircle2,
  Lock,
  LogOut,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { CameraStreamProvider } from '@/context/CameraStreamContext';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import AuthPage from '@/pages/AuthPage';
import DashboardPage from '@/pages/DashboardPage';
import { PreInterviewSetup } from '@/components/interview/PreInterviewSetup';

function PlatformContent(): React.ReactElement {
  const { user, logout, isLoading } = useAuth();
  const isDirectSetup = typeof window !== 'undefined' && window.location.search.includes('setup=true');

  if (isDirectSetup) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8">
        <PreInterviewSetup
          role="Full Stack Engineer"
          seniority="Senior"
          onStartInterview={(_config) => {
            console.log('Setup completed -> starting interview session');
          }}
          onCancel={() => {
            window.location.search = '';
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-indigo-500 selection:text-white">
      {/* Top Navigation */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="h-9 w-9 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-600/30">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <span className="font-bold text-lg text-white tracking-tight">Mock-Interview</span>
              <span className="text-xs text-indigo-400 font-mono ml-2 font-medium px-2 py-0.5 rounded bg-indigo-950 border border-indigo-800">
                Simulator
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <Badge variant="success" className="gap-1.5 py-1 px-3">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Live Telemetry & Adaptive AI Active
            </Badge>

            {user && (
              <div className="flex items-center gap-3 pl-3 border-l border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-full bg-indigo-600/30 border border-indigo-500/50 flex items-center justify-center text-xs text-indigo-300 font-semibold">
                    {user.full_name.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-xs font-medium text-slate-300 hidden sm:inline">
                    {user.full_name}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={logout}
                  className="h-8 px-2 text-slate-400 hover:text-white"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-10">
        {/* Render Dashboard if authenticated, else Auth Page */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex items-center gap-3 text-slate-400 text-sm">
              <span className="h-5 w-5 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
              Verifying session token...
            </div>
          </div>
        ) : user ? (
          <DashboardPage />
        ) : (
          <div className="space-y-8">
            <div className="text-center space-y-3 max-w-2xl mx-auto">
              <Badge variant="outline" className="border-indigo-500/40 text-indigo-300 bg-indigo-950/40">
                Phase 2 Security Verification
              </Badge>
              <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
                Candidate Authentication Portal
              </h1>
              <p className="text-sm text-slate-400">
                Register a candidate or sign in to test Argon2id password hashing, JWT Bearer token generation, and role-based endpoint protection.
              </p>
            </div>
            <AuthPage />
          </div>
        )}

        {/* System Architecture Grid */}
        <section className="space-y-4 pt-6 border-t border-slate-800/80">
          <h2 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2">
            <Server className="h-5 w-5 text-indigo-400" />
            Core Architecture & Service Registry
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="border-slate-800 bg-slate-900/60 hover:border-slate-700 transition-colors">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="p-2.5 rounded-lg bg-indigo-950/80 border border-indigo-800/60 text-indigo-400">
                    <Lock className="h-5 w-5" />
                  </div>
                  <Badge variant="success">Argon2id + JWT</Badge>
                </div>
                <CardTitle className="text-lg mt-3">Auth & Security Layer</CardTitle>
                <CardDescription>
                  RFC 7519 PyJWT access tokens, Argon2id cryptographic password hashing, and strict HTTP Bearer dependency.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-xs font-mono text-slate-400">
                <div className="flex justify-between py-1 border-b border-slate-800/80">
                  <span>Register:</span>
                  <span className="text-slate-200">POST /api/v1/auth/register</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/80">
                  <span>Login:</span>
                  <span className="text-slate-200">POST /api/v1/auth/login</span>
                </div>
                <div className="flex justify-between py-1">
                  <span>Protected:</span>
                  <span className="text-emerald-400">GET /api/v1/auth/me (200 / 401)</span>
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-800 bg-slate-900/60 hover:border-slate-700 transition-colors">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="p-2.5 rounded-lg bg-indigo-950/80 border border-indigo-800/60 text-indigo-400">
                    <Database className="h-5 w-5" />
                  </div>
                  <Badge variant="success">Indexed</Badge>
                </div>
                <CardTitle className="text-lg mt-3">MongoDB Collections</CardTitle>
                <CardDescription>
                  Motor async driver with ping on startup. Collections: users, resumes, sessions, evaluations, telemetry_packets.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-xs font-mono text-slate-400">
                <div className="flex justify-between py-1 border-b border-slate-800/80">
                  <span>Unique Index:</span>
                  <span className="text-slate-200">users (email: 1)</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/80">
                  <span>Compound Index:</span>
                  <span className="text-slate-200">telemetry (session + ts)</span>
                </div>
                <div className="flex justify-between py-1">
                  <span>State:</span>
                  <span className="text-emerald-400">Initialized & Verified</span>
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-800 bg-slate-900/60 hover:border-slate-700 transition-colors">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="p-2.5 rounded-lg bg-indigo-950/80 border border-indigo-800/60 text-indigo-400">
                    <Monitor className="h-5 w-5" />
                  </div>
                  <Badge variant="success">Active</Badge>
                </div>
                <CardTitle className="text-lg mt-3">Frontend Client</CardTitle>
                <CardDescription>
                  React 18 + TypeScript strict SPA. AuthContext with automatic Bearer token interceptor and sandbox tester.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-xs font-mono text-slate-400">
                <div className="flex justify-between py-1 border-b border-slate-800/80">
                  <span>Token Storage:</span>
                  <span className="text-slate-200">LocalStorage access_token</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/80">
                  <span>Interceptor:</span>
                  <span className="text-emerald-400">Authorization: Bearer ...</span>
                </div>
                <div className="flex justify-between py-1">
                  <span>Status:</span>
                  <span className="text-indigo-300">Phase 2 Verified</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-900/40 py-6 text-center text-xs text-slate-500">
        Mock-interview simulator • Privacy-First MediaPipe CV • LangGraph Adaptive Engine • Multi-Dimensional Scoring
      </footer>
    </div>
  );
}

export default function App(): React.ReactElement {
  return (
    <ErrorBoundary fallbackTitle="Application Error Encountered">
      <AuthProvider>
        <CameraStreamProvider>
          <PlatformContent />
        </CameraStreamProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

