import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error caught by ErrorBoundary:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="w-full max-w-xl mx-auto my-12 p-6 rounded-2xl bg-rose-950/30 border border-rose-800/60 backdrop-blur-md shadow-2xl text-center space-y-4">
          <div className="h-12 w-12 rounded-full bg-rose-600/20 border border-rose-500/40 text-rose-400 flex items-center justify-center mx-auto">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white tracking-tight">
              {this.props.fallbackTitle || 'A component error occurred'}
            </h3>
            <p className="text-xs text-rose-300/80 mt-1">
              {this.state.error?.message || 'An unexpected error interrupted the view.'}
            </p>
          </div>
          <div className="flex items-center justify-center gap-3 pt-2">
            <Button
              size="sm"
              variant="outline"
              onClick={this.handleReset}
              className="border-rose-800 text-rose-300 hover:bg-rose-900/40"
            >
              Try Again
            </Button>
            <Button
              size="sm"
              onClick={this.handleReload}
              className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reload Page
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
