import { useState } from 'react';
import { useActivity } from '@/lib/api';
import { Dot, Empty } from '@/components/sb';
import { cn } from '@/lib/utils';

const STATE_GROUPS: Record<string, string[]> = { success: ['success'], failing: ['failing'], idle: ['idle'], queued: ['queued'] };

export function ActivityPage() {
  const { data: activity } = useActivity();
  const [q, setQ] = useState('');
  const [state, setState] = useState('all');
  const filtered = (activity ?? []).filter((a) => {
    if (state !== 'all' && !STATE_GROUPS[state]?.includes(a.state)) return false;
    if (q.trim() && !a.text.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  return (
    <div className="font-sans text-fg animate-fade-up">
      <div className="border-b border-line-soft bg-head px-[26px] py-[22px]">
        <div className="mb-3 font-mono text-[12px] font-medium text-dim"><span className="text-brand">Switchboard</span> › Activity</div>
        <div className="font-display text-[23px] font-bold tracking-tight">Activity</div>
        <div className="mt-1 text-[13px] text-muted-2">The live event log — runs that fired, and dispatch decisions (skips, kill-switch drops).</div>
      </div>
      <div className="mx-auto max-w-[860px] px-[26px] py-6">
        <div className="mb-3 flex flex-wrap items-center gap-2.5">
          <Dot color="#5fbf86" size={8} pulse />
          <span className="font-display text-[11px] font-semibold uppercase tracking-[0.1em] text-t2">Live activity</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="filter…" className="h-8 min-w-[180px] flex-1 rounded-md border border-line bg-surface-2 px-2.5 font-mono text-[12px] text-fg focus:border-brand/60 focus:outline-none" />
          <span className="inline-flex overflow-hidden rounded-md border border-line text-[11px] font-semibold">
            {[['all', 'all'], ['success', 'ran'], ['failing', 'failed'], ['idle', 'skips'], ['queued', 'queued']].map(([v, l]) => (
              <button key={v} onClick={() => setState(v)} className={cn('px-2 py-1 font-mono', state === v ? 'bg-brand/15 text-brand-soft' : 'text-dim hover:text-t2')}>{l}</button>
            ))}
          </span>
        </div>
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          {activity && activity.length === 0 && <Empty title="No activity yet" hint="Runs, dispatch decisions, skips, and reaction watches land here as they happen." />}
          {activity && activity.length > 0 && filtered.length === 0 && <div className="px-[18px] py-6 text-center font-mono text-[12px] text-dim">nothing matches</div>}
          {filtered.map((a, i) => (
            <div key={i} className="flex items-start gap-3 border-b border-line-soft px-[18px] py-[13px] last:border-0">
              <span className="mt-1 shrink-0"><Dot state={a.state} size={8} /></span>
              <div className="min-w-0 flex-1">
                <div className="font-sans text-[12.5px] font-medium leading-[1.4] text-t2">{a.text}</div>
                <div className="mt-0.5 font-mono text-[10.5px] font-medium text-dim-3">{a.time}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
