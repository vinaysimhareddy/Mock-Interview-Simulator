import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  onCheckedChange?: (checked: boolean) => void;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, defaultChecked, onChange, onCheckedChange, id, disabled, ...props }, ref) => {
    const isControlled = checked !== undefined;
    const [internalChecked, setInternalChecked] = React.useState<boolean>(
      Boolean(defaultChecked)
    );

    const isChecked = isControlled ? Boolean(checked) : internalChecked;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!isControlled) {
        setInternalChecked(e.target.checked);
      }
      onChange?.(e);
      onCheckedChange?.(e.target.checked);
    };

    return (
      <div className="relative inline-flex items-center">
        <input
          type="checkbox"
          id={id}
          ref={ref}
          checked={isChecked}
          disabled={disabled}
          onChange={handleChange}
          className="peer sr-only"
          {...props}
        />
        <label
          htmlFor={id}
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-slate-600 bg-slate-900 transition-colors',
            'hover:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2',
            'peer-checked:bg-indigo-600 peer-checked:border-indigo-600 peer-checked:text-white',
            'peer-disabled:cursor-not-allowed peer-disabled:opacity-50 cursor-pointer',
            className
          )}
        >
          {isChecked && <Check className="h-3.5 w-3.5 stroke-[3]" />}
        </label>
      </div>
    );
  }
);
Checkbox.displayName = 'Checkbox';

