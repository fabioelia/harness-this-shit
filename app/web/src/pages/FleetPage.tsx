import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useRoutines, useStats, useToggleRoutine, useKillSwitch } from '@/lib/api';
import { Avatar, Chip, Dot, Empty, Sbar, Spark, StatePill, Toggle, makeHist } from '@/components/sb';
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
      {cell('Needs human', <span className="flex items-center gap-[9px] text-warn">{s?.needsHuman ?? 0}<Dot color="#e6b052" /></span>)}
      {cell('Runs today', s?.runsToday ?? '—')}
      {cell('Success 7d', <span className="text-ok">{s?.success7d == null ? '—' : `${s.success7d}%`}</span>)}
      {cell('Reactions 24h', <span>{s?.reactions24h ?? '—'} <span className="text-[12px] font-medium text-dim">fired</span></span>, true)}
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
  const kill = useKillSwitch();
  const [q, setQ] = useState('');

  const list = (routines ?? []).filter((r) =>
    !q.trim() || (r.name + r.summary + r.team + r.owner + r.triggers.join(' ')).toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6 font-sans text-fg animate-fade-up">
      {/* header */}
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <div className="mb-[5px] font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-brand">{stats?.wordmark ?? 'Switchboard'}</div>
          <div className="font-display text-[26px] font-bold tracking-tight">Fleet</div>
          <div className="mt-[3px] text-[13px] text-muted-2">
            {stats?.total ?? '—'} routines · {stats?.enabled ?? '—'} enabled · {stats?.teams ?? '—'} teams · runner <span className="font-mono text-[#ada695]">claude -p</span>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => kill.mutate(!stats?.killSwitch)}
            className="flex h-9 items-center gap-[7px] rounded-md border border-bad/40 px-3.5 font-display text-[12.5px] font-semibold text-bad transition-colors hover:bg-bad/10"
          >
            <StopIcon />{stats?.killSwitch ? 'Halted' : 'Stop all'}
          </button>
          <button className="flex h-9 items-center gap-2 rounded-md bg-brand px-[15px] font-display text-[12.5px] font-semibold text-[#16130f] transition-colors hover:bg-brand-deep">
            <span className="-mt-px text-[16px] leading-none">+</span>New routine
          </button>
        </div>
      </div>

      <StatStrip s={stats} />

      {/* filter bar */}
      <div className="mb-3.5 flex flex-wrap items-center gap-[9px]">
        <div className="flex h-[34px] w-[280px] items-center gap-[9px] rounded-md border border-line bg-surface px-3">
          <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="#767063" strokeWidth="1.6"><circle cx="8" cy="8" r="5" /><line x1="11.8" y1="11.8" x2="15.5" y2="15.5" strokeLinecap="round" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search routines, owners, tags…" className="flex-1 bg-transparent text-[12.5px] text-fg placeholder:text-dim-2 focus:outline-none" />
          <span className="rounded border border-line px-[5px] font-mono text-[11px] font-semibold text-faint">/</span>
        </div>
        {['Team', 'Trigger', 'Connector'].map((d) => (
          <button key={d} className="flex h-[34px] items-center gap-[7px] rounded-md border border-line bg-surface px-3 font-sans text-[12.5px] font-medium text-[#ada695] hover:border-hair">{d}<Caret /></button>
        ))}
        <button className="flex h-[34px] items-center gap-[7px] rounded-md border border-copper/30 bg-copper/[0.07] px-3 font-sans text-[12.5px] font-medium text-copper-text">
          Health: needs review
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#d8b486" strokeWidth="1.4"><path d="M3 3 L7 7 M7 3 L3 7" strokeLinecap="round" /></svg>
        </button>
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
              routines && routines.length === 0
                ? 'Routines are version-controlled *.routine.md files. Connect a repo and add one to see it here.'
                : 'Try clearing the search.'
            }
          />
        ) : (
          list.map((r, i) => <FleetRow key={r.slug} r={r} i={i} />)
        )}
      </div>
    </div>
  );
}
