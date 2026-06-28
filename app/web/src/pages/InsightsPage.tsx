import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useInsights } from '@/lib/api';

const CARD = 'rounded-lg border border-line bg-surface p-[18px]';
const LABEL = 'font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-dim';
const fmtMs = (ms: number) => (ms ? (ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`) : '—');
const fmtN = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export function InsightsPage() {
  const [days, setDays] = useState(14);
  const { data: d } = useInsights(days);
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
          <div className="inline-flex overflow-hidden rounded-md border border-line text-[12px] font-semibold">
            {[7, 14, 30].map((n) => <button key={n} onClick={() => setDays(n)} className={`px-3 py-1.5 font-mono ${days === n ? 'bg-brand/15 text-brand-soft' : 'text-dim hover:text-t2'}`}>{n}d</button>)}
          </div>
        </div>
      </div>

      <div className="px-[26px] py-[22px] pb-[26px]">
        {!d ? (
          <div className="font-mono text-[13px] text-dim">loading…</div>
        ) : (
          <>
            <div className="mb-[18px] grid grid-cols-2 gap-[14px] md:grid-cols-5">
              <Stat label={`Spend · ${days}d`} value={`$${d.totals.cost.toFixed(2)}`} sub={`${d.totals.runs} runs`} />
              <Stat label="Runs" value={fmtN(d.totals.runs)} sub={`${(d.totals.runs / days).toFixed(1)}/day`} />
              <Stat label="Model turns" value={fmtN(d.totals.turns)} sub={d.totals.runs ? `${(d.totals.turns / Math.max(1, d.totals.runs)).toFixed(1)}/run` : '—'} />
              <Stat label="Avg latency" value={fmtMs(d.totals.avgMs)} />
              <Stat label="Failure rate" value={`${d.totals.failRate}%`} sub={`${d.totals.fails} failed`} />
            </div>

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
