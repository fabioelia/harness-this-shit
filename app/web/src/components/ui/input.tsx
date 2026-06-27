import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded-md border border-line bg-surface px-3 text-sm text-fg placeholder:text-muted-2',
        'focus-visible:outline-none focus-visible:border-brand/60 focus-visible:ring-2 focus-visible:ring-brand/20 transition-colors',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';
