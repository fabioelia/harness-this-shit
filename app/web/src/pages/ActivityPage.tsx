import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useActivity, useMentions, useInbox, useGlobalAudit, useStandup } from '@/lib/api';
import { Dot, Empty } from '@/components/sb';
import { cn } from '@/lib/utils';
import { useOperator } from '@/lib/operator';

const STATE_GROUPS: Record<string, string[]> = { success: ['success'], failing: ['failing'], idle: ['idle'], queued: ['queued'] };

export function ActivityPage() {
  const { data: activity } = useActivity();
  const { data: mentions } = useMentions();
  const [operator] = useOperator();
  const { data: inbox } = useInbox(operator);
  const { data: audit } = useGlobalAudit();
  const { data: standup } = useStandup(1);
  const [showAudit, setShowAudit] = useState(false);
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
        {operator && inbox && inbox.count > 0 && (
          <div className="mb-5 overflow-hidden rounded-xl border border-ok/30 bg-ok/[0.04]">
            <div className="border-b border-line-soft px-4 py-2 font-display text-[11px] font-semibold uppercase tracking-[0.07em] text-ok">For you, {operator} · {inbox.count}</div>
            {inbox.assigned.map((a) => (
              <Link key={a.id} to={`/runs/${a.id}`} className="flex items-center gap-3 border-b border-line-soft px-4 py-2 last:border-0 font-mono text-[11.5px] hover:bg-white/[0.015]">
                <span className="shrink-0 rounded bg-bad/15 px-1.5 py-px text-[10px] font-semibold text-bad">assigned · {a.triage}</span>
                <span className="flex-1 truncate text-t2">{a.slug} · {a.id}</span><span className="shrink-0 text-dim">{a.ago}</span>
              </Link>
            ))}
            {inbox.mentions.map((mn, i) => (
              <Link key={'m' + i} to={`/routines/${mn.slug}`} className="flex items-center gap-3 border-b border-line-soft px-4 py-2 last:border-0 font-mono text-[11.5px] hover:bg-white/[0.015]">
                <span className="shrink-0 rounded bg-brand/15 px-1.5 py-px text-[10px] font-semibold text-brand-soft">mention</span>
                <span className="text-dim">{mn.by} on {mn.slug}:</span><span className="flex-1 truncate text-dim-2">“{mn.snippet}”</span><span className="shrink-0 text-dim">{mn.ago}</span>
              </Link>
            ))}
          </div>
        )}
        {standup && Object.values(standup.counts).some((n) => n > 0) && (
          <div className="mb-5 rounded-xl border border-line bg-surface px-4 py-3">
            <div className="mb-2 font-display text-[11px] font-semibold uppercase tracking-[0.07em] text-dim-2">Team standup · last 24h</div>
            <div className="flex flex-wrap gap-4 font-mono text-[12px]">
              {([['changes', 'edits'], ['approvals', 'approvals'], ['comments', 'comments'], ['signoffs', 'sign-offs'], ['resolved', 'incidents resolved']] as const).map(([k, label]) => (
                <span key={k} className="text-dim-2"><span className="font-semibold text-t2">{standup.counts[k]}</span> {label}</span>
              ))}
            </div>
          </div>
        )}
        {audit && audit.entries.length > 0 && (
          <div className="mb-5 overflow-hidden rounded-xl border border-line bg-surface">
            <button onClick={() => setShowAudit((v) => !v)} className="flex w-full items-center justify-between px-4 py-2 font-display text-[11px] font-semibold uppercase tracking-[0.07em] text-dim-2 hover:text-t2"><span>Change log · all routines</span><span className="font-mono">{showAudit ? '▾' : '▸'}</span></button>
            {showAudit && audit.entries.slice(0, 30).map((e, i) => (
              <Link key={i} to={`/routines/${e.slug}`} className="flex items-center gap-3 border-t border-line-soft px-4 py-1.5 font-mono text-[11.5px] hover:bg-white/[0.015]">
                <span className="w-[130px] shrink-0 truncate text-brand-soft">{e.slug}</span>
                <span className="flex-1 truncate text-t2">{e.summary}</span>
                <span className="shrink-0 text-dim">{e.ago}</span>
              </Link>
            ))}
          </div>
        )}
        {mentions && mentions.mentions.length > 0 && (
          <div className="mb-5 overflow-hidden rounded-xl border border-brand/30 bg-brand/[0.04]">
            <div className="border-b border-line-soft px-4 py-2 font-display text-[11px] font-semibold uppercase tracking-[0.07em] text-brand-soft">@ Mentions</div>
            {mentions.mentions.slice(0, 6).map((mn, i) => (
              <Link key={i} to={`/routines/${mn.slug}`} className="flex items-start gap-2 border-b border-line-soft px-4 py-2 last:border-0 font-mono text-[11.5px] hover:bg-white/[0.015]">
                <span className="shrink-0 font-semibold text-brand-soft">@{mn.mentioned}</span>
                <span className="text-dim">by {mn.by} on {mn.slug}</span>
                <span className="flex-1 truncate text-dim-2">“{mn.snippet}”</span>
                <span className="shrink-0 text-dim">{mn.ago}</span>
              </Link>
            ))}
          </div>
        )}
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
