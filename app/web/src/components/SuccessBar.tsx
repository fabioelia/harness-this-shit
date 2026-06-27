import { cn } from '@/lib/utils';
import { percent } from '@/lib/format';

/** A compact success-rate meter — green when healthy, amber/red as it degrades. */
export function SuccessBar({ rate, runs, className }: { rate: number; runs?: number; className?: string }) {
  const tone = rate >= 0.9 ? 'bg-ok' : rate >= 0.75 ? 'bg-warn' : 'bg-bad';
  const text = rate >= 0.9 ? 'text-ok' : rate >= 0.75 ? 'text-warn' : 'text-bad';
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
        <div className={cn('h-full rounded-full transition-all', tone)} style={{ width: `${Math.round(rate * 100)}%` }} />
      </div>
      <span className={cn('tabular w-8 text-xs font-medium', text)}>{percent(rate)}</span>
      {runs != null && <span className="tabular text-[11px] text-muted-2">{runs} runs</span>}
    </div>
  );
}
