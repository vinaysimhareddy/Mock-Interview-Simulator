import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  className?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
}

export function Tooltip({
  content,
  children,
  className = '',
  side = 'top',
}: TooltipProps): React.ReactElement {
  const [isVisible, setIsVisible] = React.useState<boolean>(false);

  const sideClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  }[side];

  return (
    <div
      className="relative inline-flex items-center"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
      onFocus={() => setIsVisible(true)}
      onBlur={() => setIsVisible(false)}
    >
      {children}
      {isVisible && (
        <div
          role="tooltip"
          className={cn(
            'absolute z-50 px-2.5 py-1.5 text-[11px] font-medium text-slate-100 bg-slate-900 border border-slate-700/80 rounded-lg shadow-xl pointer-events-none whitespace-normal max-w-xs animate-in fade-in zoom-in-95 duration-150',
            sideClasses,
            className
          )}
        >
          {content}
        </div>
      )}
    </div>
  );
}

