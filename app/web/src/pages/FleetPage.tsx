import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useRoutines, useStats, useToggleRoutine, useKillSwitch, useConnectors, useLoadSamples, useImportRoutine, useBulkRoutines, usePinRoutine, useFleetViews, useSaveView, useDeleteView, useAttention } from '@/lib/api';
import { Avatar, Chip, Dot, Empty, StatePill, Toggle } from '@/components/sb';
import { cn } from '@/lib/utils';
import { useOperator } from '@/lib/operator';
import type { Routine, Stats } from '@/types';


function StopIcon({ s = 13 }: { s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M9 2.5 V 8.5" /><path d="M4.7 5.2 a5.6 5.6 0 1 0 8.6 0" />
    </svg>
  );
}
function Caret() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#767063" strokeWidth="1.4">
      <path d="M2 4 L5 7 L8 4" strokeLinecap="round" />
    </svg>
  );
}

function FilterSelect({ value, onChange, label, options }: { value: string; onChange: (v: string) => void; label: string; options: string[] }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ colorScheme: 'dark' }}
        className={cn(
          'h-[34px] appearance-none rounded-md border bg-surface pl-3 pr-7 font-sans text-[12.5px] font-medium hover:border-hair focus:outline-none',
          value ? 'border-brand/50 text-brand-soft' : 'border-line text-[var(--code-accent)]'
        )}
      >
        <option value="">{label}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2"><Caret /></span>
    </div>
  );
}

function StatStrip({ s }: { s?: Stats }) {
  const cell = (label: string, value: React.ReactNode, last = false) => (
    <div className={`flex-1 px-4 py-3.5 ${last ? '' : 'border-r border-line-3'}`}>
      <div className="font-display text-[10px] font-semibold uppercase tracking-[0.09em] text-dim">{label}</div>
      <div className="mt-[7px] font-display text-[23px] font-bold leading-none">{value}</div>
    </div>
  );
  return (
    <div className="mb-[18px] flex overflow-hidden rounded-xl border border-line bg-surface">
      {cell('Routines', <span>{s?.total ?? '—'} <span className="text-[12px] font-medium text-dim">/ {s?.enabled ?? 0} on</span></span>)}
      {cell('Running now', <span className="flex items-center gap-[9px]">{s?.running ?? 0}<Dot color="#5b9ee6" pulse /></span>)}
      {cell('Runs · 24h', s?.runsToday ?? '—')}
      {cell('Success rate', <span className="text-ok">{s?.successRate == null ? '—' : `${s.successRate}%`}</span>)}
      {cell('Spend', <span>{s?.spend ?? '$0.00'} <span className="text-[12px] font-medium text-dim">total</span></span>, true)}
    </div>
  );
}

