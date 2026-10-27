import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-indigo-600 text-white shadow hover:bg-indigo-700',
        secondary:
          'border-transparent bg-slate-800 text-slate-200 hover:bg-slate-700',
        destructive:
          'border-transparent bg-rose-600 text-white shadow hover:bg-rose-700',
        outline:
          'border-slate-700 text-slate-300',
        success:
          'border-transparent bg-emerald-600/20 text-emerald-300 border-emerald-500/30',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
