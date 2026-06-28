import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useRun, useDispatchRoutine, useReplayRun, useRunDiff } from '@/lib/api';
import { Pill, Dot, Empty, stateMeta } from '@/components/sb';
import { cn } from '@/lib/utils';

const CARD = 'rounded-lg border border-line bg-surface p-[18px]';
const LABEL = 'font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-dim';

// LCS line diff: marks each line common / added / removed.
function lineDiff(a: string, b: string): { sign: ' ' | '-' | '+'; text: string }[] {
  const A = a.split('\n'), B = b.split('\n');
  const m = A.length, n = B.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { sign: ' ' | '-' | '+'; text: string }[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (A[i] === B[j]) { out.push({ sign: ' ', text: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ sign: '-', text: A[i] }); i++; }
    else { out.push({ sign: '+', text: B[j] }); j++; }
  }
  while (i < m) out.push({ sign: '-', text: A[i++] });
  while (j < n) out.push({ sign: '+', text: B[j++] });
  return out;
}

function DiffCard({ runId }: { runId: string }) {
  const [open, setOpen] = useState(false);
  const { data } = useRunDiff(runId, open);
  return (
    <div className={CARD}>
      <button onClick={() => setOpen((v) => !v)} className={`${LABEL} flex w-full items-center justify-between hover:text-t2`}>
        <span>Diff vs previous run</span><span className="font-mono text-dim">{open ? '▾' : '▸'}</span>
      </button>
      {open && data && (
        !data.previous ? <div className="mt-3 font-mono text-[12px] text-dim">no earlier run of this routine to compare.</div> : (
          <div className="mt-3">
            <div className="mb-2 flex flex-wrap gap-3 font-mono text-[11px] text-dim-2">
              <span>prev <Link to={`/runs/${data.previous.id}`} className="text-brand-soft">{data.previous.id}</Link> · {data.previous.ago}</span>
              {data.previous.cost != null && data.current?.cost != null && <span>Δcost ${(data.current.cost - data.previous.cost).toFixed(4)}</span>}
              {data.previous.turns != null && data.current?.turns != null && <span>Δturns {data.current.turns - data.previous.turns}</span>}
            </div>
            <pre className="max-h-[320px] overflow-auto rounded-md bg-code px-3 py-2 font-mono text-[11px] leading-[1.55]">
              {lineDiff(data.previous.output, data.current?.output || '').map((l, i) => (
                <div key={i} className={l.sign === '+' ? 'text-ok' : l.sign === '-' ? 'text-bad' : 'text-dim-2'}>{l.sign} {l.text || ' '}</div>
              ))}
            </pre>
          </div>
        )
      )}
    </div>
  );
}

type TE = { seq: number; t: string; type: string; tool: string | null; ok: number | null; text: string; truncated: boolean };
const dotForTrace = (e: TE) => e.type === 'tool_use' ? '#e6b052' : e.type === 'system' ? '#7f8a80' : e.type === 'text' ? '#5b9ee6' : (e.ok === 0 ? '#e5736b' : '#5fbf86');
const sline = (e: TE): string => {
  const d = e.text ?? '';
  if (e.type === 'system') { try { const o = JSON.parse(d); return `session · ${o.model} · ${(o.tools || []).length} tools`; } catch { return 'session start'; } }
  if (e.type === 'text') return d.replace(/\s+/g, ' ').slice(0, 150);
  if (e.type === 'tool_use') { let inp = d; try { const o = JSON.parse(d); inp = o.command || o.url || o.pattern || JSON.stringify(o); } catch { /* raw */ } return String(inp).replace(/\s+/g, ' ').slice(0, 130); }
  if (e.type === 'tool_result') return `${e.ok ? 'ok' : 'error'} · ${String(d).replace(/\s+/g, ' ').slice(0, 130)}`;
  if (e.type === 'result') { try { const o = JSON.parse(d); return `done · ${o.num_turns} turns · $${Number(o.total_cost_usd || 0).toFixed(4)}`; } catch { return 'done'; } }
  return e.type;
};
const pretty = (e: TE): string => { try { return JSON.stringify(JSON.parse(e.text), null, 2); } catch { return e.text; } };

