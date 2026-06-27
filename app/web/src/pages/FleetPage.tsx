import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useRoutines, useStats, useToggleRoutine, useKillSwitch, useConnectors } from '@/lib/api';
import { Avatar, Chip, Dot, Empty, Sbar, Spark, StatePill, Toggle, makeHist } from '@/components/sb';
import { cn } from '@/lib/utils';
import type { Routine, Stats } from '@/types';

const GRID = 'grid-template-columns:36px minmax(0,2.2fr) minmax(0,1.5fr) 156px 144px 116px 92px 132px 78px';

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
          value ? 'border-brand/50 text-brand-soft' : 'border-line text-[#ada695]'
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
      {cell('Runs today', s?.runsToday ?? '—')}
      {cell('Success rate', <span className="text-ok">{s?.successRate == null ? '—' : `${s.successRate}%`}</span>)}
      {cell('Spend', <span>{s?.spend ?? '$0.00'} <span className="text-[12px] font-medium text-dim">total</span></span>, true)}
    </div>
  );
}

function FleetRow({ r, i }: { r: Routine; i: number }) {
  const toggle = useToggleRoutine();
  const hist = useMemo(() => makeHist(r.success, r.state, i + 1), [r.success, r.state, i]);
  return (
    <div
      className="border-b border-line-soft transition-colors last:border-0 hover:bg-white/[0.015]"
      style={{ display: 'grid', gridTemplateColumns: '36px minmax(0,2.2fr) minmax(0,1.5fr) 156px 144px 116px 92px 132px 78px', alignItems: 'center', padding: '13px 16px' }}
    >
      <div><Toggle on={r.enabled} onCheckedChange={(v) => toggle.mutate({ slug: r.slug, enabled: v })} /></div>
      <div className="min-w-0 pr-3.5">
        <Link to={`/routines/${r.slug}`} className="block truncate font-display text-[14px] font-semibold text-fg-2 hover:text-brand">{r.name}</Link>
        <div className="mt-0.5 truncate font-sans text-[12px] text-muted-2">{r.summary}</div>
        <div className="mt-[3px] font-mono text-[11px] font-medium text-faint">{r.slug}.routine.md</div>
      </div>
      <div className="flex flex-wrap gap-[5px] pr-3.5">
        {r.triggers.map((t) => <Chip key={t}>{t}</Chip>)}
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
        {r.leaseRef && <span className="font-mono text-[10.5px] font-medium text-lease">{r.leaseRef}</span>}
      </div>
      <div className="flex items-center gap-[7px] font-mono text-[12px] font-medium text-[#ada695]">
        <Dot state={r.lastStatus} size={8} /> {r.lastAgo}
      </div>
      <div className="font-mono text-[12px] font-medium text-muted-2">{r.next}</div>
      <div className="flex flex-col gap-[5px]"><Spark hist={hist} /><Sbar pct={r.success} /></div>
      <div className="text-right font-mono text-[12px] font-medium text-[#ada695]">{r.avg}</div>
    </div>
  );
}

