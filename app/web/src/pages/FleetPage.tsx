import { useMemo, useState } from 'react';
import { SlidersHorizontal, Plus } from 'lucide-react';
import { Page, PageHeader } from '@/components/page';
import { StatStrip } from '@/components/StatStrip';
import { RoutineRow } from '@/components/RoutineRow';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useRoutines, useStats } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Routine, RoutineState } from '@/types';

const STATE_FILTERS: { key: 'all' | RoutineState; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'running', label: 'Running' },
  { key: 'needs_human', label: 'Needs human' },
  { key: 'failing', label: 'Failing' },
  { key: 'idle', label: 'Idle' },
  { key: 'disabled', label: 'Disabled' },
];

const STATE_ORDER: Record<RoutineState, number> = {
  running: 0,
  needs_human: 1,
  failing: 2,
  queued: 3,
  idle: 4,
  disabled: 5,
};

function Chip({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-brand/50 bg-brand/12 text-brand-soft'
          : 'border-line bg-surface text-muted hover:border-line hover:text-fg'
      )}
    >
      {children}
    </button>
  );
}

export function FleetPage() {
  const { data: routines, isLoading } = useRoutines();
  const { data: stats } = useStats();
  const [q, setQ] = useState('');
  const [team, setTeam] = useState<string>('all');
  const [state, setState] = useState<'all' | RoutineState>('all');

  const teams = useMemo(() => {
    const map = new Map<string, { id: string; name: string; accent: string }>();
    routines?.forEach((r) => r.team && map.set(r.team.id, r.team));
    return [...map.values()];
  }, [routines]);

  const filtered = useMemo(() => {
    let list = (routines ?? []).slice();
    if (team !== 'all') list = list.filter((r) => r.team?.id === team);
    if (state !== 'all') list = list.filter((r) => r.state === state);
    if (q.trim()) {
      const s = q.toLowerCase();
      list = list.filter((r) =>
        (r.name + r.summary + r.tags.join(' ') + r.owner.name).toLowerCase().includes(s)
      );
    }
    list.sort((a: Routine, b: Routine) =>
      STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.name.localeCompare(b.name)
    );
    return list;
  }, [routines, team, state, q]);

  return (
    <Page>
      <PageHeader
        eyebrow="Switchboard"
        title="Fleet"
        subtitle="Every automation your team runs — one Markdown file each. See what's firing, what needs a human, and what's holding a PR."
        actions={
          <>
            <Button variant="secondary" size="md">
              <SlidersHorizontal className="h-4 w-4" /> Filters
            </Button>
            <Button variant="primary" size="md">
              <Plus className="h-4 w-4" /> New routine
            </Button>
          </>
        }
      />

      <StatStrip stats={stats} />

      {/* Filter bar */}
      <div className="mt-6 mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter the fleet…"
          className="h-8 w-56 rounded-md border border-line bg-surface px-3 text-sm text-fg placeholder:text-muted-2 focus-visible:border-brand/60 focus-visible:outline-none"
        />
        <div className="mx-1 h-5 w-px bg-line" />
        <Chip active={team === 'all'} onClick={() => setTeam('all')}>All teams</Chip>
        {teams.map((t) => (
          <Chip key={t.id} active={team === t.id} onClick={() => setTeam(t.id)}>
            {t.name}
          </Chip>
        ))}
        <div className="mx-1 h-5 w-px bg-line" />
        {STATE_FILTERS.map((f) => (
          <Chip key={f.key} active={state === f.key} onClick={() => setState(f.key)}>
            {f.label}
          </Chip>
        ))}
        <span className="ml-auto text-xs text-muted-2">
          {filtered.length} of {routines?.length ?? 0} routines
        </span>
      </div>

      {/* Board */}
      <Card className="overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1fr)_150px_120px_88px_auto] items-center gap-4 border-b border-line bg-surface/40 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-2">
          <span>Routine</span>
          <span>Last run</span>
          <span>Success · 7d</span>
          <span className="text-right">Next</span>
          <span className="w-[72px] text-right">Control</span>
        </div>

        {isLoading ? (
          <div className="divide-y divide-line-soft">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-sm text-muted">No routines match these filters.</p>
            <button onClick={() => { setQ(''); setTeam('all'); setState('all'); }} className="mt-2 text-sm text-brand-soft hover:underline">
              Clear filters
            </button>
          </div>
        ) : (
          <div>
            {filtered.map((r) => (
              <RoutineRow key={r.id} r={r} />
            ))}
          </div>
        )}
      </Card>
    </Page>
  );
}
