import { Link, useParams } from 'react-router-dom';
import { useRun } from '@/lib/api';
import { Pill, Dot, SIGNAL, stateMeta } from '@/components/sb';

const CARD = 'rounded-lg border border-line bg-surface p-[18px]';
const LABEL = 'font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-dim';

function CheckMark() {
  return (
    <span className="inline-flex shrink-0 items-center justify-center text-[11px] font-bold" style={{ width: 18, height: 18, borderRadius: '50%', background: '#5fbf8622', color: '#5fbf86' }}>✓</span>
  );
}

export function RunDetailPage() {
  const { id } = useParams();
  const { data: r } = useRun(id);
  if (!r) return <div className="px-6 py-10 text-muted">Loading…</div>;
  const m = stateMeta(r.status);

  return (
    <div className="font-sans text-fg animate-fade-up">
      <div className="border-b border-line-soft bg-head px-[26px] py-[22px]">
        <div className="mb-3 font-mono text-[12px] font-medium text-dim"><Link to="/runs" className="text-brand">Runs</Link> › {r.id}</div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="font-mono text-[22px] font-bold tracking-tight">{r.id}</span>
            <Pill label={m.label} color={m.color} />
          </div>
          <div className="flex items-center gap-[9px]">
            <button className="flex h-[34px] items-center rounded-md border border-line bg-surface-2 px-[13px] font-display text-[12.5px] font-semibold text-t2 hover:border-hair">Re-run</button>
            <button className="flex h-[34px] items-center rounded-md border border-bad/40 px-3.5 font-display text-[12.5px] font-semibold text-bad hover:bg-bad/10">Cancel run</button>
          </div>
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
          <div className={CARD}>
            <div className="mb-3.5 flex items-center justify-between">
              <span className={LABEL}>Execution timeline</span>
              <span className="font-mono text-[10.5px] font-medium text-dim">secrets redacted</span>
            </div>
            <div className="flex flex-col">
              {r.timeline.map((ev, i) => (
                <div key={i} className="flex items-start gap-[11px] border-b border-line-soft py-[9px]">
                  <span className="mt-0.5 w-9 shrink-0 font-mono text-[11px] font-medium text-dim-3">{ev.t}</span>
                  <span className="mt-[5px] shrink-0"><Dot color={ev.dot} size={8} /></span>
                  <span className="mt-px w-[60px] shrink-0 rounded-[4px] border border-white/[0.08] bg-white/[0.045] py-0.5 text-center font-mono text-[9.5px] font-semibold uppercase tracking-[0.05em] text-muted-2">{ev.tag}</span>
                  <span className="flex-1 font-sans text-[12.5px] font-medium leading-[1.45] text-t2">{ev.text}</span>
                </div>
              ))}
              {r.awaiting && (
                <div className="flex items-center gap-[11px] pb-0.5 pt-[11px]">
                  <span className="w-9 shrink-0 font-mono text-[11px] font-medium text-dim-3">{r.elapsed}</span>
                  <Dot color="#5b9ee6" size={8} pulse />
                  <span className="flex-1 font-sans text-[12.5px] font-medium italic text-muted-2">{r.awaiting}</span>
                </div>
              )}
            </div>
          </div>

          <div className={CARD}>
            <div className={`${LABEL} mb-3.5`}>Structured summary &amp; diff</div>
            <div className="mb-[15px] grid grid-cols-2 gap-x-[18px] gap-y-[11px]">
              {[['Result', r.summary.result, 'sans'], ['Iteration', r.summary.iteration, 'mono'], ['Commit', r.summary.commit, 'mono', true], ['Status surface', r.summary.surface, 'sans']].map(([k, v, f, accent]) => (
                <div key={k as string}>
                  <div className="mb-[3px] font-display text-[10px] font-medium uppercase tracking-[0.06em] text-dim-2">{k}</div>
                  <div className={`text-[12.5px] font-semibold ${f === 'mono' ? 'font-mono' : 'font-sans'}`} style={accent ? { color: '#5b9ee6' } : { color: '#cdc7ba' }}>{v}</div>
                </div>
              ))}
            </div>
            {r.diff && (
              <div className="rounded-md border border-line-soft bg-code px-3.5 py-3">
                <div className="flex items-center gap-2.5 font-mono text-[12px] font-medium">
                  <span className="text-t2">{r.diff.file}</span><span className="text-ok">{r.diff.add}</span><span className="text-bad">{r.diff.del}</span>
                  <span className="ml-auto text-dim-2">{r.diff.note}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT */}
        <div className="flex min-w-0 flex-col gap-[18px]">
          <div className="rounded-lg border bg-surface p-[18px]" style={{ borderColor: 'rgba(95,191,134,.28)' }}>
            <div className="mb-[5px] flex items-center justify-between">
              <span className={LABEL}>Dispatcher decision</span>
              <Pill label="Admitted" color={SIGNAL.success} />
            </div>
            <div className="mb-3.5 font-mono text-[11px] font-medium text-dim">reason: lease-acquired</div>
            <div className="flex flex-col">
              {r.dispatcher.map((d) => (
                <div key={d.label} className="flex items-center gap-[11px] border-b border-line-soft py-[9px] last:border-0">
                  <CheckMark />
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[12px] font-semibold text-t2">{d.label}</div>
                    <div className="mt-px font-mono text-[10.5px] font-medium text-dim">{d.val}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className={CARD}>
            <div className={`${LABEL} mb-3.5`}>Outputs &amp; effects</div>
            <div className="flex flex-col gap-[11px]">
              {r.outputs.map((o, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  <Dot color={o.dot} size={7} />
                  <span className="flex-1 font-sans text-[12px] font-medium text-t2">{o.label}</span>
                  <span className="font-mono text-[11px] font-medium" style={{ color: o.tone === 'warn' ? SIGNAL.needs_human : '#5b9ee6' }}>{o.val}</span>
                </div>
              ))}
            </div>
          </div>

          <div className={CARD}>
            <div className={`${LABEL} mb-[13px]`}>Lease &amp; barrier</div>
            <div className="flex flex-col gap-[9px] font-mono text-[11.5px] font-medium">
              {r.leaseBarrier.map((row, i) => (
                <div key={i} className="flex justify-between"><span className="text-dim">{row[0]}</span><span className="text-[#ada695]">{row[1]}</span></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
