import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutGrid,
  ListChecks,
  Cable,
  ScrollText,
  Settings,
  Search,
  OctagonX,
  Plus,
  ChevronDown,
  type LucideIcon,
} from 'lucide-react';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { Tip, TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useStats, useKillSwitch } from '@/lib/api';

const NAV: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: '/', label: 'Fleet', icon: LayoutGrid, end: true },
  { to: '/runs', label: 'Runs', icon: ListChecks },
  { to: '/connectors', label: 'Connectors', icon: Cable },
  { to: '/activity', label: 'Activity', icon: ScrollText },
];

function NavItem({ to, label, icon: Icon, end, badge }: (typeof NAV)[number] & { badge?: number }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          isActive ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface hover:text-fg'
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            className={cn('h-[18px] w-[18px] transition-colors', isActive ? 'text-brand-soft' : 'text-muted-2 group-hover:text-muted')}
            strokeWidth={2}
          />
          <span>{label}</span>
          {badge ? (
            <span className="ml-auto rounded-full bg-warn/15 px-1.5 py-0.5 text-[10px] font-semibold text-warn">{badge}</span>
          ) : null}
        </>
      )}
    </NavLink>
  );
}

export function AppShell() {
  const { data: stats } = useStats();
  const kill = useKillSwitch();
  const navigate = useNavigate();

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex h-screen overflow-hidden">
        {/* Sidebar */}
        <aside className="flex w-[232px] shrink-0 flex-col border-r border-line bg-panel/60">
          <div className="flex items-center gap-2.5 px-5 py-4">
            <Logo />
            <div className="leading-tight">
              <div className="font-display text-[15px] font-semibold tracking-tight text-fg">Switchboard</div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-2">routine harness</div>
            </div>
          </div>

          <button className="mx-3 mb-2 flex items-center gap-2 rounded-md border border-line-soft bg-surface px-3 py-2 text-left transition-colors hover:border-line">
            <span className="grid h-6 w-6 place-items-center rounded bg-brand/15 text-[11px] font-bold text-brand-soft">
              {(stats?.org || 'N')[0]}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-fg">{stats?.org || 'Organization'}</div>
              <div className="text-[10px] text-muted-2">Platform · QA · Solutions</div>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-muted-2" />
          </button>

          <nav className="flex flex-1 flex-col gap-0.5 px-3 py-2">
            {NAV.map((n) => (
              <NavItem key={n.to} {...n} badge={n.to === '/' ? stats?.needsHuman : undefined} />
            ))}
            <div className="mt-auto">
              <NavItem to="/settings" label="Settings" icon={Settings} />
            </div>
          </nav>

          <div className="border-t border-line px-4 py-3 text-[11px] text-muted-2">
            <div className="flex items-center justify-between">
              <span>{stats ? `${stats.enabled}/${stats.total} enabled` : '—'}</span>
              <span className="font-mono">v0.1</span>
            </div>
          </div>
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Topbar */}
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-panel/40 px-5 backdrop-blur">
            <label className="relative flex-1 max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2" />
              <input
                placeholder="Search routines, runs, PRs…"
                onKeyDown={(e) => e.key === 'Enter' && navigate('/')}
                className="h-9 w-full rounded-md border border-line bg-surface pl-9 pr-3 text-sm text-fg placeholder:text-muted-2 focus-visible:border-brand/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/15"
              />
            </label>

            <div className="ml-auto flex items-center gap-2.5">
              <Tip label={stats?.killSwitch ? 'Fleet halted — click to resume' : 'Emergency stop — halt every routine'}>
                <Button
                  variant={stats?.killSwitch ? 'danger' : 'subtle'}
                  size="sm"
                  onClick={() => kill.mutate(!stats?.killSwitch)}
                  className={cn(stats?.killSwitch && 'animate-pulse')}
                >
                  <OctagonX className="h-4 w-4" />
                  {stats?.killSwitch ? 'Halted' : 'Stop'}
                </Button>
              </Tip>
              <Button variant="primary" size="sm">
                <Plus className="h-4 w-4" />
                New routine
              </Button>
              <div className="ml-1">
                <Avatar name="Fabio Elia" accent="#8B7CFF" size={28} />
              </div>
            </div>
          </header>

          {stats?.killSwitch && (
            <div className="flex items-center gap-2 border-b border-bad/30 bg-bad/10 px-5 py-1.5 text-xs text-bad">
              <OctagonX className="h-3.5 w-3.5" />
              Org-wide kill switch engaged — no routine will dispatch until released.
            </div>
          )}

          {/* Routed content */}
          <main className="min-h-0 flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
