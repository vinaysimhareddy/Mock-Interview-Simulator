import React from 'react';
import { ShieldAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export interface PermissionHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PermissionHelpModal({
  isOpen,
  onClose,
}: PermissionHelpModalProps): React.ReactElement | null {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
      <Card className="w-full max-w-md border-slate-800 bg-slate-900 shadow-2xl">
        <CardHeader className="pb-3 border-b border-slate-800 flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-indigo-400" />
            <CardTitle className="text-base text-white">How to Enable Camera & Mic</CardTitle>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0 text-slate-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>

        <CardContent className="pt-4 space-y-4 text-xs text-slate-300">
          <div className="space-y-2">
            <h4 className="font-semibold text-white flex items-center gap-1.5">
              <span>1. Click the Lock Icon in the Address Bar</span>
            </h4>
            <p className="text-slate-400 leading-relaxed pl-4">
              Look at the left side of your browser address bar (where the URL begins). Click the <strong>lock</strong> or <strong>tune/settings</strong> icon.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold text-white flex items-center gap-1.5">
              <span>2. Allow Camera & Microphone Permissions</span>
            </h4>
            <p className="text-slate-400 leading-relaxed pl-4">
              Toggle <strong>Camera</strong> and <strong>Microphone</strong> switches to <strong>Allow</strong> (or &quot;Ask&quot;).
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold text-white flex items-center gap-1.5">
              <span>3. Check for Competing Applications</span>
            </h4>
            <p className="text-slate-400 leading-relaxed pl-4">
              Ensure apps like Zoom, Microsoft Teams, OBS Studio, or Discord are not locking your webcam exclusively.
            </p>
          </div>

          <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
            <span className="text-[11px] text-slate-500">Local privacy: No video is ever stored.</span>
            <Button
              size="sm"
              onClick={onClose}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs"
            >
              Got it, Retry Camera
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
