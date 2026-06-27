import { Activity, Cable, HandHelping, Radio, ShieldCheck, CircleDollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import { money, percent } from '@/lib/format';
import type { Stats } from '@/types';

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  icon: typeof Activity;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: 'neutral' | 'ok' | 'run' | 'warn' | 'bad' | 'brand';
}) {
  const accent = {
    neutral: 'text-muted-2',
    ok: 'text-ok',
    run: 'text-run',
    warn: 'text-warn',
    bad: 'text-bad',
    brand: 'text-brand-soft',
  }[tone];
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3 shadow-card">
      <div className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-2', accent)}>
        <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="tabular font-display text-xl font-semibold leading-none text-fg">{value}</span>
          {sub && <span className="text-[11px] text-muted-2">{sub}</span>}
        </div>
        <div className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-2">{label}</div>
      </div>
    </div>
  );
}

export function StatStrip({ stats }: { stats?: Stats }) {
  const running = stats?.byState.running ?? 0;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <Stat icon={Radio} label="Running now" value={running} tone={running ? 'run' : 'neutral'} sub="live" />
      <Stat
        icon={HandHelping}
        label="Needs human"
        value={stats?.needsHuman ?? 0}
        tone={stats?.needsHuman ? 'warn' : 'neutral'}
      />
      <Stat
        icon={Activity}
        label="Runs today"
        value={stats?.runsToday ?? 0}
        tone="neutral"
        sub={stats?.failedToday ? `${stats.failedToday} failed` : 'all clear'}
      />
      <Stat
        icon={ShieldCheck}
        label="Avg success"
        value={stats ? percent(stats.avgSuccess) : '—'}
        tone={stats && stats.avgSuccess >= 0.9 ? 'ok' : 'warn'}
      />
      <Stat icon={Cable} label="Active leases" value={stats?.activeLeases ?? 0} tone="brand" sub={`${stats?.watching ?? 0} PRs watched`} />
      <Stat icon={CircleDollarSign} label="Spend today" value={money(stats?.spendToday)} tone="neutral" />
    </div>
  );
}