function FleetRow({ r, i, selected, onSelect }: { r: Routine; i: number; selected: boolean; onSelect: (slug: string) => void }) {
  const toggle = useToggleRoutine();
  const pin = usePinRoutine();
  return (
    <div
      className={`border-b border-line-soft transition-colors last:border-0 hover:bg-white/[0.015] ${selected ? 'bg-brand/[0.06]' : ''}`}
      style={{ display: 'grid', gridTemplateColumns: '36px minmax(0,2.2fr) minmax(0,1.5fr) 156px 144px 116px 92px 132px 78px', alignItems: 'center', padding: '13px 16px' }}
    >
      <div><Toggle on={r.enabled} onCheckedChange={(v) => toggle.mutate({ slug: r.slug, enabled: v })} /></div>
      <div className="min-w-0 pr-3.5">
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={selected} onChange={() => onSelect(r.slug)} className="h-3.5 w-3.5 shrink-0 accent-[#5b9ee6]" title="select" />
          <button onClick={() => pin.mutate(r.slug)} title={r.pinned ? 'unpin' : 'pin to top'} className={`shrink-0 text-[13px] leading-none ${r.pinned ? 'text-brand' : 'text-faint hover:text-dim'}`}>{r.pinned ? '★' : '☆'}</button>
          <Link to={`/routines/${r.slug}`} className="truncate font-display text-[14px] font-semibold text-fg-2 hover:text-brand">{r.name}</Link>
          {r.reviewStatus === 'needs_review' && <span title="config changed since last approval" className="shrink-0 rounded border border-warn/40 bg-warn/10 px-1.5 py-px font-mono text-[10px] font-semibold text-warn">⚑ review</span>}
          {r.tier === 'critical' && <span title="business-critical" className="shrink-0 rounded border border-bad/50 bg-bad/10 px-1.5 py-px font-mono text-[10px] font-semibold text-bad">⬢ critical</span>}
          {r.lifecycle === 'draft' && <span className="shrink-0 rounded border border-brand/40 bg-brand/10 px-1.5 py-px font-mono text-[10px] font-semibold text-brand-soft">draft</span>}
          {r.lifecycle === 'deprecated' && <span className="shrink-0 rounded border border-warn/40 bg-warn/10 px-1.5 py-px font-mono text-[10px] font-semibold text-warn">deprecated</span>}
          {r.sunsetOverdue && <span title="past its sunset date — should be retired" className="shrink-0 rounded border border-bad/40 bg-bad/10 px-1.5 py-px font-mono text-[10px] font-semibold text-bad">⏳ overdue</span>}
          {r.longRunning && <span title="a run has been going over 8 minutes — possibly stuck" className="shrink-0 animate-sbpulse rounded-full border border-bad/40 bg-bad/10 px-1.5 py-px font-mono text-[10px] font-semibold text-bad">⏱ long-run</span>}
          {r.staleSuccess && <span title={`last success was ${r.lastSuccessAgo} — over a week ago`} className="shrink-0 rounded-full border border-warn/40 bg-warn/10 px-1.5 py-px font-mono text-[10px] font-semibold text-warn">stale</span>}
          {r.snoozedUntil > 0 && <span title={`snoozed until ${new Date(r.snoozedUntil).toLocaleString()}`} className="shrink-0 rounded-full border border-lease/40 bg-lease/10 px-1.5 py-px font-mono text-[10px] font-semibold text-lease">💤</span>}
          {r.commentCount > 0 && <Link to={`/routines/${r.slug}`} title={`${r.commentCount} comment${r.commentCount>1?"s":""}`} className="shrink-0 rounded-full border border-line bg-surface-2 px-1.5 py-px font-mono text-[10px] font-medium text-dim-2 hover:text-brand">💬 {r.commentCount}</Link>}
          {r.inbox > 0 && <Link to={`/routines/${r.slug}`} title={`${r.inbox} task${r.inbox > 1 ? 's' : ''} handed off, waiting to be picked up`} className="shrink-0 rounded-full border border-lease/40 bg-lease/10 px-1.5 py-px font-mono text-[10px] font-semibold text-lease">📥 {r.inbox}</Link>}
        </div>
        <div className="mt-0.5 truncate font-sans text-[12px] text-muted-2">{r.summary}</div>
        <div className="mt-[3px] font-mono text-[11px] font-medium text-faint">{r.slug}.routine.md</div>
      </div>
      <div className="flex flex-wrap gap-[5px] pr-3.5">
        {r.triggers.map((t) => <Chip key={t}>{t}</Chip>)}
        {(r.tags || []).map((t) => <span key={t} className="rounded-[4px] border border-line bg-surface-2 px-1.5 py-px font-mono text-[10px] text-dim-2">#{t}</span>)}
      </div>
      <div className="flex min-w-0 items-center gap-[9px]">
        <Avatar color={r.ownerColor} initials={r.initials} />
        <div className="min-w-0">
          <div className="font-sans text-[12.5px] font-medium text-t2">{r.owner}</div>
          <div className="font-mono text-[10.5px] font-medium text-dim">{r.team}</div>
        </div>
      </div>
      <div className="flex flex-col items-start gap-1">
        <StatePill state={r.state} />
      </div>
      <div className="flex items-center gap-[7px] font-mono text-[12px] font-medium text-[var(--code-accent)]">
        <Dot state={r.lastStatus} size={8} /> {r.lastAgo}
      </div>
      <div className="font-mono text-[12px] font-medium text-muted-2">{r.next}</div>
      <div className="flex flex-col gap-[5px]">
        <div className="flex h-[16px] items-end gap-[2px]">
          {r.recent.length === 0
            ? <span className="font-mono text-[11px] text-faint">no runs</span>
            : r.recent.map((s, i) => (
                <span key={i} title={s} className="w-[5px] rounded-[1px]" style={{ height: s === 'running' ? 8 : 14, background: s === 'succeeded' ? '#5fbf86' : s === 'failed' ? '#e5736b' : 'var(--faint)' }} />
              ))}
        </div>
        <span className="font-mono text-[11px] font-medium text-[var(--code-accent)]">{r.successRate == null ? '—' : `${r.successRate}%`}</span>
      </div>
      <div className="text-right font-mono text-[12px] font-medium text-[var(--code-accent)]">{r.avg}</div>
    </div>
  );
}

export function FleetPage() {
  const [showArchived, setShowArchived] = useState(false);
  const { data: routines } = useRoutines(showArchived);
  const { data: stats } = useStats();
  const { data: connectors } = useConnectors();
  const kill = useKillSwitch();
  const loadSamples = useLoadSamples();
  const importRoutine = useImportRoutine();
  const bulk = useBulkRoutines();
  const { data: views } = useFleetViews();
  const { data: attention } = useAttention();
  const saveView = useSaveView();
  const deleteView = useDeleteView();
  const applyView = (p: Record<string, string | boolean>) => { setQ(String(p.q || '')); setTeam(String(p.team || '')); setTrig(String(p.trig || '')); setConn(String(p.conn || '')); setTag(String(p.tag || '')); setNeedsReview(!!p.needsReview); };
  const [sel, setSel] = useState<Set<string>>(new Set());
  const onSelect = (slug: string) => setSel((prev) => { const n = new Set(prev); n.has(slug) ? n.delete(slug) : n.add(slug); return n; });
  const navigate = useNavigate();
  const ghOff = connectors?.find((c) => c.code === 'GH')?.health === 'off';
  const slackOff = connectors?.find((c) => c.code === 'SL')?.health === 'off';
  const [q, setQ] = useState('');
  const [team, setTeam] = useState('');
  const [owner, setOwner] = useState('');
  const [trig, setTrig] = useState('');
  const [tag, setTag] = useState('');
  const [tier, setTier] = useState('');
  const [operator] = useOperator();
  const [conn, setConn] = useState('');
  const [needsReview, setNeedsReview] = useState(false);
  const [grouped, setGrouped] = useState(false);
  const [params] = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
      if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const c = params.get('connector'); if (c) setConn(c);
    const t = params.get('team'); if (t) setTeam(t);
    const g = params.get('trigger'); if (g) setTrig(g);
    const ti = params.get('tier'); if (ti) setTier(ti);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const opts = useMemo(() => {
    const teams = new Set<string>(), trigs = new Set<string>(), conns = new Set<string>(), tags = new Set<string>(), owners = new Set<string>();
    (routines ?? []).forEach((r) => { if (r.team) teams.add(r.team); if (r.owner) owners.add(r.owner); r.triggers.forEach((t) => trigs.add(t)); r.connectors.forEach((c) => conns.add(c)); (r.tags || []).forEach((t) => tags.add(t)); });
    return { teams: [...teams], trigs: [...trigs], conns: [...conns], tags: [...tags], owners: [...owners].sort() };
  }, [routines]);

  const list = (routines ?? []).filter((r) => {
    if (q.trim() && !(r.name + r.summary + r.team + r.owner + r.triggers.join(' ')).toLowerCase().includes(q.toLowerCase())) return false;
    if (team && r.team !== team) return false;
    if (owner && r.owner !== owner) return false;
    if (trig && !r.triggers.includes(trig)) return false;
    if (conn && !r.connectors.includes(conn)) return false;
    if (tag && !(r.tags || []).includes(tag)) return false;
    if (tier && r.tier !== tier) return false;
    if (needsReview && !(r.state === 'failing' || r.lastStatus === 'failing' || (r.successRate != null && r.successRate < 75))) return false;
    return true;
  });

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6 font-sans text-fg animate-fade-up">
      {/* header */}
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <div className="mb-[5px] font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-brand">{stats?.wordmark ?? 'Switchboard'}</div>
          <div className="font-display text-[26px] font-bold tracking-tight">Fleet</div>
          <div className="mt-[3px] text-[13px] text-muted-2">
            {stats?.total ?? '—'} routines · {stats?.enabled ?? '—'} enabled · {stats?.teams ?? '—'} teams · local auto-mode sessions
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => { const engaging = !stats?.killSwitch; if (!engaging || confirm('Engage the kill switch? This halts ALL routines until released.')) kill.mutate(engaging); }}
            className="flex h-9 items-center gap-[7px] rounded-md border border-bad/40 px-3.5 font-display text-[12.5px] font-semibold text-bad transition-colors hover:bg-bad/10"
          >
            <StopIcon />{stats?.killSwitch ? 'Halted' : 'Stop all'}
          </button>
          <button onClick={() => loadSamples.mutate()} disabled={loadSamples.isPending} className="flex h-9 items-center gap-2 rounded-md border border-line bg-surface-2 px-3.5 font-display text-[12.5px] font-semibold text-t2 hover:border-hair disabled:opacity-40" title="Seed 3 real developer flows (routines + agents)">
            {loadSamples.isPending ? 'Loading…' : 'Load examples'}
          </button>
          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-line bg-surface-2 px-3.5 font-display text-[12.5px] font-semibold text-t2 hover:border-hair" title="Import a routine from an exported .routine.json">
            Import
            <input type="file" accept="application/json,.json" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return;
              try { const bundle = JSON.parse(await f.text()); importRoutine.mutate(bundle, { onSuccess: (r) => navigate(`/routines/${r.slug}`) }); }
              catch { alert('Not valid JSON'); }
              e.target.value = '';
            }} />
          </label>
          <Link to="/routines/new" className="flex h-9 items-center gap-2 rounded-md bg-brand px-[15px] font-display text-[12.5px] font-semibold text-[#16130f] transition-colors hover:bg-brand-deep">
            <span className="-mt-px text-[16px] leading-none">+</span>New routine
          </Link>
        </div>
      </div>

      {attention && attention.items.length > 0 && (
        <div className="mb-[18px] flex flex-wrap items-center gap-2 rounded-xl border border-warn/30 bg-warn/[0.06] px-4 py-2.5">
          <span className="font-display text-[11px] font-semibold uppercase tracking-[0.08em] text-warn">⚠ Needs attention</span>
          {attention.items.map((it) => (
            <Link key={it.kind} to={it.link} className="rounded-md border border-line bg-surface-2 px-2.5 py-1 font-mono text-[12px] text-t2 hover:border-hair">{it.text}</Link>
          ))}
        </div>
      )}
      <StatStrip s={stats} />

      {(ghOff || slackOff) && (
        <div className="mb-3.5 flex items-center gap-3 rounded-lg border border-warn/30 bg-warn/[0.06] px-4 py-3">
          <Dot color="#e6b052" size={8} />
          <div className="flex-1 text-[12.5px] text-t2">
            <span className="font-semibold">Finish setup —</span>{' '}
            {ghOff && <>GitHub isn’t authed (<span className="font-mono text-[11.5px]">gh auth login</span>)</>}
            {ghOff && slackOff && ' and '}
            {slackOff && <>Slack has no bot token (<span className="font-mono text-[11.5px]">SLACK_BOT_TOKEN</span>)</>}
            . Routines that use these tools will fail until connected.
          </div>
          <Link to="/connectors" className="shrink-0 font-mono text-[11px] font-medium text-brand hover:underline">View connectors ›</Link>
        </div>
      )}

      {/* filter bar */}
      <div className="mb-3.5 flex flex-wrap items-center gap-[9px]">
        <div className="flex h-[34px] w-[280px] items-center gap-[9px] rounded-md border border-line bg-surface px-3">
          <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="#767063" strokeWidth="1.6"><circle cx="8" cy="8" r="5" /><line x1="11.8" y1="11.8" x2="15.5" y2="15.5" strokeLinecap="round" /></svg>
          <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search routines, owners, triggers…" className="flex-1 bg-transparent text-[12.5px] text-fg placeholder:text-dim-2 focus:outline-none" />
          <span className="rounded border border-line px-[5px] font-mono text-[11px] font-semibold text-faint">/</span>
        </div>
        <FilterSelect value={team} onChange={setTeam} label="Team" options={opts.teams} />
        <FilterSelect value={owner} onChange={setOwner} label="Owner" options={opts.owners} />
        {operator && <button onClick={() => setOwner(owner === operator ? '' : operator)} title={`show only routines you (${operator}) own`} className={cn('h-[34px] rounded-md border px-3 font-display text-[12px] font-semibold', owner === operator ? 'border-brand/50 bg-brand/10 text-brand-soft' : 'border-line bg-surface text-dim hover:border-hair hover:text-t2')}>Mine</button>}
        <FilterSelect value={trig} onChange={setTrig} label="Trigger" options={opts.trigs} />
        <FilterSelect value={conn} onChange={setConn} label="Connector" options={opts.conns} />
        {opts.tags.length > 0 && <FilterSelect value={tag} onChange={setTag} label="Tag" options={opts.tags} />}
        <FilterSelect value={tier} onChange={setTier} label="Tier" options={['critical', 'standard', 'experimental']} />
        <button
          onClick={() => setNeedsReview((v) => !v)}
          className={cn(
            'flex h-[34px] items-center gap-[7px] rounded-md border px-3 font-sans text-[12.5px] font-medium transition-colors',
            needsReview ? 'border-copper/40 bg-copper/[0.12] text-copper-text' : 'border-line bg-surface text-[var(--code-accent)] hover:border-hair'
          )}
        >
          Health: needs review
          {needsReview && <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#d8b486" strokeWidth="1.4"><path d="M3 3 L7 7 M7 3 L3 7" strokeLinecap="round" /></svg>}
        </button>
        {(team || owner || trig || conn || tag || tier || needsReview || q) && (
          <button onClick={() => { setTeam(''); setOwner(''); setTrig(''); setConn(''); setTag(''); setTier(''); setNeedsReview(false); setQ(''); }} className="font-mono text-[11px] text-dim hover:text-fg">clear</button>
        )}
        <button onClick={() => setGrouped((v) => !v)} className={cn('flex h-[34px] items-center gap-[6px] rounded-md border px-2.5 font-mono text-[11.5px] font-medium', grouped ? 'border-brand/50 bg-brand/10 text-brand-soft' : 'border-line text-dim hover:text-t2')} title="group by team">⊞ team</button>
        <button onClick={() => setShowArchived((v) => !v)} className={cn('flex h-[34px] items-center gap-[6px] rounded-md border px-2.5 font-mono text-[11.5px] font-medium', showArchived ? 'border-warn/50 bg-warn/10 text-warn' : 'border-line text-dim hover:text-t2')} title="show archived routines">{showArchived ? '⊟ archived' : '⊞ archived'}</button>
        <span className="ml-auto text-[12px] text-dim">{list.length} of {routines?.length ?? 0}</span>
      </div>

      {/* saved views */}
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-dim-2">Views</span>
        {(views?.views ?? []).map((v) => (
          <span key={v.name} className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 py-1 pl-2.5 pr-1.5 text-[12px]">
            <button onClick={() => applyView(v.params)} className="font-medium text-t2 hover:text-brand">{v.name}</button>
            <button onClick={() => deleteView.mutate(v.name)} className="text-dim hover:text-bad" aria-label={`delete ${v.name}`}>×</button>
          </span>
        ))}
        {(team || owner || trig || conn || tag || tier || needsReview || q) && (
          <button onClick={() => { const name = prompt('Save current filters as view:'); if (name) saveView.mutate({ name, params: { q, team, trig, conn, tag, needsReview } }); }} className="font-mono text-[11.5px] text-brand-soft hover:underline">+ save current</button>
        )}
        {!(views?.views ?? []).length && !(team || trig || conn || tag || needsReview || q) && <span className="font-mono text-[11px] text-dim">apply filters, then “save current” to pin a preset</span>}
      </div>

      {/* table */}
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="border-b border-line bg-surface-2 px-4 py-[11px] font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-dim-2" style={{ display: 'grid', gridTemplateColumns: '36px minmax(0,2.2fr) minmax(0,1.5fr) 156px 144px 116px 92px 132px 78px', alignItems: 'center' }}>
          <div /><div>Routine</div><div>Triggers</div><div>Owner · team</div><div>State</div><div>Last run</div><div>Next</div><div>Recent runs</div><div className="text-right">Avg run</div>
        </div>
        {!routines ? (
          <div className="px-6 py-10 text-center font-mono text-[12px] text-dim">Loading…</div>
        ) : list.length === 0 ? (
          <Empty
            title={routines.length === 0 ? 'No routines yet' : 'No routines match'}
            hint={
              routines.length === 0 ? (
                <>
                  A routine is a saved prompt + granted tools + triggers.{' '}
                  <button onClick={() => loadSamples.mutate()} disabled={loadSamples.isPending} className="text-brand hover:underline disabled:opacity-50">{loadSamples.isPending ? 'Loading…' : 'Load 3 example flows'}</button>{' '}or <Link to="/routines/new" className="text-brand hover:underline">create your own ›</Link>
                </>
              ) : (
                'Try clearing the search or filters.'
              )
            }
          />
        ) : grouped ? (
          [...new Set([...list].sort((a, b) => a.team.localeCompare(b.team)).map((r) => r.team))].map((tm) => {
            const rs = [...list].filter((r) => r.team === tm).sort((a, b) => Number(b.pinned) - Number(a.pinned));
            return (
              <div key={tm || '—'}>
                <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.06em] text-dim-2">{tm || 'no team'} <span className="font-mono text-dim">· {rs.length}</span></div>
                {rs.map((r, i) => <FleetRow key={r.slug} r={r} i={i} selected={sel.has(r.slug)} onSelect={onSelect} />)}
              </div>
            );
          })
        ) : (
          [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned)).map((r, i) => <FleetRow key={r.slug} r={r} i={i} selected={sel.has(r.slug)} onSelect={onSelect} />)
        )}
      </div>
      {sel.size > 0 && (
        <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 shadow-pop">
          <span className="font-mono text-[12px] text-t2">{sel.size} selected</span>
          <span className="mx-1 h-4 w-px bg-line" />
          {([['enable', 'Enable'], ['disable', 'Disable'], ['snooze', 'Snooze 4h'], ['unsnooze', 'Wake']] as const).map(([a, l]) => (
            <button key={a} onClick={() => bulk.mutate({ slugs: [...sel], action: a, hours: 4 }, { onSuccess: () => setSel(new Set()) })} className="h-8 rounded-md border border-line bg-surface-2 px-2.5 font-display text-[12px] font-semibold text-t2 hover:border-hair">{l}</button>
          ))}
          <button onClick={async () => { const r = await fetch('/api/routines/export-bundle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slugs: [...sel] }) }); const blob = await r.blob(); const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = 'switchboard-routines.json'; a.click(); URL.revokeObjectURL(u); }} className="h-8 rounded-md border border-line bg-surface-2 px-2.5 font-display text-[12px] font-semibold text-t2 hover:border-hair">Export</button>
          <button onClick={() => { const o = prompt(`Reassign ${sel.size} routine(s) to which owner?`); if (o != null) bulk.mutate({ slugs: [...sel], action: "owner", owner: o.trim() }, { onSuccess: () => setSel(new Set()) }); }} className="h-8 rounded-md border border-line bg-surface-2 px-2.5 font-display text-[12px] font-semibold text-t2 hover:border-hair">Reassign</button>
          <button onClick={() => { if (confirm(`Delete ${sel.size} routine(s)?`)) bulk.mutate({ slugs: [...sel], action: 'delete' }, { onSuccess: () => setSel(new Set()) }); }} className="h-8 rounded-md border border-bad/40 px-2.5 font-display text-[12px] font-semibold text-bad hover:bg-bad/10">Delete</button>
          <button onClick={() => setSel(new Set())} className="ml-1 font-mono text-[11px] text-dim hover:text-fg">clear</button>
        </div>
      )}
    </div>
  );
}
