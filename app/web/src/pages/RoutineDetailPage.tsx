import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useRoutine, useToggleRoutine, useDispatchRoutine, useSimulatePush, useValidateRoutine, useDeleteRoutine, useRoutineRaw, useStats, useRoutineMemory } from '@/lib/api';
import { Avatar, Chip, Dot, Empty, StatePill, Toggle, SIGNAL } from '@/components/sb';
import type { FrontMatter, RoutineDetail } from '@/types';

const CARD = 'rounded-lg border border-line bg-surface p-[18px]';
const LABEL = 'font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-dim';
const toneColor: Record<string, string> = { ok: SIGNAL.success, bad: SIGNAL.failing, lease: SIGNAL.lease, run: SIGNAL.running, accent: '#5b9ee6', warn: SIGNAL.needs_human };

function FrontMatterCard({ fm }: { fm: FrontMatter }) {
  const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
    <div className="grid items-start gap-3.5" style={{ gridTemplateColumns: '96px 1fr' }}>
      <div className="pt-[3px] font-mono text-[10.5px] font-semibold text-dim">{k}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
  return (
    <div className={CARD}>
      <div className={`${LABEL} mb-4`}>Front matter · contract</div>
      <div className="flex flex-col gap-[15px]">
        <Row k="on:">
          <div className="flex flex-wrap items-center gap-1.5">
            {fm.on.map((o, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <Chip tone={o.tone === 'lease' ? 'blue' : 'default'}>
                  <span style={o.tone === 'lease' ? { color: SIGNAL.lease } : undefined}>{o.key}</span>
                </Chip>
                {o.detail && <span className="font-mono text-[11px] text-muted-2">{o.detail}</span>}
              </span>
            ))}
          </div>
        </Row>
        {fm.tools.length > 0 && (
          <Row k="tools:">
            <div className="flex flex-wrap items-center gap-1.5">
              {fm.tools.map((t, i) =>
                t.sep ? (
                  <span key={i} className="mx-0.5 h-[15px] w-px bg-line" />
                ) : (
                  <span key={i} className="rounded-[5px] font-mono text-[11px] font-medium" style={{ padding: '3px 8px', color: toneColor[t.tone ?? 'ok'], background: `${toneColor[t.tone ?? 'ok']}1a`, border: `1px solid ${toneColor[t.tone ?? 'ok']}3d` }}>
                    {t.sign} {t.name}
                  </span>
                )
              )}
            </div>
          </Row>
        )}
        <Row k="runtime:">
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] font-medium">
            {fm.runtime.map((s, i) => (
              <span key={i} style={{ color: i === 0 ? '#5b9ee6' : '#8a8474' }}>{s}</span>
            ))}
          </div>
        </Row>
        {(fm.filters.actions.length > 0 || fm.filters.branches.length > 0) && (
          <Row k="filters:">
            <div className="flex flex-col gap-[5px] font-mono text-[11px] font-medium text-[#ada695]">
              {fm.filters.actions.length > 0 && <div><span className="text-dim-2">actions</span> [{fm.filters.actions.join(', ')}]</div>}
              {fm.filters.branches.length > 0 && <div><span className="text-dim-2">branches</span> [{fm.filters.branches.join(', ')}]</div>}
            </div>
          </Row>
        )}
      </div>
    </div>
  );
}

