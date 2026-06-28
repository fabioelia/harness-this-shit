import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useInsights, useSchedule, useSetBudget, useGraph, useLeases, useSetDigest, useSendDigest, useLint, useAnomalies, useFailures, useHeatmap, useReleaseLease } from '@/lib/api';

const CARD = 'rounded-lg border border-line bg-surface p-[18px]';
const LABEL = 'font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-dim';
const fmtMs = (ms: number) => (ms ? (ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`) : '—');
const fmtN = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export function InsightsPage() {
  const [days, setDays] = useState(14);
  const { data: d } = useInsights(days);
  const { data: sched } = useSchedule(48);
  const setBudget = useSetBudget();
  const { data: graph } = useGraph();
  const { data: conc } = useLeases();
  const { data: lint } = useLint();
  const { data: anom } = useAnomalies(days);
  const { data: failures } = useFailures(7);
  const { data: heat } = useHeatmap(30);
  const releaseLease = useReleaseLease();
  const setDigest = useSetDigest();
  const sendDigest = useSendDigest();
  const [capDraft, setCapDraft] = useState('');
  const [digestCh, setDigestCh] = useState<string | null>(null);
  const [digestHr, setDigestHr] = useState<number | null>(null);
  const maxCost = Math.max(0.0001, ...(d?.daily ?? []).map((x) => x.cost));
  const maxRuns = Math.max(1, ...(d?.daily ?? []).map((x) => x.runs));

  const Stat = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div className={CARD}>
      <div className={`${LABEL} mb-2`}>{label}</div>
      <div className="font-display text-[24px] font-bold tracking-tight text-fg">{value}</div>
      {sub && <div className="mt-0.5 font-mono text-[11px] text-dim-2">{sub}</div>}
    </div>
  );

  return (
    <div className="font-sans text-fg animate-fade-up">
      <div className="border-b border-line-soft bg-head px-[26px] py-[22px]">
        <div className="mb-3 font-mono text-[12px] font-medium text-dim"><span className="text-brand">Switchboard</span> › Insights</div>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-display text-[23px] font-bold tracking-tight">Insights</div>
            <div className="mt-1 text-[13px] text-muted-2">Real spend, run volume, latency and failures — from captured run cost/turns/duration.</div>
          </div>
          <div className="flex items-center gap-2.5">
            <a href={`/api/report.md?days=${days}`} download className="h-[30px] rounded-md border border-line bg-surface-2 px-3 font-display text-[12px] font-semibold leading-[30px] text-t2 hover:border-hair">Report ↓</a>
            <div className="inline-flex overflow-hidden rounded-md border border-line text-[12px] font-semibold">
              {[7, 14, 30].map((n) => <button key={n} onClick={() => setDays(n)} className={`px-3 py-1.5 font-mono ${days === n ? 'bg-brand/15 text-brand-soft' : 'text-dim hover:text-t2'}`}>{n}d</button>)}
            </div>
          </div>
        </div>
      </div>

      <div className="px-[26px] py-[22px] pb-[26px]">
        {!d ? (
          <div className="font-mono text-[13px] text-dim">loading…</div>
        ) : (
          <>
            <div className={`${CARD} mb-[18px] flex flex-wrap items-center gap-3`} style={d.budget.over ? { borderColor: 'rgba(229,115,107,.4)' } : undefined}>
              <span className={`${LABEL}`}>Daily spend cap</span>
              {d.budget.cap > 0 ? (
                <span className="font-mono text-[12.5px]">
                  <span className={d.budget.over ? 'text-bad' : 'text-t2'}>${d.budget.today.toFixed(2)}</span>
                  <span className="text-dim"> / ${d.budget.cap.toFixed(2)} today</span>
                  {d.budget.over && <span className="ml-2 rounded bg-bad/15 px-1.5 py-0.5 text-[10px] font-semibold text-bad">DISPATCH PAUSED</span>}
                </span>
              ) : <span className="font-mono text-[12px] text-dim">no cap — runs dispatch unbounded</span>}
              <div className="ml-auto flex items-center gap-2">
                <span className="font-mono text-[12px] text-dim">$</span>
                <input value={capDraft} onChange={(e) => setCapDraft(e.target.value)} placeholder={d.budget.cap > 0 ? String(d.budget.cap) : '5.00'} className="h-8 w-24 rounded-md border border-line bg-surface-2 px-2.5 font-mono text-[12px] text-fg focus:border-brand/60 focus:outline-none" />
                <button onClick={() => setBudget.mutate(parseFloat(capDraft) || 0, { onSuccess: () => setCapDraft('') })} className="h-8 rounded-md border border-line bg-surface-2 px-3 font-display text-[12px] font-semibold text-t2 hover:border-hair">Set</button>
                {d.budget.cap > 0 && <button onClick={() => setBudget.mutate(0)} className="h-8 rounded-md border border-line bg-surface-2 px-3 font-display text-[12px] font-semibold text-dim hover:text-bad">Off</button>}
              </div>
            </div>

            <div className={`${CARD} mb-[18px] flex flex-wrap items-center gap-3`}>
              <span className={LABEL}>Daily digest</span>
              <input value={digestCh ?? d.digest.channel} onChange={(e) => setDigestCh(e.target.value)} placeholder="#ops or @fabio" className="h-8 w-40 rounded-md border border-line bg-surface-2 px-2.5 font-mono text-[12px] text-fg focus:border-brand/60 focus:outline-none" />
              <span className="font-mono text-[12px] text-dim">at</span>
              <input type="number" min={-1} max={23} value={digestHr ?? d.digest.hour} onChange={(e) => setDigestHr(+e.target.value)} className="h-8 w-16 rounded-md border border-line bg-surface-2 px-2.5 font-mono text-[12px] text-fg focus:border-brand/60 focus:outline-none" />
              <span className="font-mono text-[11px] text-dim-2">:00h ({d.digest.hour < 0 ? 'off' : `${d.digest.hour}:00 daily`})</span>
              <div className="ml-auto flex items-center gap-2">
                <button onClick={() => setDigest.mutate({ channel: digestCh ?? d.digest.channel, hour: digestHr ?? d.digest.hour }, { onSuccess: () => { setDigestCh(null); setDigestHr(null); } })} className="h-8 rounded-md border border-line bg-surface-2 px-3 font-display text-[12px] font-semibold text-t2 hover:border-hair">Save</button>
                <button onClick={() => sendDigest.mutate()} className="h-8 rounded-md border border-line bg-surface-2 px-3 font-display text-[12px] font-semibold text-brand-soft hover:border-hair">{sendDigest.isPending ? 'Sending…' : 'Send now'}</button>
              </div>
              {sendDigest.data && <div className="w-full font-mono text-[11px] text-dim-2">{sendDigest.data.sent ? 'sent · ' : 'no channel · '}{sendDigest.data.preview}</div>}
            </div>

            <div className="mb-[18px] grid grid-cols-2 gap-[14px] md:grid-cols-6">
              <Stat label={`Spend · ${days}d`} value={`$${d.totals.cost.toFixed(2)}`} sub={d.projection ? `≈ $${d.projection.monthly.toFixed(2)}/mo at this rate` : `${d.totals.runs} runs`} />
              <Stat label="Runs" value={fmtN(d.totals.runs)} sub={`${(d.totals.runs / days).toFixed(1)}/day`} />
              <Stat label="Model turns" value={fmtN(d.totals.turns)} sub={d.totals.runs ? `${(d.totals.turns / Math.max(1, d.totals.runs)).toFixed(1)}/run` : '—'} />
              <Stat label="Tokens" value={d.totals.inTok || d.totals.outTok ? fmtN(d.totals.inTok + d.totals.outTok) : '—'} sub={d.totals.inTok || d.totals.outTok ? `${fmtN(d.totals.inTok)} in · ${fmtN(d.totals.outTok)} out` : 'not captured'} />
              <Stat label="Avg latency" value={fmtMs(d.totals.avgMs)} />
              <Stat label="Failure rate" value={`${d.totals.failRate}%`} sub={`${d.totals.fails} failed`} />
            </div>

            {failures && failures.clusters.length > 0 && (
              <div className={`${CARD} mb-[18px]`} style={{ borderColor: 'rgba(229,115,107,.3)' }}>
                <div className="mb-2 font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-bad">Failure clusters · {failures.total} fails / 7d</div>
                <div className="flex flex-col gap-1.5">
                  {failures.clusters.map((c, i) => (
                    <div key={i} className="flex items-center gap-3 font-mono text-[12px]">
                      <span className="w-[34px] shrink-0 text-right font-semibold text-bad">{c.count}×</span>
                      <Link to={`/runs/${c.sampleRun}`} className="flex-1 truncate text-muted-2 hover:text-brand" title={c.signature}>{c.signature}</Link>
                      <span className="shrink-0 text-dim">{c.routines.slice(0, 2).join(', ')}{c.routines.length > 2 ? ` +${c.routines.length - 2}` : ''}</span>
                      <span className="w-[56px] shrink-0 text-right text-dim">{c.ago}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 font-mono text-[10.5px] text-dim-2">recent failures grouped by normalized error — fix the top signature to clear the most runs.</div>
              </div>
            )}

            {anom && anom.anomalies.length > 0 && (
              <div className={`${CARD} mb-[18px]`} style={{ borderColor: 'rgba(229,115,107,.35)' }}>
                <div className="mb-2 font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-bad">⚡ Cost anomalies · {anom.anomalies.length}</div>
                <div className="flex flex-col gap-1.5 font-mono text-[12px]">
                  {anom.anomalies.map((a) => (
                    <div key={a.id} className="flex items-center gap-3">
                      <Link to={`/runs/${a.id}`} className="w-[110px] shrink-0 truncate text-brand-soft hover:underline">{a.id}</Link>
                      <Link to={`/routines/${a.slug}`} className="flex-1 truncate font-sans font-semibold text-t2 hover:text-brand">{a.slug}</Link>
                      <span className="text-bad">${a.cost.toFixed(3)}</span>
                      <span className="w-[52px] shrink-0 text-right font-semibold text-bad">{a.x}×</span>
                      <span className="w-[70px] shrink-0 text-right text-dim">avg ${a.avg.toFixed(3)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 font-mono text-[10.5px] text-dim-2">runs that cost over 3× their routine's average — investigate runaway sessions or oversized payloads.</div>
              </div>
            )}

            {lint && lint.count > 0 && (
              <div className={`${CARD} mb-[18px]`} style={{ borderColor: 'rgba(230,176,82,.4)' }}>
                <div className="mb-2 font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-warn">⚠ Config warnings · {lint.count}</div>
                <div className="flex flex-col gap-1.5">
                  {lint.issues.map((it) => (
                    <div key={it.slug} className="font-mono text-[12px]">
                      <Link to={`/routines/${it.slug}`} className="font-sans font-semibold text-t2 hover:text-brand">{it.name}</Link>
                      <ul className="mt-0.5 ml-3 list-disc text-dim-2">{it.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {sched && sched.missed && sched.missed.length > 0 && (
              <div className={`${CARD} mb-[18px]`} style={{ borderColor: 'rgba(230,176,82,.4)' }}>
                <div className="mb-2 font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-warn">⚠ Missed scheduled runs · {sched.missed.length}</div>
                <div className="flex flex-col gap-1.5 font-mono text-[12px]">
                  {sched.missed.map((u, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Link to={`/routines/${u.slug}`} className="flex-1 truncate font-sans font-semibold text-t2 hover:text-brand">{u.name}</Link>
                      <span className="text-dim">{u.cron}</span>
                      <span className="text-warn">expected {u.ago}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 font-mono text-[10.5px] text-dim-2">A cron fire window passed with no run — the harness was down, paused, or the routine was disabled/snoozed.</div>
              </div>
            )}

            {sched && sched.upcoming.length > 0 && (
              <div className={`${CARD} mb-[18px]`}>
                <div className={`${LABEL} mb-3`}>Upcoming scheduled runs · next 48h</div>
                <div className="flex flex-col gap-1.5">
                  {sched.upcoming.slice(0, 8).map((u, i) => (
                    <div key={i} className="flex items-center gap-3 font-mono text-[12px]">
                      <span className="w-[120px] shrink-0 text-t2">{u.when}</span>
                      <span className="w-[60px] shrink-0 text-brand-soft">{u.in}</span>
                      <Link to={`/routines/${u.slug}`} className="flex-1 truncate font-sans font-semibold text-muted-2 hover:text-brand">{u.name}</Link>
                      <span className="shrink-0 text-dim">{u.cron}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className={`${CARD} mb-[18px]`}>
              <div className={`${LABEL} mb-4`}>Daily spend & runs · last {days} days</div>
              <div className="flex items-end gap-[3px]" style={{ height: 132 }}>
                {d.daily.map((x) => (
                  <div key={x.date} className="group relative flex flex-1 flex-col items-center justify-end gap-[3px]" title={`${x.date} · $${x.cost.toFixed(4)} · ${x.runs} runs · ${x.fails} failed`}>
                    <div className="w-full rounded-t-[2px] bg-brand/70 transition-colors group-hover:bg-brand" style={{ height: `${Math.max(x.cost > 0 ? 3 : 0, (x.cost / maxCost) * 100)}px` }} />
                    <div className="w-full rounded-b-[2px] bg-[var(--code-accent)] opacity-40" style={{ height: `${Math.max(x.runs > 0 ? 2 : 0, (x.runs / maxRuns) * 24)}px` }} />
                  </div>
                ))}
              </div>
              <div className="mt-2.5 flex items-center gap-4 font-mono text-[10.5px] text-dim-2">
                <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-brand/70" /> spend</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-[var(--code-accent)] opacity-40" /> runs</span>
                <span className="ml-auto">{d.daily[0]?.date} → {d.daily[d.daily.length - 1]?.date}</span>
              </div>
            </div>

            {conc && conc.leases && conc.pending && (conc.leases.length > 0 || conc.pending.length > 0) && (
              <div className={`${CARD} mb-[18px]`}>
                <div className={`${LABEL} mb-3`}>Concurrency · live</div>
                {conc.leases.length > 0 && (
                  <div className="mb-2 flex flex-col gap-1 font-mono text-[12px]">
                    {conc.leases.map((l, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-lease">🔒 {l.key}</span>
                        <Link to={`/runs/${l.runId}`} className="text-dim hover:text-brand">{l.runId}</Link>
                        {l.sha && <span className="text-dim-2">@{l.sha}</span>}
                        <span className="ml-auto text-dim">held {l.held} · ttl {l.ttl}</span>
                        <button onClick={() => releaseLease.mutate(l.key)} title="release this lease" className="text-dim hover:text-bad">release ×</button>
                      </div>
                    ))}
                  </div>
                )}
                {conc.pending.length > 0 && (
                  <div className="flex flex-col gap-1 font-mono text-[11.5px]">
                    {conc.pending.map((t, i) => (
                      <div key={i} className="flex items-center gap-2 text-dim-2"><span className="text-warn">📥 queued</span><Link to={`/routines/${t.slug}`} className="text-t2 hover:text-brand">{t.slug}</Link><span className="flex-1 truncate">{t.summary}</span><span className="text-dim">{t.ago}</span></div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {graph && graph.edges.length > 0 && (
              <div className={`${CARD} mb-[18px]`}>
                <div className={`${LABEL} mb-3`}>Routine flow · {graph.edges.length} edges</div>
                <div className="flex flex-col gap-1.5 font-mono text-[12px]">
                  {graph.edges.map((e, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Link to={`/routines/${e.from}`} className="text-t2 hover:text-brand">{e.fromName}</Link>
                      <span className={e.kind === 'reaction' ? 'text-lease' : 'text-brand-soft'}>{e.kind === 'reaction' ? `⚡ ${e.label}` : '↳ on success'} →</span>
                      {e.toExists ? <Link to={`/routines/${e.to}`} className="text-brand hover:underline">{e.toName}</Link> : <span className="text-bad" title="downstream routine does not exist">{e.to} (missing)</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {d.dispatch && Object.keys(d.dispatch).length > 0 && (
              <div className={`${CARD} mb-[18px]`}>
                <div className={`${LABEL} mb-3`}>Dispatch outcomes · {days}d</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(d.dispatch).sort((a, b) => b[1] - a[1]).map(([st, n]) => {
                    const tone = st === 'succeeded' ? 'text-ok border-ok/30' : st === 'failed' ? 'text-bad border-bad/30' : st === 'coalesced' || st === 'waiting' ? 'text-lease border-lease/30' : 'text-dim border-line';
                    return <span key={st} className={`rounded-md border px-2.5 py-1 font-mono text-[12px] ${tone}`}>{n} <span className="opacity-70">{st}</span></span>;
                  })}
                </div>
                <div className="mt-2 font-mono text-[10.5px] text-dim-2">every run outcome — admitted (succeeded/failed) vs stood-down (skipped/coalesced/waiting).</div>
              </div>
            )}

            {heat && heat.max > 1 && (
              <div className={`${CARD} mb-[18px]`}>
                <div className={`${LABEL} mb-3`}>Activity heatmap · runs by hour · last {heat.days}d</div>
                <div className="overflow-x-auto">
                  <div className="inline-flex flex-col gap-[3px]">
                    {heat.grid.map((row, dow) => (
                      <div key={dow} className="flex items-center gap-[3px]">
                        <span className="w-7 shrink-0 font-mono text-[9.5px] text-dim-2">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow]}</span>
                        {row.map((n, h) => (
                          <span key={h} title={`${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow]} ${h}:00 — ${n} run${n === 1 ? '' : 's'}`} className="h-3 w-3 rounded-[2px]" style={{ background: n ? `rgba(91,158,230,${0.18 + 0.82 * (n / heat.max)})` : 'var(--surface-2)' }} />
                        ))}
                      </div>
                    ))}
                    <div className="flex items-center gap-[3px]"><span className="w-7 shrink-0" />{Array.from({ length: 24 }, (_, h) => <span key={h} className="w-3 text-center font-mono text-[8px] text-dim-3">{h % 6 === 0 ? h : ''}</span>)}</div>
                  </div>
                </div>
              </div>
            )}

            {d.byTag && d.byTag.length > 0 && (
              <div className={`${CARD} mb-[18px]`}>
                <div className={`${LABEL} mb-3`}>Spend by tag</div>
                <div className="flex flex-col gap-2">
                  {d.byTag.map((t) => {
                    const share = d.totals.cost > 0 ? (t.cost / d.totals.cost) * 100 : 0;
                    return (
                      <div key={t.tag} className="flex items-center gap-3 font-mono text-[12px]">
                        <span className="w-[120px] shrink-0 truncate text-t2">#{t.tag}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-lease/70" style={{ width: `${Math.max(2, share)}%` }} /></div>
                        <span className="w-[64px] shrink-0 text-right text-t2">${t.cost.toFixed(2)}</span>
                        <span className="w-[44px] shrink-0 text-right text-dim">{t.runs}r</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {d.byModel && d.byModel.length > 0 && (
              <div className={`${CARD} mb-[18px]`}>
                <div className={`${LABEL} mb-3`}>Spend by model</div>
                <div className="flex flex-col gap-2">
                  {d.byModel.map((m) => {
                    const share = d.totals.cost > 0 ? (m.cost / d.totals.cost) * 100 : 0;
                    return (
                      <div key={m.model} className="flex items-center gap-3 font-mono text-[12px]">
                        <span className="w-[150px] shrink-0 truncate text-t2">{m.model.replace(/^claude-/, '')}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-brand/70" style={{ width: `${Math.max(2, share)}%` }} /></div>
                        <span className="w-[64px] shrink-0 text-right text-t2">${m.cost.toFixed(2)}</span>
                        <span className="w-[44px] shrink-0 text-right text-dim">{m.runs}r</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className={CARD}>
              <div className={`${LABEL} mb-3`}>By routine · {d.perRoutine.length} active</div>
              {d.perRoutine.length === 0 ? (
                <div className="font-mono text-[12px] text-dim">No finished runs in this window.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="border-b border-line-soft text-left font-display text-[10px] font-semibold uppercase tracking-[0.06em] text-dim-2">
                        <th className="pb-2 pr-3 font-medium">Routine</th>
                        <th className="pb-2 px-3 text-right font-medium">Runs</th>
                        <th className="pb-2 px-3 text-right font-medium">Spend</th>
                        <th className="pb-2 px-3 text-right font-medium">$/run</th>
                        <th className="pb-2 px-3 text-right font-medium">Turns</th>
                        <th className="pb-2 px-3 text-right font-medium">Avg latency</th>
                        <th className="pb-2 pl-3 text-right font-medium">Fail rate</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {d.perRoutine.map((p) => (
                        <tr key={p.slug} className="border-b border-line-soft last:border-0">
                          <td className="py-2 pr-3"><Link to={`/routines/${p.slug}`} className="font-sans font-semibold text-t2 hover:text-brand">{p.name}</Link></td>
                          <td className="py-2 px-3 text-right text-muted-2">{p.runs}</td>
                          <td className="py-2 px-3 text-right text-t2">${p.cost.toFixed(3)}</td>
                          <td className="py-2 px-3 text-right text-dim-2">${(p.cost / Math.max(1, p.runs)).toFixed(3)}</td>
                          <td className="py-2 px-3 text-right text-muted-2">{p.turns}</td>
                          <td className="py-2 px-3 text-right text-muted-2">{fmtMs(p.avgMs)}</td>
                          <td className="py-2 pl-3 text-right"><span className={p.failRate > 0 ? 'text-bad' : 'text-dim'}>{p.failRate}%</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
