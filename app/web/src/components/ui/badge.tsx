import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none transition-colors',
  {
    variants: {
      tone: {
        neutral: 'border-line bg-surface-2 text-muted',
        brand: 'border-brand/30 bg-brand/10 text-brand-soft',
        ok: 'border-ok/25 bg-ok/10 text-ok',
        run: 'border-run/25 bg-run/10 text-run',
        warn: 'border-warn/25 bg-warn/10 text-warn',
        bad: 'border-bad/25 bg-bad/10 text-bad',
        outline: 'border-line bg-transparent text-muted',
      },
    },
    defaultVariants: { tone: 'neutral' },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, tone, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ tone }), className)} {...props} />
  )
);
Badge.displayName = 'Badge';
