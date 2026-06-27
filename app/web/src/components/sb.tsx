// Design-system primitives ported 1:1 from Switchboard Fleet.dc.html (support.js).
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/utils';

export const SIGNAL = {
  success: '#5fbf86',
  running: '#5b9ee6',
  queued: '#9a93a6',
  needs_human: '#e6b052',
  failing: '#e5736b',
  disabled: '#5d594f',
  lease: '#b49ae6',
  idle: '#7f8a80',
} as const;

export type StateKey = keyof typeof SIGNAL;

const STATE_META: Record<string, { label: string; color: string; pulse?: boolean }> = {
  idle: { label: 'Idle', color: SIGNAL.idle },
  success: { label: 'Success', color: SIGNAL.success },
  running: { label: 'Running', color: SIGNAL.running, pulse: true },
  queued: { label: 'Queued', color: SIGNAL.queued },
  needs_human: { label: 'Needs human', color: SIGNAL.needs_human },
  lease: { label: 'Holding lease', color: SIGNAL.lease },
  disabled: { label: 'Disabled', color: SIGNAL.disabled },
  failing: { label: 'Failing', color: SIGNAL.failing },
};
export const stateMeta = (s: string) => STATE_META[s] ?? STATE_META.idle;

export function Dot({ state, color, size = 9, pulse }: { state?: string; color?: string; size?: number; pulse?: boolean }) {
  const m = state ? stateMeta(state) : null;
  const c = color ?? m?.color ?? SIGNAL.idle;
  const p = pulse ?? m?.pulse ?? false;
  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: c,
        boxShadow: p ? `0 0 0 3px ${c}2e` : 'none',
        flex: '0 0 auto',
      }}
      className={p ? 'animate-sbpulse' : undefined}
    />
  );
}

export function Pill({ label, color }: { label: React.ReactNode; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-display font-semibold"
      style={{ padding: '3px 9px 3px 7px', fontSize: 11.5, color, background: `${color}1a`, border: `1px solid ${color}33` }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {label}
    </span>
  );
}

export function StatePill({ state }: { state: string }) {
  const m = stateMeta(state);
  return <Pill label={m.label} color={m.color} />;
}

/** 14-bar history sparkline. hist entries are state keys, or '_' for empty. */
export function Spark({ hist, h = 16 }: { hist: string[]; h?: number }) {
  return (
    <span className="inline-flex items-end gap-[2px]">
      {hist.map((st, i) => (
        <span
          key={i}
          style={{
            display: 'inline-block',
            width: 3,
            height: h,
            borderRadius: 1.5,
            background: st === '_' ? 'rgba(255,255,255,.09)' : (SIGNAL as Record<string, string>)[st] ?? SIGNAL.idle,
          }}
        />
      ))}
    </span>
  );
}

/** Deterministic history from success-rate + state + seed (ports mkHist). */
export function makeHist(pct: number | null, state: string, seed: number): string[] {
  const n = 14;
  const a: string[] = [];
  let s = seed * 7 + 19;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let i = 0; i < n; i++) a.push(rnd() * 100 > 100 - (pct == null ? 100 : pct) ? 'success' : 'failing');
  if (state === 'disabled') for (let i = 0; i < n; i++) a[i] = '_';
  if (state === 'running' || state === 'lease') a[n - 1] = 'running';
  return a;
}

export function Sbar({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="font-mono text-[11.5px] text-dim-3">no data</span>;
  const col = pct >= 90 ? SIGNAL.success : pct >= 75 ? '#5b9ee6' : SIGNAL.failing;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative overflow-hidden rounded-[3px]" style={{ width: 58, height: 5, background: 'rgba(255,255,255,.09)' }}>
        <span className="absolute left-0 top-0 bottom-0 rounded-[3px]" style={{ width: `${pct}%`, background: col }} />
      </span>
      <span className="font-mono text-[11.5px]" style={{ color: '#ada695', minWidth: 30 }}>{pct}%</span>
    </span>
  );
}

export function Avatar({ color, initials, size = 24 }: { color: string; initials: string; size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center font-mono font-bold"
      style={{ width: size, height: size, borderRadius: '50%', background: color, color: '#16130f', fontSize: size * 0.42, flex: '0 0 auto' }}
    >
      {initials}
    </span>
  );
}

export function initialsOf(name: string) {
  const p = name.trim().split(/\s+/);
  return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase();
}

export function Toggle({ on, onCheckedChange }: { on: boolean; onCheckedChange?: (v: boolean) => void }) {
  return (
    <SwitchPrimitive.Root
      checked={on}
      onCheckedChange={onCheckedChange}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center rounded-full transition-colors data-[state=unchecked]:justify-start data-[state=checked]:justify-end focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      style={{ width: 30, height: 17, padding: 2, background: on ? '#5b9ee6' : 'rgba(255,255,255,.13)', flex: '0 0 auto' }}
    >
      <SwitchPrimitive.Thumb
        className="block rounded-full"
        style={{ width: 13, height: 13, background: on ? '#16130f' : '#a39d8f' }}
      />
    </SwitchPrimitive.Root>
  );
}

/** On-brand empty state for tables/lists with no data yet. */
export function Empty({ title, hint }: { title: string; hint?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <span className="grid place-items-center rounded-[10px] border border-dashed text-dim-2" style={{ width: 38, height: 38, borderColor: '#3a342c' }}>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4">
          <rect x="2.5" y="4.5" width="13" height="9.5" rx="1.5" /><line x1="2.5" y1="7.5" x2="15.5" y2="7.5" /><line x1="6" y1="2.5" x2="6" y2="4.5" /><line x1="12" y1="2.5" x2="12" y2="4.5" />
        </svg>
      </span>
      <div className="font-display text-[14px] font-semibold text-t2">{title}</div>
      {hint && <div className="max-w-md font-sans text-[12.5px] leading-[1.5] text-dim-2">{hint}</div>}
    </div>
  );
}

/** Trigger chip — mono, subtle. */
export function Chip({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'copper' | 'blue' }) {
  const styles =
    tone === 'copper'
      ? { color: '#d8b486', background: 'rgba(232,155,60,.07)', border: '1px solid rgba(232,155,60,.2)' }
      : tone === 'blue'
        ? { color: '#5b9ee6', background: 'rgba(91,158,230,.08)', border: '1px solid rgba(91,158,230,.22)' }
        : { color: '#ada695', background: 'rgba(255,255,255,.045)', border: '1px solid rgba(255,255,255,.08)' };
  return (
    <span className="whitespace-nowrap rounded-[5px] font-mono font-medium" style={{ ...styles, fontSize: 11, padding: '2px 7px' }}>
      {children}
    </span>
  );
}
