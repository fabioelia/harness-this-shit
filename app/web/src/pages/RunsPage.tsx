import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useRuns, useRunSearch } from '@/lib/api';
import { Dot, Empty, stateMeta } from '@/components/sb';
import { cn } from '@/lib/utils';

const GRID = { display: 'grid', gridTemplateColumns: '16px 110px minmax(0,1.4fr) minmax(0,1fr) 90px 80px', alignItems: 'center', gap: 14 } as const;
const STATUS_GROUPS: Record<string, string[]> = {
  ok: ['succeeded', 'success'], failed: ['failed', 'failing'], running: ['running', 'waiting'],
  skipped: ['skipped', 'coalesced', 'canceled'],
};

export function RunsPage() {
  const { data: runs } = useRuns();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [oq, setOq] = useState('');
  const { data: outHits } = useRunSearch(oq);
  const filtered = (runs ?? []).filter((r) => {
    if (status !== 'all' && !STATUS_GROUPS[status]?.includes(r.status)) return false;
    if (q.trim() && !`${r.routineName} ${r.id} ${r.trigger}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  return (
    <div className="font-sans text-fg animate-fade-up">
      <div className="border-b border-line-soft bg-head px-[26px] py-[22px]">
        <div className="mb-3 font-mono text-[12px] font-medium text-dim"><span className="text-brand">Switchboard</span> › Runs</div>
        <div className="font-display text-[23px] font-bold tracking-tight">Runs</div>
        <div className="mt-1 text-[13px] text-muted-2">Every execution across the fleet — status, trigger, and how long it took.</div>
      </div>
      <div className="px-[26px] py-5 pb-[26px]">
        <div className="mb-3">
          <input value={oq} onChange={(e) => setOq(e.target.value)} placeholder="🔎 search inside run outputs across all history…" className="h-9 w-full rounded-md border border-line bg-surface-2 px-3 font-mono text-[12px] text-fg focus:border-brand/60 focus:outline-none" />
          {oq.trim().length >= 2 && outHits && (
            <div className="mt-2 overflow-hidden rounded-lg border border-brand/30 bg-surface">
              <div className="border-b border-line-soft bg-surface-2 px-3.5 py-2 font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-dim-2">{outHits.results.length} output match{outHits.results.length === 1 ? '' : 'es'}</div>
              {outHits.results.length === 0 && <div className="px-3.5 py-3 font-mono text-[12px] text-dim">no run output contains “{oq}”.</div>}
              {outHits.results.map((h) => (
                <Link key={h.id} to={`/runs/${h.id}`} className="flex items-start gap-3 border-b border-line-soft px-3.5 py-2 last:border-0 hover:bg-white/[0.015]">
                  <Dot state={h.status} size={8} />
                  <span className="w-[150px] shrink-0 font-mono text-[11.5px] text-t2">{h.slug}</span>
                  <span className="flex-1 font-mono text-[11.5px] text-dim-2">{h.snippet}</span>
                  <span className="shrink-0 font-mono text-[11px] text-dim">{h.ago}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2.5">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search routine, run id, trigger…" className="h-9 min-w-[240px] flex-1 rounded-md border border-line bg-surface-2 px-3 font-mono text-[12px] text-fg focus:border-brand/60 focus:outline-none" />
          <span className="inline-flex overflow-hidden rounded-md border border-line text-[11.5px] font-semibold">
            {[['all', 'all'], ['ok', 'succeeded'], ['failed', 'failed'], ['running', 'running'], ['skipped', 'stood down']].map(([v, l]) => (
              <button key={v} onClick={() => setStatus(v)} className={cn('px-2.5 py-1.5 font-mono', status === v ? 'bg-brand/15 text-brand-soft' : 'text-dim hover:text-t2')}>{l}</button>
            ))}
          </span>
          <span className="font-mono text-[11.5px] text-dim">{filtered.length} of {runs?.length ?? 0}</span>
        </div>
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="border-b border-line bg-surface-2 px-[18px] py-[11px] font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-dim-2" style={GRID}>
            <div /><div>Run</div><div>Routine</div><div>Trigger</div><div>Duration</div><div className="text-right">When</div>
          </div>
          {runs && runs.length === 0 && <Empty title="No runs yet" hint="Runs appear here the moment a routine fires — on a schedule, a GitHub event, or a manual dispatch." />}
          {runs && runs.length > 0 && filtered.length === 0 && <div className="px-[18px] py-6 text-center font-mono text-[12px] text-dim">no runs match</div>}
          {filtered.map((r) => (
            <Link key={r.id} to={`/runs/${r.id}`} className="border-b border-line-soft px-[18px] py-3 last:border-0 hover:bg-white/[0.015]" style={GRID}>
              <Dot state={r.status} size={8} />
              <span className="font-mono text-[12px] font-semibold text-t2">{r.id}</span>
              <span className="truncate font-display text-[13px] font-medium text-fg-2">{r.routineName}</span>
              <span className="truncate font-mono text-[11.5px] font-medium text-dim">{r.trigger}</span>
              <span className="font-mono text-[12px] font-medium text-muted-2">{r.dur}</span>
              <span className="text-right font-mono text-[11.5px] font-medium" style={{ color: stateMeta(r.status).color }}>{r.ago}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