function ReactiveFlowCard({ d }: { d: RoutineDetail }) {
  return (
    <div className={CARD}>
      <div className={`${LABEL} mb-4`}>Reactive flow</div>
      <div className="mb-[18px] flex items-center gap-2.5">
        {d.flowNodes.map((n, i) => (
          <span key={i} className="flex items-center gap-2.5">
            {i > 0 && <span className="text-[16px] text-faint">→</span>}
            <span
              className="flex-1 rounded-md px-2 py-[11px] text-center"
              style={n.tone === 'run' ? { border: '1px solid rgba(91,158,230,.35)', background: 'rgba(91,158,230,.07)' } : { border: '1px solid #2b2620', background: '#1c1915' }}
            >
              <div className="font-display text-[12px] font-semibold text-t2">{n.title}</div>
              <div className="mt-0.5 font-mono text-[10px] text-dim">{n.sub}</div>
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function MemoryCard({ slug }: { slug: string }) {
  const { data } = useRoutineMemory(slug, true);
  return (
    <div className={CARD}>
      <div className={`${LABEL} mb-3`}>Memory · persists across runs</div>
      {!data ? (
        <div className="font-mono text-[12px] text-dim">loading…</div>
      ) : !data.exists ? (
        <div className="font-mono text-[12px] text-dim">No memory yet — <span className="font-mono text-[#ada695]">memory.md</span> is created on the first run.</div>
      ) : (
        <>
          <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-line-soft bg-code px-3.5 py-3 font-mono text-[11.5px] leading-[1.6] text-muted">{data.md}</pre>
          {data.files.length > 0 && <div className="mt-2 font-mono text-[11px] text-dim">+ {data.files.length} supporting file{data.files.length === 1 ? '' : 's'}: {data.files.join(', ')}</div>}
        </>
      )}
    </div>
  );
}

export function RoutineDetailPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { data: d, isLoading } = useRoutine(slug);
  const { data: stats } = useStats();
  const toggle = useToggleRoutine();
  const dispatch = useDispatchRoutine();
  const push = useSimulatePush();
  const validate = useValidateRoutine();
  const del = useDeleteRoutine();
  const [showRaw, setShowRaw] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'bad' | 'warn' } | null>(null);
  const raw = useRoutineRaw(slug, showRaw);
  useEffect(() => {
    if (!showRaw) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowRaw(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showRaw]);
  if (isLoading) return <div className="px-6 py-10 text-muted">Loading…</div>;
  if (!d) return <div className="px-[26px] py-10"><Empty title="Routine not found" hint={<Link className="text-brand" to="/">Back to Fleet ›</Link>} /></div>;

  const killed = !!stats?.killSwitch;
  const runNow = () => { setMsg(null); dispatch.mutate(d.slug, { onSuccess: (res) => navigate(`/runs/${res.runId}`), onError: (e) => setMsg({ text: (e as Error).message, tone: 'bad' }) }); };
  const onKill = () => { if (confirm(`Disable “${d.name}”? It will stop firing on its triggers.`)) toggle.mutate({ slug: d.slug, enabled: false }); };
  const onDelete = () => { if (confirm(`Delete “${d.name}” and its run history? This cannot be undone.`)) del.mutate(d.slug, { onSuccess: () => navigate('/') }); };
  const simulatePush = () => {
    setMsg(null);
    const repo = (d.repo || '').split(',').map((s) => s.trim()).filter(Boolean)[0];
    const payload = repo
      ? { event: 'push', repository: repo, ref: `refs/heads/${d.branch || 'main'}`, pusher: d.owner, head_commit: { message: 'simulated push from Switchboard' }, pull_request: { number: 1 } }
      : undefined; // no repo target → server's sample push (matches any repo)
    push.mutate(payload, {
      onSuccess: (res) => {
        const mine = res.runs.find((x) => x.slug === d.slug);
        if (mine) navigate(`/runs/${mine.runId}`);
        else setMsg({ text: `No run produced — this routine's repo/filters didn't match the simulated push${repo ? ` to ${repo}` : ''}.`, tone: 'warn' });
      },
      onError: (e) => setMsg({ text: (e as Error).message, tone: 'bad' }),
    });
  };
  const hasPush = d.triggers.includes('push');
  const busy = dispatch.isPending || push.isPending;

  return (
    <div className="font-sans text-fg animate-fade-up">
      {/* header band */}
      <div className="border-b border-line-soft bg-head px-[26px] py-[22px]">
        <div className="mb-3 font-mono text-[12px] font-medium text-dim">
          <span className="text-brand">Switchboard</span> › <Link to="/" className="text-brand">Fleet</Link> › {d.slug}
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="font-display text-[23px] font-bold tracking-tight">{d.name}</span>
            <StatePill state={d.state} />
            <Toggle on={d.enabled} onCheckedChange={(v) => toggle.mutate({ slug: d.slug, enabled: v })} />
          </div>
          <div className="flex items-center gap-[9px]">
            {hasPush && (
              <button onClick={simulatePush} disabled={busy || killed} title={killed ? 'Kill switch is engaged' : undefined} className="flex h-[34px] items-center gap-[7px] rounded-md border border-brand/50 bg-brand/10 px-3.5 font-display text-[12.5px] font-semibold text-brand-soft transition-colors hover:bg-brand/20 disabled:opacity-40">
                <svg width="13" height="13" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M9 14 V4" /><path d="M5 8 L9 4 L13 8" /></svg>
                {push.isPending ? 'Pushing…' : 'Simulate push'}
              </button>
            )}
            <button onClick={runNow} disabled={busy || killed} title={killed ? 'Kill switch is engaged' : undefined} className="flex h-[34px] items-center gap-[7px] rounded-md bg-brand px-3.5 font-display text-[12.5px] font-semibold text-[#16130f] transition-colors hover:bg-brand-deep disabled:opacity-40">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M3 2 L10 6 L3 10 Z" /></svg>{dispatch.isPending ? 'Running…' : 'Run now'}
            </button>
            <button onClick={() => navigate(`/routines/${d.slug}/edit`)} className="flex h-[34px] items-center rounded-md border border-line bg-surface-2 px-[13px] font-display text-[12.5px] font-semibold text-t2 hover:border-hair">Edit</button>
            <button onClick={() => validate.mutate(d.slug)} disabled={validate.isPending} className="flex h-[34px] items-center rounded-md border border-line bg-surface-2 px-[13px] font-display text-[12.5px] font-semibold text-t2 hover:border-hair disabled:opacity-40">{validate.isPending ? 'Validating…' : 'Validate'}</button>
            <button onClick={d.enabled ? onKill : onDelete} disabled={del.isPending} className="flex h-[34px] items-center rounded-md border border-bad/40 px-[13px] font-display text-[12.5px] font-semibold text-bad hover:bg-bad/10 disabled:opacity-40">{d.enabled ? 'Disable' : 'Delete'}</button>
          </div>
        </div>
        {msg && (
          <div className={`mt-3 inline-block rounded-md border px-3 py-1.5 text-[12px] ${msg.tone === 'bad' ? 'border-bad/30 bg-bad/10 text-bad' : 'border-warn/30 bg-warn/10 text-warn'}`}>{msg.text}</div>
        )}

        {validate.data && (
          <div className={`mt-3 rounded-md border px-3.5 py-2.5 ${validate.data.ok ? 'border-ok/30 bg-ok/[0.06]' : 'border-warn/30 bg-warn/[0.06]'}`}>
            <div className="mb-1.5 flex items-center gap-2 font-display text-[11px] font-semibold uppercase tracking-wide text-dim-2">
              Validation {validate.data.ok ? <span className="text-ok">passed</span> : <span className="text-warn">needs attention</span>}
            </div>
            <div className="flex flex-col gap-1">
              {validate.data.checks.map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-[12px]">
                  <span className={c.ok ? 'text-ok' : 'text-warn'}>{c.ok ? '✓' : '✗'}</span>
                  <span className="font-medium text-t2">{c.label}</span>
                  <span className="font-mono text-[11px] text-muted-2">· {c.detail}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="mt-[11px] flex flex-wrap items-center gap-2.5">
          <span className="font-sans text-[13px] text-muted">{d.summary}</span>
          <span className="h-[13px] w-px bg-line" />
          <span className="inline-flex items-center gap-[7px]"><Avatar color={d.ownerColor} initials={d.initials} size={20} /><span className="font-sans text-[12px] font-medium text-t2">{d.owner}</span><span className="text-faint">·</span><span className="font-mono text-[11px] font-medium text-dim">{d.team}</span></span>
          {d.connectors.slice(0, 2).map((c) => <Chip key={c}>{c}</Chip>)}
          <button onClick={() => setShowRaw(true)} className="ml-auto font-mono text-[12px] font-medium text-brand hover:underline">View raw {d.file} ›</button>
        </div>
      </div>

      {showRaw && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-8" onClick={() => setShowRaw(false)}>
          <div className="mt-12 w-full max-w-[760px] overflow-hidden rounded-lg border border-line bg-surface shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line-soft px-4 py-2.5">
              <span className="font-mono text-[12px] font-medium text-t2">{d.file}</span>
              <button onClick={() => setShowRaw(false)} className="font-mono text-[12px] text-dim hover:text-fg">esc ✕</button>
            </div>
            <pre className="max-h-[70vh] overflow-auto bg-code px-4 py-3.5 font-mono text-[12px] leading-[1.7] text-muted">
              {raw.isLoading ? 'loading…' : (raw.data?.md || '').split('\n').map((line, i) => (
                <div key={i} style={line.startsWith('##') ? { color: '#6f685c' } : line === '---' ? { color: '#5d584d' } : undefined}>{line || ' '}</div>
              ))}
            </pre>
          </div>
        </div>
      )}

      {/* body */}
      <div className="grid gap-[22px] px-[26px] py-[22px] pb-[26px]" style={{ gridTemplateColumns: 'minmax(0,1.55fr) minmax(0,1fr)' }}>
        <div className="flex min-w-0 flex-col gap-[18px]">
          <FrontMatterCard fm={d.frontMatter} />
          <ReactiveFlowCard d={d} />
          <div className={CARD}>
            <div className="mb-3 flex items-center justify-between">
              <div className={LABEL}>Prompt body</div>
              <button onClick={() => navigate(`/routines/${d.slug}/edit`)} className="font-mono text-[11px] font-medium text-brand hover:underline">Open in editor ›</button>
            </div>
            <pre className="overflow-auto whitespace-pre-wrap break-words rounded-md border border-line-soft bg-code px-4 py-3.5 font-mono text-[12px] leading-[1.7] text-muted">
              {d.prompt.split('\n').map((line, i) => (
                <div key={i} style={line.startsWith('##') ? { color: '#6f685c' } : undefined}>{line || ' '}</div>
              ))}
            </pre>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-[18px]">
          <div className={CARD}>
            <div className={`${LABEL} mb-3.5`}>Metrics</div>
            <div className="grid grid-cols-2 gap-x-[18px] gap-y-[13px]">
              {[
                ['Last run', <span className="inline-flex items-center gap-1.5"><Dot state={d.lastStatus} size={7} />{d.lastAgo}</span>],
                ['Success rate', d.successRate == null ? '—' : `${d.successRate}%`],
                ['Spend', d.spend || '$0.00'],
                ['Avg run', d.avg || '—'],
              ].map(([k, v], i) => (
                <div key={i} className="min-w-0">
                  <div className="mb-[3px] font-display text-[10px] font-medium uppercase tracking-[0.06em] text-dim-2">{k}</div>
                  <div className="truncate font-mono text-[12.5px] font-semibold text-t2">{v}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 border-t border-line-soft pt-2.5 font-mono text-[11px] text-dim">{d.runCount} run{d.runCount === 1 ? '' : 's'} recorded</div>
          </div>
          {d.memory && <MemoryCard slug={d.slug} />}
          {d.chain?.length > 0 && (
            <div className={CARD}>
              <div className={`${LABEL} mb-3`}>Chain · on success</div>
              <div className="flex flex-col gap-2.5">
                {d.chain.map((c) => (
                  <div key={c} className="flex items-center gap-2.5">
                    <span className="text-faint">↳</span>
                    <Link to={`/routines/${c}`} className="font-mono text-[12px] font-semibold text-brand">{c}</Link>
                    <span className="font-mono text-[11px] text-dim">fires with this run’s output</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(d.reactions?.length > 0 || d.watches?.length > 0) && (
            <div className={CARD}>
              <div className={`${LABEL} mb-3`}>Reactions · follow the work</div>
              {d.reactions?.length > 0 && (
                <div className="mb-3 flex flex-col gap-1.5">
                  {d.reactions.map((rx, i) => (
                    <div key={i} className="flex items-center gap-2 font-mono text-[11.5px]">
                      <span className="text-lease">when</span>
                      <span className="text-t2">{rx.source === 'timeout' ? `after ${rx.when}` : `${rx.source}:${rx.kind}${rx.when ? `:${rx.when}` : ''}`}{rx.check ? ` · ${rx.check}` : ''}</span>
                      <span className="text-faint">→</span>
                      <Link to={`/routines/${rx.run}`} className="text-brand">{rx.run}</Link>
                    </div>
                  ))}
                </div>
              )}
              {d.watches?.length > 0 && (
                <div className="border-t border-line-soft pt-3">
                  <div className="mb-2 font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-dim-2">Active watches</div>
                  <div className="flex flex-col gap-2">
                    {d.watches.map((w) => (
                      <div key={w.id} className="flex items-start gap-2.5">
                        <Dot color={w.status === 'open' ? '#5b9ee6' : w.status === 'fired' ? '#5fbf86' : '#7f8a80'} size={7} pulse={w.status === 'open'} />
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-[11.5px] text-t2">{w.source}:{w.kind}{w.when ? `:${w.when}` : ''}{w.entity.check ? ` [${w.entity.check}]` : ''} {w.entity.repo ? `· ${w.entity.repo}#${w.entity.pr}` : ''} → <Link to={`/routines/${w.target}`} className="text-brand">{w.target}</Link></div>
                          <div className="font-mono text-[10.5px] text-dim">{w.status}{w.detail ? ` · ${w.detail}` : ''} · {w.ago}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <div className={CARD}>
            <div className="mb-3.5 flex items-center justify-between">
              <span className={LABEL}>Recent runs</span>
              <Link to="/runs" className="font-mono text-[11px] font-medium text-brand">All runs ›</Link>
            </div>
            <div className="flex flex-col">
              {d.runHistory.length === 0 ? (
                <div className="py-2 font-mono text-[12px] text-dim">No runs yet — use <span className="text-brand">Run now</span> to fire one.</div>
              ) : d.runHistory.map((h) => (
                <Link key={h.id} to={`/runs/${h.id}`} className="flex items-center gap-[11px] border-b border-line-soft py-[9px] last:border-0 hover:opacity-80">
                  <Dot state={h.status} size={8} />
                  <span className="w-[74px] shrink-0 font-mono text-[11.5px] font-semibold text-t2">{h.id}</span>
                  <span className="flex-1 truncate font-mono text-[11px] font-medium text-dim">{h.trigger}</span>
                  <span className="shrink-0 font-mono text-[11px] font-medium text-muted-2">{h.dur}</span>
                  <span className="w-[58px] shrink-0 text-right font-mono text-[11px] font-medium text-faint">{h.ago}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
