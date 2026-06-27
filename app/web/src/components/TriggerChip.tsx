import {
  Clock,
  Github,
  Hash,
  Siren,
  MousePointerClick,
  Webhook,
  ArrowRightLeft,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Trigger } from '@/types';
import { Tip } from '@/components/ui/tooltip';

const ICON: Record<Trigger['type'], LucideIcon> = {
  schedule: Clock,
  github: Github,
  slack: Hash,
  sentry: Siren,
  manual: MousePointerClick,
  api: Webhook,
  webhook: Webhook,
  after: ArrowRightLeft,
};

export function TriggerChip({ trigger, className }: { trigger: Trigger; className?: string }) {
  const Icon = ICON[trigger.type] ?? Webhook;
  const chip = (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-line-soft bg-surface px-1.5 py-0.5 text-[11px] text-muted',
        'transition-colors hover:border-line hover:text-fg',
        className
      )}
    >
      <Icon className="h-3 w-3 text-muted-2" strokeWidth={2} />
      <span className="font-mono">{trigger.label}</span>
    </span>
  );
  return trigger.detail ? <Tip label={trigger.detail}>{chip}</Tip> : chip;
}
