import { Clock, Play, GitPullRequest, Wrench, CornerDownRight, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { Reaction, Trigger } from '@/types';
import { TriggerChip } from '@/components/TriggerChip';
import { cn } from '@/lib/utils';

function Cable({ label }: { label?: string }) {
  return (
    <div className="relative flex min-w-[34px] flex-1 flex-col items-center justify-center">
      <div className="h-px w-full bg-gradient-to-r from-line via-brand/40 to-line" />
      {label && (
        <span className="absolute -top-4 whitespace-nowrap text-[9px] uppercase tracking-wide text-muted-2">
          {label}
        </span>
      )}
    </div>
  );
}

function Node({
  icon: Icon,
  title,
  sub,
  tone = 'neutral',
}: {
  icon: typeof Play;
  title: React.ReactNode;
  sub?: React.ReactNode;
  tone?: 'neutral' | 'brand' | 'run' | 'warn' | 'ok';
}) {
  const ring = {
    neutral: 'border-line',
    brand: 'border-brand/40',
    run: 'border-run/40',
    warn: 'border-warn/40',
    ok: 'border-ok/40',
  }[tone];
  const ic = {
    neutral: 'text-muted',
    brand: 'text-brand-soft',
    run: 'text-run',
    warn: 'text-warn',
    ok: 'text-ok',
  }[tone];
  return (
    <div className={cn('flex items-center gap-2.5 rounded-lg border bg-surface px-3 py-2 shadow-card', ring)}>
      <Icon className={cn('h-4 w-4 shrink-0', ic)} />
      <div className="leading-tight">
        <div className="whitespace-nowrap text-[13px] font-medium text-fg">{title}</div>
        {sub && <div className="whitespace-nowrap text-[10px] text-muted-2">{sub}</div>}
      </div>
    </div>
  );
}

function ReactionBranch({ r }: { r: Reaction }) {
  const isTerminal = r.doLabel === 'done';
  return (
    <div className="flex items-center gap-2">
      <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-muted-2" />
      <span className="rounded border border-line-soft bg-bg px-1.5 py-0.5 font-mono text-[10px] text-warn">
        {r.whenLabel}
      </span>
      <span className="text-muted-2">→</span>
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px]',
          isTerminal ? 'border-ok/30 bg-ok/10 text-ok' : 'border-brand/30 bg-brand/10 text-brand-soft'
        )}
      >
        {isTerminal ? <CheckCircle2 className="h-2.5 w-2.5" /> : <Wrench className="h-2.5 w-2.5" />}
        {r.doLabel}
      </span>
      {r.budget && (
        <span className="text-[10px] text-muted-2">budget {r.budget}</span>
      )}
    </div>
  );
}

export function FlowDiagram({
  name,
  triggers,
  reactions,
  statusSurface,
}: {
  name: string;
  triggers: Trigger[];
  reactions: Reaction[];
  statusSurface: string;
}) {
  const hasFlow = reactions.length > 0;
  return (
    <div>
      {/* Linear flow: On → Run → (Follows | Surface) */}
      <div className="flex items-stretch gap-1 overflow-x-auto pb-2">
        <div className="flex flex-col justify-center gap-1.5">
          <div className="mb-1 text-[9px] uppercase tracking-wide text-muted-2">On</div>
          {triggers.map((t, i) => (
            <TriggerChip key={i} trigger={t} />
          ))}
        </div>

        <Cable label="fires" />

        <div className="flex shrink-0 flex-col justify-center">
          <div className="mb-1 text-[9px] uppercase tracking-wide text-muted-2">Run</div>
          <Node icon={Play} title={name} sub="claude -p · isolated checkout" tone="run" />
        </div>

        {hasFlow ? (
          <>
            <Cable label="opens PR" />
            <div className="flex shrink-0 flex-col justify-center">
              <div className="mb-1 text-[9px] uppercase tracking-wide text-muted-2">Follows</div>
              <Node icon={GitPullRequest} title="Subscribes to the PR" sub="auto-unsubscribe on merge" tone="brand" />
            </div>
          </>
        ) : (
          <>
            <Cable label="emits" />
            <div className="flex shrink-0 flex-col justify-center">
              <div className="mb-1 text-[9px] uppercase tracking-wide text-muted-2">Surface</div>
              <Node
                icon={statusSurface === 'pr-comment' ? GitPullRequest : Clock}
                title="Status surface"
                sub="idempotent · upserted (no spam)"
                tone="neutral"
              />
            </div>
          </>
        )}
      </div>

      {/* Reactions — full-width row so nothing clips */}
      {hasFlow && (
        <div className="mt-2 rounded-lg border border-dashed border-line bg-panel/50 p-3">
          <div className="mb-2 text-[9px] uppercase tracking-wide text-muted-2">
            Then react to events on the PR
          </div>
          <div className="flex flex-col gap-1.5">
            {reactions.map((r, i) => (
              <ReactionBranch key={i} r={r} />
            ))}
          </div>
          <p className="mt-2.5 flex items-center gap-1.5 border-t border-line-soft pt-2 text-[11px] text-muted-2">
            <AlertTriangle className="h-3 w-3 shrink-0 text-warn" />
            Each reaction is a PR-scoped run under the same lease, SHA barrier, and per-handler budget.
          </p>
        </div>
      )}
    </div>
  );
}
