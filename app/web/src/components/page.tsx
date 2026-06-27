import * as React from 'react';
import { cn } from '@/lib/utils';

export function Page({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mx-auto w-full max-w-[1320px] px-6 py-6 animate-fade-up', className)} {...props} />;
}

export function PageHeader({
  title,
  eyebrow,
  subtitle,
  actions,
}: {
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-2">{eyebrow}</div>
        )}
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-2', className)}>
      {children}
    </div>
  );
}
