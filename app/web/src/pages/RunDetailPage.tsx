import { Link, useNavigate, useParams } from 'react-router-dom';
import { useRun, useDispatchRoutine } from '@/lib/api';
import { Pill, Dot, Empty, stateMeta } from '@/components/sb';

const CARD = 'rounded-lg border border-line bg-surface p-[18px]';
const LABEL = 'font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-dim';

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
              <span className={LABEL}>Output · claude -p stdout</span>
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
              <span className={LABEL}>Execution timeline</span>
              <span className="font-mono text-[10.5px] font-medium text-dim">secrets redacted</span>
            </div>
            <div className="flex flex-col">
              {r.timeline.map((ev, i) => (
                <div key={i} className="flex items-start gap-[11px] border-b border-line-soft py-[9px] last:border-0">
                  <span className="mt-0.5 w-9 shrink-0 font-mono text-[11px] font-medium text-dim-3">{ev.t}</span>
                  <span className="mt-[5px] shrink-0"><Dot color={ev.dot} size={8} /></span>
                  <span className="mt-px w-[64px] shrink-0 rounded-[4px] border border-white/[0.08] bg-white/[0.045] py-0.5 text-center font-mono text-[9.5px] font-semibold uppercase tracking-[0.05em] text-muted-2">{ev.tag}</span>
                  <span className="flex-1 font-sans text-[12.5px] font-medium leading-[1.45] text-t2">{ev.text}</span>
                </div>
              ))}
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
              {[['Result', r.summary.result, 'sans'], ['Trigger', r.trigger, 'mono'], ['Elapsed', r.elapsed, 'mono'], ['Surface', r.summary.surface, 'mono']].map(([k, v, f]) => (
                <div key={k as string} className="min-w-0">
                  <div className="mb-[3px] font-display text-[10px] font-medium uppercase tracking-[0.06em] text-dim-2">{k}</div>
                  <div className={`truncate text-[12.5px] font-semibold text-t2 ${f === 'mono' ? 'font-mono' : 'font-sans'}`}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          {r.sinksResult && r.sinksResult.length > 0 && (
            <div className={CARD}>
              <div className={`${LABEL} mb-3`}>Output delivery</div>
              <div className="flex flex-col gap-2.5">
                {r.sinksResult.map((s, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <Dot color={s.ok ? '#5fbf86' : '#e6b052'} size={7} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12px] font-semibold text-t2">{s.type}</span>
                        {s.target && <span className="font-mono text-[11px] text-dim">{s.target}</span>}
                      </div>
                      <div className="font-mono text-[11px] leading-snug text-muted-2">{s.detail}</div>
                    </div>
                    <span className={`shrink-0 font-mono text-[10.5px] font-semibold ${s.ok ? 'text-ok' : 'text-warn'}`}>{s.ok ? 'delivered' : 'skipped'}</span>
                  </div>
                ))}
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