export function FleetPage() {
  const { data: routines } = useRoutines();
  const { data: stats } = useStats();
  const { data: connectors } = useConnectors();
  const kill = useKillSwitch();
  const ghOff = connectors?.find((c) => c.code === 'GH')?.health === 'off';
  const slackOff = connectors?.find((c) => c.code === 'SL')?.health === 'off';
  const [q, setQ] = useState('');
  const [team, setTeam] = useState('');
  const [trig, setTrig] = useState('');
  const [conn, setConn] = useState('');
  const [needsReview, setNeedsReview] = useState(false);
  const [params] = useSearchParams();
  useEffect(() => {
    const c = params.get('connector'); if (c) setConn(c);
    const t = params.get('team'); if (t) setTeam(t);
    const g = params.get('trigger'); if (g) setTrig(g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const opts = useMemo(() => {
    const teams = new Set<string>(), trigs = new Set<string>(), conns = new Set<string>();
    (routines ?? []).forEach((r) => { if (r.team) teams.add(r.team); r.triggers.forEach((t) => trigs.add(t)); r.connectors.forEach((c) => conns.add(c)); });
    return { teams: [...teams], trigs: [...trigs], conns: [...conns] };
  }, [routines]);

  const list = (routines ?? []).filter((r) => {
    if (q.trim() && !(r.name + r.summary + r.team + r.owner + r.triggers.join(' ')).toLowerCase().includes(q.toLowerCase())) return false;
    if (team && r.team !== team) return false;
    if (trig && !r.triggers.includes(trig)) return false;
    if (conn && !r.connectors.includes(conn)) return false;
    if (needsReview && !(r.state === 'failing' || r.state === 'needs_human' || (r.success != null && r.success < 75))) return false;
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
            onClick={() => kill.mutate(!stats?.killSwitch)}
            className="flex h-9 items-center gap-[7px] rounded-md border border-bad/40 px-3.5 font-display text-[12.5px] font-semibold text-bad transition-colors hover:bg-bad/10"
          >
            <StopIcon />{stats?.killSwitch ? 'Halted' : 'Stop all'}
          </button>
          <Link to="/routines/new" className="flex h-9 items-center gap-2 rounded-md bg-brand px-[15px] font-display text-[12.5px] font-semibold text-[#16130f] transition-colors hover:bg-brand-deep">
            <span className="-mt-px text-[16px] leading-none">+</span>New routine
          </Link>
        </div>
      </div>

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
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search routines, owners, tags…" className="flex-1 bg-transparent text-[12.5px] text-fg placeholder:text-dim-2 focus:outline-none" />
          <span className="rounded border border-line px-[5px] font-mono text-[11px] font-semibold text-faint">/</span>
        </div>
        <FilterSelect value={team} onChange={setTeam} label="Team" options={opts.teams} />
        <FilterSelect value={trig} onChange={setTrig} label="Trigger" options={opts.trigs} />
        <FilterSelect value={conn} onChange={setConn} label="Connector" options={opts.conns} />
        <button
          onClick={() => setNeedsReview((v) => !v)}
          className={cn(
            'flex h-[34px] items-center gap-[7px] rounded-md border px-3 font-sans text-[12.5px] font-medium transition-colors',
            needsReview ? 'border-copper/40 bg-copper/[0.12] text-copper-text' : 'border-line bg-surface text-[#ada695] hover:border-hair'
          )}
        >
          Health: needs review
          {needsReview && <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#d8b486" strokeWidth="1.4"><path d="M3 3 L7 7 M7 3 L3 7" strokeLinecap="round" /></svg>}
        </button>
        {(team || trig || conn || needsReview || q) && (
          <button onClick={() => { setTeam(''); setTrig(''); setConn(''); setNeedsReview(false); setQ(''); }} className="font-mono text-[11px] text-dim hover:text-fg">clear</button>
        )}
        <span className="ml-auto text-[12px] text-dim">{list.length} of {routines?.length ?? 0}</span>
      </div>

      {/* table */}
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="border-b border-line bg-surface-2 px-4 py-[11px] font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-dim-2" style={{ display: 'grid', gridTemplateColumns: '36px minmax(0,2.2fr) minmax(0,1.5fr) 156px 144px 116px 92px 132px 78px', alignItems: 'center' }}>
          <div /><div>Routine</div><div>Triggers</div><div>Owner · team</div><div>State</div><div>Last run</div><div>Next</div><div>7d health</div><div className="text-right">Avg run</div>
        </div>
        {list.length === 0 ? (
          <Empty
            title={routines && routines.length === 0 ? 'No routines yet' : 'No routines match'}
            hint={
              routines && routines.length === 0 ? (
                <>
                  Routines are version-controlled <span className="font-mono text-[#ada695]">*.routine.md</span> files.{' '}
                  <Link to="/routines/new" className="text-brand hover:underline">Create your first one ›</Link>
                </>
              ) : (
                'Try clearing the search.'
              )
            }
          />
        ) : (
          list.map((r, i) => <FleetRow key={r.slug} r={r} i={i} />)
        )}
      </div>
    </div>
  );
}
