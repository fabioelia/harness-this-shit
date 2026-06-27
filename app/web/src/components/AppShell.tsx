import { NavLink, Outlet } from 'react-router-dom';
import { TooltipProvider, Tip } from '@/components/ui/tooltip';
import { useKillSwitch, useStats } from '@/lib/api';
import { cn } from '@/lib/utils';

const ICONS = {
  fleet: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="2.5" y="2.5" width="5" height="5" rx="1" /><rect x="10.5" y="2.5" width="5" height="5" rx="1" />
      <rect x="2.5" y="10.5" width="5" height="5" rx="1" /><rect x="10.5" y="10.5" width="5" height="5" rx="1" />
    </svg>
  ),
  runs: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <line x1="3" y1="5" x2="15" y2="5" /><line x1="3" y1="9" x2="12" y2="9" /><line x1="3" y1="13" x2="14" y2="13" />
    </svg>
  ),
  mcps: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="5" cy="5" r="2.4" /><circle cx="13" cy="13" r="2.4" /><line x1="6.8" y1="6.8" x2="11.2" y2="11.2" strokeLinecap="round" />
    </svg>
  ),
  audit: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="4" cy="5" r="1" /><line x1="7" y1="5" x2="15" y2="5" /><circle cx="4" cy="9" r="1" /><line x1="7" y1="9" x2="15" y2="9" /><circle cx="4" cy="13" r="1" /><line x1="7" y1="13" x2="15" y2="13" />
    </svg>
  ),
  config: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <line x1="3" y1="6" x2="15" y2="6" /><circle cx="11" cy="6" r="2" fill="#1a1712" /><line x1="3" y1="12" x2="15" y2="12" /><circle cx="7" cy="12" r="2" fill="#1a1712" />
    </svg>
  ),
  stop: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M9 2.5 V 8.5" /><path d="M4.7 5.2 a5.6 5.6 0 1 0 8.6 0" />
    </svg>
  ),
};

const NAV = [
  { to: '/', label: 'Fleet', icon: ICONS.fleet, end: true },
  { to: '/runs', label: 'Runs', icon: ICONS.runs },
  { to: '/connectors', label: 'Connectors', icon: ICONS.mcps },
  { to: '/activity', label: 'Activity', icon: ICONS.audit },
  { to: '/settings', label: 'Settings', icon: ICONS.config },
];

export function AppShell() {
  const { data: stats } = useStats();
  const kill = useKillSwitch();
  const halted = !!stats?.killSwitch;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-screen overflow-hidden bg-bg">
        {/* 64px icon rail */}
        <nav className="flex w-16 shrink-0 flex-col items-center gap-[3px] border-r border-line bg-surface py-4">
          <div className="mb-4 grid h-8 w-8 place-items-center rounded-[9px] bg-brand font-mono text-[16px] font-bold text-[#16130f]">S</div>
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cn(
                  'flex w-12 flex-col items-center gap-[5px] rounded-[11px] py-[9px] transition-colors',
                  isActive ? 'bg-white/[0.05] text-brand' : 'text-dim hover:text-t2'
                )
              }
            >
              {n.icon}
              <span className="font-display text-[8.5px] font-semibold tracking-[0.04em]">{n.label}</span>
            </NavLink>
          ))}
          <Tip label={halted ? 'Fleet halted — release the kill switch' : 'Emergency stop — halt every routine'} side="right">
            <button
              onClick={() => kill.mutate(!halted)}
              className={cn(
                'mt-auto flex w-12 flex-col items-center gap-[5px] rounded-[11px] py-[9px] transition-colors',
                halted ? 'bg-bad/15 text-bad animate-sbpulse' : 'text-bad/90 hover:text-bad'
              )}
            >
              {ICONS.stop}
              <span className="font-display text-[8.5px] font-semibold tracking-[0.04em]">Stop</span>
            </button>
          </Tip>
        </nav>

        {/* content */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          {halted && (
            <div className="flex items-center justify-center gap-2 border-b border-bad/30 bg-bad/10 py-1.5 text-[12px] text-bad">
              {ICONS.stop} Org-wide kill switch engaged — no routine will dispatch until released.
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </TooltipProvider>
  );
}
