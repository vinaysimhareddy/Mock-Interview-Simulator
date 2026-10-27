import React, { useState } from 'react';
import { LogIn, UserPlus, Shield, Sparkles, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/context/AuthContext';

export default function AuthPage(): React.ReactElement {
  const { login, register, error, clearError, isLoading } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localValidation, setLocalValidation] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setLocalValidation(null);

    if (!email || !email.includes('@')) {
      setLocalValidation('Please enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setLocalValidation('Password must be at least 8 characters long.');
      return;
    }
    if (mode === 'register' && !fullName.trim()) {
      setLocalValidation('Please enter your full name.');
      return;
    }

    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(email, fullName, password);
      }
    } catch {
      // Error handled by AuthContext
    }
  };

  const fillDemoCandidate = () => {
    setEmail('candidate.alex@example.com');
    setFullName('Alex Mercer');
    setPassword('InterviewReady2026!');
    setLocalValidation(null);
    clearError();
  };

  return (
    <div className="w-full max-w-md mx-auto my-auto py-10 px-4">
      <Card className="border-slate-800 bg-slate-900/90 shadow-2xl backdrop-blur-xl">
        <CardHeader className="space-y-3 pb-6">
          <div className="flex items-center justify-between">
            <div className="p-2.5 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
              <Shield className="h-6 w-6" />
            </div>
            <Badge variant="outline" className="border-indigo-500/30 text-indigo-300 bg-indigo-950/40">
              Argon2id + JWT
            </Badge>
          </div>
          <div>
            <CardTitle className="text-2xl font-bold text-white tracking-tight">
              {mode === 'login' ? 'Candidate Sign In' : 'Create Candidate Account'}
            </CardTitle>
            <CardDescription className="text-slate-400 mt-1">
              {mode === 'login'
                ? 'Enter your credentials to access your mock interview dashboard'
                : 'Register to start live adaptive AI mock interviews'}
            </CardDescription>
          </div>

          <div className="grid grid-cols-2 p-1 bg-slate-950/60 rounded-lg border border-slate-800">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                clearError();
                setLocalValidation(null);
              }}
              className={`py-2 text-xs font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 ${
                mode === 'login'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <LogIn className="h-3.5 w-3.5" />
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                clearError();
                setLocalValidation(null);
              }}
              className={`py-2 text-xs font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 ${
                mode === 'register'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <UserPlus className="h-3.5 w-3.5" />
              Register
            </button>
          </div>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {(error || localValidation) && (
              <div className="p-3.5 rounded-lg bg-rose-950/60 border border-rose-800/80 text-rose-200 text-xs flex items-start gap-2.5 animate-in fade-in">
                <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{localValidation || error}</span>
              </div>
            )}

            {mode === 'register' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Full Name</label>
                <input
                  type="text"
                  placeholder="e.g. Alex Mercer"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  autoComplete="name"
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950/80 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  required
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">Email Address</label>
              <input
                type="email"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950/80 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Minimum 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  className="w-full px-3.5 py-2.5 pr-10 rounded-lg bg-slate-950/80 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg shadow-lg shadow-indigo-600/25 mt-2"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  Processing...
                </span>
              ) : mode === 'login' ? (
                'Sign In to Dashboard'
              ) : (
                'Create Candidate Account'
              )}
            </Button>

            <div className="pt-2 border-t border-slate-800/80">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={fillDemoCandidate}
                className="w-full text-xs text-indigo-300 border-dashed border-indigo-800/60 bg-indigo-950/20 hover:bg-indigo-900/30"
              >
                <Sparkles className="h-3.5 w-3.5 mr-1.5 text-indigo-400" />
                Fill Demo Candidate Credentials
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
