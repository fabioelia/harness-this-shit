import { Link, useNavigate } from 'react-router-dom';
import { MoreHorizontal, Play, FileCode2, ArrowUpRight, Power, Cable, Eye } from 'lucide-react';
import type { Routine } from '@/types';
import { StateSignal, RunStatusPill } from '@/components/status';
import { TriggerChip } from '@/components/TriggerChip';
import { SuccessBar } from '@/components/SuccessBar';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { relativeTime } from '@/lib/format';
import { useToggleRoutine, useDispatchRoutine } from '@/lib/api';
import { cn } from '@/lib/utils';

export function RoutineRow({ r }: { r: Routine }) {
  const toggle = useToggleRoutine();
  const dispatch = useDispatchRoutine();
  const navigate = useNavigate();

  return (
    <div
      className={cn(
        'group grid items-center gap-4 border-b border-line-soft px-4 py-3 transition-colors last:border-0 hover:bg-surface/40',
        'grid-cols-[minmax(0,1fr)_150px_120px_88px_auto]',
        !r.enabled && 'opacity-60'
      )}
    >
      {/* Identity + triggers */}
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <StateSignal state={r.state} withLabel={false} />
          <Link
            to={`/routines/${r.slug}`}
            className="truncate font-display text-[15px] font-medium text-fg decoration-brand/40 underline-offset-4 hover:underline"
          >
            {r.name}
          </Link>
          {r.team && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium"
              style={{ borderColor: `${r.team.accent}33`, background: `${r.team.accent}12`, color: r.team.accent }}
            >
              {r.team.name}
            </span>
          )}
          {r.risk === 'write' && (
            <Tip label="Mutates shared targets (pushes commits / writes). Subject to write-consent + leases.">
              <Badge tone="warn" className="cursor-default">write</Badge>
            </Tip>
          )}
          {r.lease && (
            <Tip label={`Holding a lease on ${r.lease.resource} — no other routine can touch it. Expires ${relativeTime(r.lease.expires_at)}.`}>
              <span className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-brand-soft">
                <Cable className="h-3 w-3" /> {r.lease.resource.replace('pr:newton', 'PR ')}
              </span>
            </Tip>
          )}
          {r.watching > 0 && (
            <Tip label={`Following ${r.watching} PR${r.watching > 1 ? 's' : ''} it opened — reacting to CI / reviews.`}>
              <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted">
                <Eye className="h-3 w-3" /> {r.watching}
              </span>
            </Tip>
          )}
        </div>
        <p className="mt-1 line-clamp-1 pr-6 text-[13px] text-muted">{r.summary}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Tip label={`Owner: ${r.owner.name}`}>
            <span><Avatar name={r.owner.name} accent={r.owner.accent} size={18} /></span>
          </Tip>
          {r.triggers.slice(0, 3).map((t, i) => (
            <TriggerChip key={i} trigger={t} />
          ))}
          {r.triggers.length > 3 && (
            <span className="text-[11px] text-muted-2">+{r.triggers.length - 3}</span>
          )}
        </div>
      </div>

      {/* Last run */}
      <div className="min-w-0">
        {r.lastRun ? (
          <Link to={`/routines/${r.slug}`} className="block">
            <RunStatusPill status={r.lastRun.status} />
            <div className="mt-0.5 text-[11px] text-muted-2">{relativeTime(r.lastRun.startedAt)}</div>
          </Link>
        ) : (
          <span className="text-xs text-muted-2">never run</span>
        )}
      </div>

      {/* Success */}
      <div>
        <SuccessBar rate={r.successRate} />
        <div className="mt-1 text-[11px] text-muted-2">{r.runs7d} runs · 7d</div>
      </div>

      {/* Next run */}
      <div className="text-right">
        {r.nextRunAt ? (
          <>
            <div className="tabular text-xs font-medium text-fg">{relativeTime(r.nextRunAt)}</div>
            <div className="text-[11px] text-muted-2">scheduled</div>
          </>
        ) : (
          <div className="text-[11px] text-muted-2">event-driven</div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1.5">
        <Tip label={r.enabled ? 'Enabled — fires on its triggers' : 'Disabled — will not fire'}>
          <span>
            <Switch
              checked={r.enabled}
              onCheckedChange={(v) => toggle.mutate({ slug: r.slug, enabled: v })}
            />
          </span>
        </Tip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Routine actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{r.name}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => dispatch.mutate(r.slug)}>
              <Play className="h-4 w-4 text-ok" /> Run now
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate(`/routines/${r.slug}`)}>
              <ArrowUpRight className="h-4 w-4 text-muted" /> Open routine
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate(`/routines/${r.slug}`)}>
              <FileCode2 className="h-4 w-4 text-muted" /> View .routine.md
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => toggle.mutate({ slug: r.slug, enabled: !r.enabled })}>
              <Power className="h-4 w-4" /> {r.enabled ? 'Disable' : 'Enable'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
