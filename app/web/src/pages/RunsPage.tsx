import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useRuns, useRunSearch, useRerunFailed, useTriage, useReviewQueue, useBookmarks, useAssignRun } from '@/lib/api';
import { useOperator } from '@/lib/operator';
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
  const [oqDays, setOqDays] = useState(0);
  const { data: outHits } = useRunSearch(oq, oqDays);
  const rerunFailed = useRerunFailed();
  const { data: triage } = useTriage();
  const { data: review } = useReviewQueue();
  const { data: bookmarks } = useBookmarks();
  const assign = useAssignRun();
  const [operator] = useOperator();
  const failedCount = (runs ?? []).filter((r) => r.status === 'failed').length;
  const filtered = (runs ?? []).filter((r) => {
    if (status !== 'all' && !STATUS_GROUPS[status]?.includes(r.status)) return false;
    if (q.trim() && !`${r.routineName} ${r.id} ${r.trigger}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  return (
    <div className="font-sans text-fg animate-fade-up">
      <div className="border-b border-line-soft bg-head px-[26px] py-[22px]">
        <div className="mb-3 font-mono text-[12px] font-medium text-dim"><span className="text-brand">Switchboard</span> › Runs</div>
        <div className="flex items-center justify-between">
          <div className="font-display text-[23px] font-bold tracking-tight">Runs</div>
          <div className="flex items-center gap-2.5">
            {failedCount > 0 && <button onClick={() => { if (confirm(`Re-run failed runs from the last 24h (up to 25)?`)) rerunFailed.mutate(24); }} disabled={rerunFailed.isPending} className="flex h-9 items-center gap-2 rounded-md border border-warn/40 bg-warn/10 px-3.5 font-display text-[12.5px] font-semibold text-warn hover:bg-warn/20 disabled:opacity-40">{rerunFailed.isPending ? 'Re-running…' : rerunFailed.data ? `Re-ran ${rerunFailed.data.rerun}` : '↻ Re-run failed'}</button>}
            <a href="/api/runs.csv" download className="flex h-9 items-center gap-2 rounded-md border border-line bg-surface-2 px-3.5 font-display text-[12.5px] font-semibold text-t2 hover:border-hair">Export CSV ↓</a>
          </div>
        </div>
        <div className="mt-1 text-[13px] text-muted-2">Every execution across the fleet — status, trigger, and how long it took.</div>
      </div>
      <div className="px-[26px] py-5 pb-[26px]">
        {bookmarks && bookmarks.bookmarks.length > 0 && (
          <div className="mb-4 overflow-hidden rounded-xl border border-brand/30 bg-brand/[0.04]">
            <div className="border-b border-line-soft px-4 py-2 font-display text-[11px] font-semibold uppercase tracking-[0.07em] text-brand-soft">★ Saved runs · {bookmarks.bookmarks.length}</div>
            {bookmarks.bookmarks.slice(0, 6).map((b) => (
              <Link key={b.id} to={`/runs/${b.id}`} className="flex items-center gap-3 border-b border-line-soft px-4 py-1.5 last:border-0 font-mono text-[11.5px] hover:bg-white/[0.015]">
                <span className="w-[130px] shrink-0 truncate text-t2">{b.slug}</span>
                <span className="flex-1 truncate text-dim-2">{b.label || b.id}</span>
                <span className="shrink-0 text-dim">{b.by} · {b.ago}</span>
              </Link>
            ))}
          </div>
        )}
        {review && review.total > 0 && (
          <div className="mb-4 overflow-hidden rounded-xl border border-line bg-surface">
            <div className="flex items-center gap-3 border-b border-line-soft px-4 py-2">
              <span className="font-display text-[11px] font-semibold uppercase tracking-[0.07em] text-dim-2">Sign-off coverage · 7d</span>
              <div className="h-2 w-32 overflow-hidden rounded-full bg-surface-2"><div className={`h-full rounded-full ${review.coverage >= 70 ? 'bg-ok/70' : review.coverage >= 30 ? 'bg-warn/70' : 'bg-bad/70'}`} style={{ width: `${review.coverage}%` }} /></div>
              <span className="font-mono text-[12px] text-t2">{review.coverage}%</span>
              <span className="font-mono text-[11px] text-dim">{review.reviewed}/{review.total} reviewed · {review.pending.length} awaiting</span>
            </div>
            {review.pending.slice(0, 5).map((p) => (
              <Link key={p.id} to={`/runs/${p.id}`} className="flex items-center gap-3 border-b border-line-soft px-4 py-1.5 last:border-0 font-mono text-[11.5px] hover:bg-white/[0.015]">
                <span className="shrink-0 text-dim-2">awaiting sign-off</span><span className="w-[140px] shrink-0 truncate text-t2">{p.slug}</span><span className="flex-1 truncate text-dim">{p.id}</span><span className="shrink-0 text-dim">{p.ago}</span>
              </Link>
            ))}
          </div>
        )}
        {triage && triage.items.length > 0 && (
          <div className="mb-4 overflow-hidden rounded-xl border border-bad/30 bg-bad/[0.04]">
            <div className="border-b border-line-soft px-4 py-2 font-display text-[11px] font-semibold uppercase tracking-[0.07em] text-bad">Triage queue · {triage.items.length} unresolved</div>
            {triage.items.slice(0, 8).map((t) => (
              <div key={t.id} className="flex items-center gap-3 border-b border-line-soft px-4 py-2 last:border-0 font-mono text-[11.5px] hover:bg-white/[0.015]">
                <span className={`shrink-0 rounded px-1.5 py-px text-[10px] font-semibold ${t.triage === 'investigating' ? 'bg-warn/15 text-warn' : 'bg-bad/15 text-bad'}`}>{t.triage}</span>
                <Link to={`/runs/${t.id}`} className="w-[130px] shrink-0 truncate text-t2 hover:text-brand">{t.slug}</Link>
                <Link to={`/runs/${t.id}`} className="flex-1 truncate text-dim-2 hover:text-t2">{t.summary}</Link>
                <span className="shrink-0 text-brand-soft">{t.assignee || 'unassigned'}</span>
                <button onClick={() => assign.mutate({ id: t.id, assignee: operator || 'anon', triage: 'investigating' })} title="assign to me + investigating" className="shrink-0 rounded border border-line px-1.5 text-[10px] text-dim hover:text-brand-soft">→ me</button>
                <button onClick={() => assign.mutate({ id: t.id, assignee: t.assignee, triage: 'resolved' })} title="mark resolved" className="shrink-0 rounded border border-ok/40 px-1.5 text-[10px] text-ok hover:bg-ok/10">resolve</button>
                <span className="w-[52px] shrink-0 text-right text-dim">{t.ago}</span>
              </div>
            ))}
          </div>
        )}
        <div className="mb-3">
          <div className="flex items-center gap-2">
            <input value={oq} onChange={(e) => setOq(e.target.value)} placeholder="🔎 search inside run outputs…" className="h-9 flex-1 rounded-md border border-line bg-surface-2 px-3 font-mono text-[12px] text-fg focus:border-brand/60 focus:outline-none" />
            <span className="inline-flex shrink-0 overflow-hidden rounded-md border border-line text-[11px] font-semibold">
              {[[0, 'all'], [7, '7d'], [30, '30d']].map(([v, l]) => <button key={v} onClick={() => setOqDays(v as number)} className={`px-2.5 py-2 font-mono ${oqDays === v ? 'bg-brand/15 text-brand-soft' : 'text-dim hover:text-t2'}`}>{l}</button>)}
            </span>
          </div>
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
