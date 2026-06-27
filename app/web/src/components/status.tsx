import { cn } from '@/lib/utils';
import type { RoutineState, RunStatus } from '@/types';

type Tone = 'ok' | 'run' | 'warn' | 'bad' | 'neutral' | 'brand';

const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-ok',
  run: 'text-run',
  warn: 'text-warn',
  bad: 'text-bad',
  neutral: 'text-muted',
  brand: 'text-brand-soft',
};
const TONE_DOT: Record<Tone, string> = {
  ok: 'bg-ok',
  run: 'bg-run',
  warn: 'bg-warn',
  bad: 'bg-bad',
  neutral: 'bg-neutral',
  brand: 'bg-brand',
};
const TONE_HEX: Record<Tone, string> = {
  ok: '#3DD68C',
  run: '#5B9DFF',
  warn: '#F5B544',
  bad: '#FF6B6B',
  neutral: '#6B7689',
  brand: '#8B7CFF',
};

export const ROUTINE_STATE: Record<RoutineState, { label: string; tone: Tone; live?: boolean }> = {
  running: { label: 'Running', tone: 'run', live: true },
  queued: { label: 'Queued', tone: 'run' },
  idle: { label: 'Idle', tone: 'neutral' },
  needs_human: { label: 'Needs human', tone: 'warn', live: true },
  failing: { label: 'Failing', tone: 'bad' },
  disabled: { label: 'Disabled', tone: 'neutral' },
};

export const RUN_STATUS: Record<RunStatus, { label: string; tone: Tone; live?: boolean }> = {
  succeeded: { label: 'Succeeded', tone: 'ok' },
  failed: { label: 'Failed', tone: 'bad' },
  running: { label: 'Running', tone: 'run', live: true },
  queued: { label: 'Queued', tone: 'run' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  needs_human: { label: 'Needs human', tone: 'warn' },
  canceled: { label: 'Canceled', tone: 'neutral' },
};

/** The signature element: a live patch-bay signal indicating a routine's state. */
export function Signal({
  tone,
  live,
  hollow,
  size = 8,
}: {
  tone: Tone;
  live?: boolean;
  hollow?: boolean;
  size?: number;
}) {
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      {live && (
        <span
          className={cn('absolute inset-0 rounded-full animate-pulse-ring', TONE_DOT[tone])}
          style={{ opacity: 0.5 }}
        />
      )}
      <span
        className={cn('relative rounded-full', hollow ? 'border-2 bg-transparent' : TONE_DOT[tone])}
        style={{
          width: size,
          height: size,
          borderColor: hollow ? TONE_HEX[tone] : undefined,
          boxShadow: hollow ? undefined : `0 0 8px 0 ${TONE_HEX[tone]}66`,
        }}
      />
    </span>
  );
}

export function StateSignal({ state, withLabel = true }: { state: RoutineState; withLabel?: boolean }) {
  const m = ROUTINE_STATE[state];
  return (
    <span className={cn('inline-flex items-center gap-2 text-xs font-medium', TONE_TEXT[m.tone])}>
      <Signal tone={m.tone} live={m.live} hollow={state === 'disabled'} />
      {withLabel && <span>{m.label}</span>}
    </span>
  );
}

export function RunStatusPill({ status, withLabel = true }: { status: RunStatus; withLabel?: boolean }) {
  const m = RUN_STATUS[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', TONE_TEXT[m.tone])}>
      <Signal tone={m.tone} live={m.live} size={7} />
      {withLabel && <span>{m.label}</span>}
    </span>
  );
}
