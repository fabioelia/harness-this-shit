import { Link } from 'react-router-dom';
import { Power, PenLine, Play, KeyRound, ShieldAlert, OctagonX, Dot } from 'lucide-react';
import { Page, PageHeader } from '@/components/page';
import { Card } from '@/components/ui/card';
import { Avatar } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { useActivity } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import type { LucideIcon } from 'lucide-react';

function iconFor(action: string): { Icon: LucideIcon; tone: string } {
  if (action.includes('kill')) return { Icon: OctagonX, tone: 'text-bad' };
  if (action.startsWith('enabled')) return { Icon: Power, tone: 'text-ok' };
  if (action.startsWith('disabled')) return { Icon: Power, tone: 'text-muted' };
  if (action.startsWith('edited')) return { Icon: PenLine, tone: 'text-brand-soft' };
  if (action.startsWith('dispatched')) return { Icon: Play, tone: 'text-run' };
  if (action.startsWith('granted')) return { Icon: KeyRound, tone: 'text-warn' };
  return { Icon: ShieldAlert, tone: 'text-muted' };
}

export function ActivityPage() {
  const { data: entries, isLoading } = useActivity();

  return (
    <Page className="max-w-[900px]">
      <PageHeader
        eyebrow="Switchboard"
        title="Activity"
        subtitle="The audit trail — every change to the fleet, who made it, and why."
      />
      <Card className="p-2">
        {isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
          </div>
        ) : (
          <ul className="divide-y divide-line-soft">
            {entries?.map((e) => {
              const { Icon, tone } = iconFor(e.action);
              return (
                <li key={e.id} className="flex items-center gap-3 px-3 py-3">
                  <Avatar name={e.actor === 'you' ? 'You' : e.actor} size={28} accent="#5B9DFF" />
                  <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-surface-2">
                    <Icon className={`h-4 w-4 ${tone}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-fg">
                      <span className="font-medium">{e.actor === 'you' ? 'You' : e.actor}</span>{' '}
                      <span className="text-muted">{e.action}</span>{' '}
                      {e.target !== 'org' ? (
                        <Link to={`/routines/${e.target}`} className="font-medium text-brand-soft hover:underline">
                          {e.target}
                        </Link>
                      ) : (
                        <span className="font-medium text-fg">the fleet</span>
                      )}
                    </p>
                    {e.detail && (
                      <p className="flex items-center gap-1 text-[12px] text-muted-2">
                        <Dot className="h-3 w-3" /> {e.detail}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-[11px] text-muted-2">{relativeTime(e.ts)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </Page>
  );
}
