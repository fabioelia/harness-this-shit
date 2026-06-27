import { Link, useNavigate, useParams } from 'react-router-dom';
import { useRun, useDispatchRoutine } from '@/lib/api';
import { Pill, Dot, Empty, stateMeta } from '@/components/sb';

const CARD = 'rounded-lg border border-line bg-surface p-[18px]';
const LABEL = 'font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-dim';

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
  if (isLoading) return <div className="px-6 py-10 text-muted">Loading…</div>;
  if (!r) return <div className="px-[26px] py-10"><Empty title="Run not found" hint={<Link className="text-brand" to="/runs">Back to Runs ›</Link>} /></div>;
  const m = stateMeta(r.status);
  const running = r.status === 'running';
  const ok = r.status === 'succeeded';

  return (
    <div className="font-sans text-fg animate-fade-up">
      <div className="border-b border-line-soft bg-head px-[26px] py-[22px]">
        <div className="mb-3 font-mono text-[12px] font-medium text-dim"><Link to="/runs" className="text-brand">Runs</Link> › {r.id}</div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="font-mono text-[22px] font-bold tracking-tight">{r.id}</span>
            <Pill label={m.label} color={m.color} />
          </div>
          <button
            onClick={() => dispatch.mutate(r.routine, { onSuccess: (res) => navigate(`/runs/${res.runId}`) })}
            disabled={dispatch.isPending}
            className="flex h-[34px] items-center gap-[7px] rounded-md border border-line bg-surface-2 px-3.5 font-display text-[12.5px] font-semibold text-t2 transition-colors hover:border-hair disabled:opacity-40"
          >
            <svg width="13" height="13" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 9a6 6 0 1 1 1.8 4.3" /><path d="M3 13v-3h3" /></svg>
            {dispatch.isPending ? 'Re-running…' : 'Re-run'}
          </button>
        </div>
        <div className="mt-[11px] flex flex-wrap items-center gap-3.5 font-mono text-[12px] font-medium text-muted-2">
          <span>routine <Link to={`/routines/${r.routine}`} className="text-brand">{r.routine}</Link></span>
          <span className="text-hair">|</span><span>trigger {r.trigger}</span>
          <span className="text-hair">|</span><span>started {r.started}</span>
          <span className="text-hair">|</span><span>elapsed {r.elapsed}</span>
          <span className="text-hair">|</span><span>model {r.model}</span>
        </div>
      </div>

      <div className="grid gap-[22px] px-[26px] py-[22px] pb-[26px]" style={{ gridTemplateColumns: 'minmax(0,1.7fr) minmax(0,1fr)' }}>
        {/* LEFT */}
        <div className="flex min-w-0 flex-col gap-[18px]">
          {/* Output — the real claude -p stdout */}
          <div className="rounded-lg border bg-surface p-[18px]" style={{ borderColor: ok ? 'rgba(95,191,134,.3)' : running ? '#2b2620' : 'rgba(229,115,107,.3)' }}>
            <div className="mb-3 flex items-center justify-between">
              <span className={LABEL}>Output · session result</span>
              <Pill label={m.label} color={m.color} />
            </div>
            {running ? (
              <div className="flex items-center gap-2.5 rounded-md border border-line-soft bg-code px-4 py-4 font-mono text-[12.5px] text-muted-2">
                <Dot color="#5b9ee6" size={8} pulse /> a headless Claude instance is running…
              </div>
            ) : (
              <pre className="overflow-auto rounded-md border border-line-soft bg-code px-4 py-3.5 font-mono text-[13px] leading-[1.6]" style={{ color: ok ? '#e9e3d7' : '#e5736b' }}>
                {r.stdout || '(no output)'}
              </pre>
            )}
          </div>

          <div className={CARD}>
            <div className="mb-3.5 flex items-center justify-between">
              <span className={LABEL}>Trace · {r.trace.length} steps{r.cost != null ? ` · $${Number(r.cost).toFixed(4)}` : ''}</span>
              <span className="font-mono text-[10.5px] font-medium text-dim">secrets redacted</span>
            </div>
            <div className="flex flex-col">
              <div className="flex items-start gap-[11px] border-b border-line-soft py-[9px]">
                <span className="mt-0.5 w-9 shrink-0 font-mono text-[11px] font-medium text-dim-3">0:00</span>
                <span className="mt-[5px] shrink-0"><Dot color="#5fbf86" size={8} /></span>
                <span className="mt-px w-[80px] shrink-0 rounded-[4px] border border-white/[0.08] bg-white/[0.045] py-0.5 text-center font-mono text-[9.5px] font-semibold uppercase tracking-[0.04em] text-muted-2">dispatch</span>
                <span className="flex-1 font-sans text-[12.5px] font-medium leading-[1.45] text-t2">Dispatcher admitted run · trigger {r.trigger}</span>
              </div>
              {r.trace.length === 0 && !running && <div className="py-2.5 font-mono text-[12px] text-dim">no steps captured</div>}
              {r.trace.map((e) => {
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