export function RunDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: r, isLoading } = useRun(id);
  const dispatch = useDispatchRoutine();
  const replay = useReplayRun();
  const qc = useQueryClient();
  // Live trace over SSE — fills in with no polling lag, then refetches on done.
  const [liveTrace, setLiveTrace] = useState<TE[]>([]);
  const [tQ, setTQ] = useState('');
  const [tType, setTType] = useState('all');
  useEffect(() => {
    if (!id) return;
    setLiveTrace([]);
    const es = new EventSource(`/api/runs/${id}/stream`);
    es.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.kind === 'event') setLiveTrace((p) => (p.some((e) => e.seq === m.event.seq) ? p : [...p, m.event]));
      else if (m.kind === 'done') { es.close(); qc.invalidateQueries({ queryKey: ['run', id] }); }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [id, qc]);
  if (isLoading) return <div className="px-6 py-10 text-muted">Loading…</div>;
  if (!r) return <div className="px-[26px] py-10"><Empty title="Run not found" hint={<Link className="text-brand" to="/runs">Back to Runs ›</Link>} /></div>;
  const m = stateMeta(r.status);
  const running = r.status === 'running';
  const ok = r.status === 'succeeded';
  // Prefer the live stream whenever it's ahead of the last polled snapshot.
  const trace = liveTrace.length > r.trace.length ? liveTrace : r.trace;
  const shownTrace = trace.filter((e) => {
    if (tType === 'tools' ? !(e.type === 'tool_use' || e.type === 'tool_result') : tType !== 'all' && e.type !== tType) return false;
    if (tQ.trim() && !`${e.tool || ''} ${e.text || ''} ${e.type}`.toLowerCase().includes(tQ.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="font-sans text-fg animate-fade-up">
      <div className="border-b border-line-soft bg-head px-[26px] py-[22px]">
        <div className="mb-3 font-mono text-[12px] font-medium text-dim"><Link to="/runs" className="text-brand">Runs</Link> › {r.id}</div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="font-mono text-[22px] font-bold tracking-tight">{r.id}</span>
            <Pill label={m.label} color={m.color} />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => replay.mutate(r.id, { onSuccess: (res) => navigate(`/runs/${res.runId}`) })}
              disabled={replay.isPending}
              title="Re-run with this run's exact original event payload (reproducible)"
              className="flex h-[34px] items-center gap-[7px] rounded-md border border-brand/50 bg-brand/10 px-3.5 font-display text-[12.5px] font-semibold text-brand-soft transition-colors hover:bg-brand/20 disabled:opacity-40"
            >
              <svg width="13" height="13" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 9a6 6 0 1 1 1.8 4.3" /><path d="M3 13v-3h3" /></svg>
              {replay.isPending ? 'Replaying…' : 'Replay'}
            </button>
            <button
              onClick={() => dispatch.mutate(r.routine, { onSuccess: (res) => navigate(`/runs/${res.runId}`) })}
              disabled={dispatch.isPending}
              title="Run the routine fresh (new manual event)"
              className="flex h-[34px] items-center rounded-md border border-line bg-surface-2 px-3.5 font-display text-[12.5px] font-semibold text-t2 transition-colors hover:border-hair disabled:opacity-40"
            >
              {dispatch.isPending ? 'Running…' : 'Re-run'}
            </button>
          </div>
        </div>
        <div className="mt-[11px] flex flex-wrap items-center gap-3.5 font-mono text-[12px] font-medium text-muted-2">
          <span>routine <Link to={`/routines/${r.routine}`} className="text-brand">{r.routine}</Link></span>
          <span className="text-hair">|</span>
          <span className={r.triggerKind === 'reaction' ? 'text-lease' : r.triggerKind === 'chain' || r.triggerKind === 'replay' ? 'text-brand-soft' : ''}>
            {r.triggerKind === 'reaction' ? '⚡ reaction · ' : r.triggerKind === 'chain' ? '↳ chained · ' : r.triggerKind === 'replay' ? '⟲ replay of ' : 'trigger '}{r.trigger.replace(/^(after|reaction|replay) · /, '')}
          </span>
          {r.lineage?.triggeredBy && <span className="text-muted-2">from <Link to={`/runs/${r.lineage.triggeredBy.runId}`} className="text-brand">{r.lineage.triggeredBy.routine}</Link></span>}
          <span className="text-hair">|</span><span>started {r.started}</span>
          <span className="text-hair">|</span><span>elapsed {r.elapsed}</span>
          <span className="text-hair">|</span><span>model {r.model}</span>
        </div>
      </div>

      <div className="grid gap-[22px] px-[26px] py-[22px] pb-[26px]" style={{ gridTemplateColumns: 'minmax(0,1.7fr) minmax(0,1fr)' }}>
        {/* LEFT */}
        <div className="flex min-w-0 flex-col gap-[18px]">
          {/* Output — the real claude -p stdout */}
          <div className="rounded-lg border bg-surface p-[18px]" style={{ borderColor: ok ? 'rgba(95,191,134,.3)' : running ? 'var(--line)' : 'rgba(229,115,107,.3)' }}>
            <div className="mb-3 flex items-center justify-between">
              <span className={LABEL}>Output · session result</span>
              <Pill label={m.label} color={m.color} />
            </div>
            {running ? (
              <div className="flex items-center gap-2.5 rounded-md border border-line-soft bg-code px-4 py-4 font-mono text-[12.5px] text-muted-2">
                <Dot color="#5b9ee6" size={8} pulse /> a headless Claude instance is running…
              </div>
            ) : (
              <pre className="overflow-auto rounded-md border border-line-soft bg-code px-4 py-3.5 font-mono text-[13px] leading-[1.6]" style={{ color: ok ? 'var(--fg)' : '#e5736b' }}>
                {r.stdout || '(no output)'}
              </pre>
            )}
          </div>

          <div className={CARD}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className={LABEL}>Trace · {shownTrace.length === trace.length ? trace.length : `${shownTrace.length}/${trace.length}`} steps{r.cost != null ? ` · $${Number(r.cost).toFixed(4)}` : ''}</span>
              {trace.length > 4 && (<>
                <input value={tQ} onChange={(e) => setTQ(e.target.value)} placeholder="filter steps…" className="h-7 min-w-[120px] flex-1 rounded-md border border-line bg-surface-2 px-2 font-mono text-[11px] text-fg focus:border-brand/60 focus:outline-none" />
                <span className="inline-flex overflow-hidden rounded-md border border-line text-[10.5px] font-semibold">
                  {[['all','all'],['tools','tools'],['text','text'],['result','result']].map(([v,l]) => <button key={v} onClick={() => setTType(v)} className={cn('px-1.5 py-1 font-mono', tType===v ? 'bg-brand/15 text-brand-soft':'text-dim hover:text-t2')}>{l}</button>)}
                </span>
              </>)}
              <span className="font-mono text-[10.5px] font-medium text-dim">secrets redacted</span>
            </div>
            <div className="flex flex-col">
              <div className="flex items-start gap-[11px] border-b border-line-soft py-[9px]">
                <span className="mt-0.5 w-9 shrink-0 font-mono text-[11px] font-medium text-dim-3">0:00</span>
                <span className="mt-[5px] shrink-0"><Dot color="#5fbf86" size={8} /></span>
                <span className="mt-px w-[80px] shrink-0 rounded-[4px] border border-white/[0.08] bg-white/[0.045] py-0.5 text-center font-mono text-[9.5px] font-semibold uppercase tracking-[0.04em] text-muted-2">dispatch</span>
                <span className="flex-1 font-sans text-[12.5px] font-medium leading-[1.45] text-t2">Dispatcher admitted run · trigger {r.trigger}</span>
              </div>
              {trace.length === 0 && !running && <div className="py-2.5 font-mono text-[12px] text-dim">no steps captured</div>}
              {shownTrace.map((e) => {
                const hasBody = !!e.text && ['tool_use', 'tool_result', 'text', 'system', 'result'].includes(e.type);
                return (
                  <div key={e.seq} className="flex items-start gap-[11px] border-b border-line-soft py-[9px] last:border-0">
                    <span className="mt-0.5 w-9 shrink-0 font-mono text-[11px] font-medium text-dim-3">{e.t}</span>
                    <span className="mt-[5px] shrink-0"><Dot color={dotForTrace(e)} size={8} /></span>
                    <span className="mt-px w-[80px] shrink-0 truncate rounded-[4px] border border-white/[0.08] bg-white/[0.045] py-0.5 text-center font-mono text-[9.5px] font-semibold uppercase tracking-[0.04em] text-muted-2">{e.tool || e.type}</span>
                    <div className="min-w-0 flex-1">
                      <span className="block break-words font-sans text-[12.5px] font-medium leading-[1.45] text-t2">{sline(e)}</span>
                      {hasBody && (
                        <details className="mt-1 group">
                          <summary className="cursor-pointer list-none font-mono text-[10.5px] text-dim hover:text-brand">▸ view{e.truncated ? ' (truncated)' : ''}</summary>
                          <pre className="mt-1 max-h-[260px] overflow-auto rounded border border-line-soft bg-code px-2.5 py-2 font-mono text-[11px] leading-[1.5] text-muted">{pretty(e)}</pre>
                        </details>
                      )}
                    </div>
                  </div>
                );
              })}
              {r.awaiting && (
                <div className="flex items-center gap-[11px] pt-[11px]">
                  <span className="w-9 shrink-0 font-mono text-[11px] font-medium text-dim-3">{r.elapsed}</span>
                  <Dot color="#5b9ee6" size={8} pulse />
                  <span className="flex-1 font-sans text-[12.5px] font-medium italic text-muted-2">{r.awaiting}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT */}
        <div className="flex min-w-0 flex-col gap-[18px]">
          <div className={CARD}>
            <div className={`${LABEL} mb-3.5`}>Run</div>
            <div className="grid grid-cols-2 gap-x-[18px] gap-y-[13px]">
              {[['Result', r.summary.result, 'sans'], ['Trigger', r.trigger, 'mono'], ['Elapsed', r.elapsed, 'mono'], ['Cost', r.cost != null ? `$${Number(r.cost).toFixed(4)}` : '—', 'mono'], ['Turns', r.turns != null ? String(r.turns) : '—', 'mono'], ['Tools', r.summary.surface, 'mono']].map(([k, v, f]) => (
                <div key={k as string} className="min-w-0">
                  <div className="mb-[3px] font-display text-[10px] font-medium uppercase tracking-[0.06em] text-dim-2">{k}</div>
                  <div className={`truncate text-[12.5px] font-semibold text-t2 ${f === 'mono' ? 'font-mono' : 'font-sans'}`}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          {r.assertResult && (
            <div className={CARD} style={{ borderColor: r.assertResult.passed ? 'rgba(95,191,134,.3)' : 'rgba(229,115,107,.3)' }}>
              <div className="mb-3 flex items-center justify-between">
                <span className={LABEL}>Assertions</span>
                <span className={`rounded-full border px-2 py-0.5 font-display text-[10px] font-semibold ${r.assertResult.passed ? 'border-ok/30 bg-ok/10 text-ok' : 'border-bad/30 bg-bad/10 text-bad'}`}>{r.assertResult.passed ? 'all passed' : `${r.assertResult.results.filter((x) => !x.ok).length} failed`}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {r.assertResult.results.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 font-mono text-[11.5px]">
                    <span className={a.ok ? 'text-ok' : 'text-bad'}>{a.ok ? '✓' : '✗'}</span>
                    <span className="text-dim-2">{a.type}{a.value ? ` ${a.value}` : ''}</span>
                    <span className="ml-auto text-dim">{a.detail}</span>
                  </div>
                ))}
              </div>
              {!r.assertResult.passed && <div className="mt-2 text-[11px] text-dim-2">Failed assertions gated this run's chains and reactions.</div>}
            </div>
          )}
          {r.inbox.length > 0 && (
            <div className={CARD}>
              <div className={`${LABEL} mb-3`}>Inbox · also on its plate <span className="font-mono lowercase tracking-normal text-dim">{r.inbox.length} coalesced</span></div>
              <div className="flex flex-col gap-1.5">
                {r.inbox.map((t, i) => (
                  <div key={i} className="flex items-center gap-2 font-mono text-[11.5px]">
                    <Dot color={t.pending ? '#e6b052' : '#5fbf86'} size={7} pulse={t.pending} />
                    <span className="flex-1 truncate text-t2">{t.summary}</span>
                    <span className="shrink-0 text-dim">{t.pending ? 'pending' : 'picked up'} · {t.ago}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-[11px] text-dim-2">Events coalesced onto this run instead of spawning another agent. The agent drains these via <span className="font-mono">inbox</span> before finishing.</div>
            </div>
          )}
          <DiffCard runId={r.id} />
          {(r.lineage.triggeredBy || r.lineage.downstream.length > 0 || r.lineage.watches.length > 0) && (
            <div className={CARD}>
              <div className={`${LABEL} mb-3`}>Lineage · follow the work</div>
              <div className="flex flex-col gap-3">
                {r.lineage.triggeredBy && (
                  <div>
                    <div className="mb-1.5 font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-dim-2">Triggered by</div>
                    <Link to={`/runs/${r.lineage.triggeredBy.runId}`} className="flex items-center gap-2 font-mono text-[12px] hover:opacity-80">
                      <span className="text-faint">↑</span>
                      <span className={r.lineage.triggeredBy.kind === 'reaction' ? 'text-lease' : 'text-brand-soft'}>{r.lineage.triggeredBy.kind}</span>
                      <span className="flex-1 truncate text-t2">{r.lineage.triggeredBy.routine}</span>
                      <span className="shrink-0 text-dim">{r.lineage.triggeredBy.runId}</span>
                    </Link>
                  </div>
                )}
                {r.lineage.downstream.length > 0 && (
                  <div className={r.lineage.triggeredBy ? 'border-t border-line-soft pt-3' : ''}>
                    <div className="mb-1.5 font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-dim-2">Kicked off · {r.lineage.downstream.length}</div>
                    <div className="flex flex-col gap-1.5">
                      {r.lineage.downstream.map((d) => (
                        <Link key={d.runId} to={`/runs/${d.runId}`} className="flex items-center gap-2 font-mono text-[12px] hover:opacity-80">
                          <Dot state={d.status} size={7} />
                          <span className={d.kind === 'reaction' ? 'text-lease' : 'text-brand-soft'}>{d.kind === 'reaction' ? '⚡' : '↳'}</span>
                          <span className="flex-1 truncate text-brand">{d.routine}</span>
                          <span className="shrink-0 text-dim">{d.dur}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
                {r.lineage.watches.length > 0 && (
                  <div className="border-t border-line-soft pt-3">
                    <div className="mb-1.5 font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-dim-2">Watching · fires later</div>
                    <div className="flex flex-col gap-1.5">
                      {r.lineage.watches.map((w, i) => (
                        <div key={i} className="flex items-center gap-2 font-mono text-[11.5px]">
                          <Dot color={w.status === 'open' ? '#5b9ee6' : w.status === 'fired' ? '#5fbf86' : '#7f8a80'} size={7} pulse={w.status === 'open'} />
                          <span className="text-t2">{w.source}:{w.kind}{w.when ? `:${w.when}` : ''}</span>
                          <span className="text-faint">→</span>
                          <Link to={`/routines/${w.target}`} className="text-brand">{w.target}</Link>
                          <span className="ml-auto text-dim">{w.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className={CARD}>
            <div className={`${LABEL} mb-3`}>Trigger event payload</div>
            <pre className="max-h-[420px] overflow-auto rounded-md border border-line-soft bg-code px-3.5 py-3 font-mono text-[11.5px] leading-[1.55] text-muted">
              {r.event ? JSON.stringify(r.event, null, 2) : '—'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
