import { Link } from 'react-router-dom';
import { GitPullRequest } from 'lucide-react';
import { Page, PageHeader } from '@/components/page';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { RunStatusPill } from '@/components/status';
import { Tip } from '@/components/ui/tooltip';
import { useRuns } from '@/lib/api';
import { duration, money, relativeTime } from '@/lib/format';

const DECISION_TONE: Record<string, string> = {
  'lease-held': 'text-muted',
  'budget-exhausted': 'text-warn',
  admit: 'text-muted-2',
};

export function RunsPage() {
  const { data: runs, isLoading } = useRuns(60);

  return (
    <Page>
      <PageHeader
        eyebrow="Switchboard"
        title="Runs"
        subtitle="Every execution across the fleet — what triggered it, what it touched, and the dispatcher's decision."
      />
      <Card className="overflow-hidden">
        <div className="grid grid-cols-[130px_minmax(0,1fr)_150px_84px_92px_80px] items-center gap-3 border-b border-line bg-surface/40 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-2">
          <span>Status</span>
          <span>Routine · summary</span>
          <span>Target</span>
          <span className="text-right">Duration</span>
          <span className="text-right">Started</span>
          <span className="text-right">Cost</span>
        </div>

        {isLoading ? (
          <div className="space-y-px">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="px-4 py-3"><Skeleton className="h-5 w-full" /></div>
            ))}
          </div>
        ) : (
          <div>
            {runs?.map((run) => (
              <div
                key={run.id}
                className="grid grid-cols-[130px_minmax(0,1fr)_150px_84px_92px_80px] items-center gap-3 border-b border-line-soft px-4 py-2.5 text-sm transition-colors last:border-0 hover:bg-surface/40"
              >
                <div>
                  <RunStatusPill status={run.status} />
                  {run.decision && run.decision !== 'admit' && (
                    <div className={`mt-0.5 font-mono text-[10px] ${DECISION_TONE[run.decision] ?? 'text-muted-2'}`}>
                      {run.decision}
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <Link
                    to={`/routines/${run.routine?.slug}`}
                    className="font-medium text-fg hover:text-brand-soft"
                  >
                    {run.routine?.name ?? 'unknown'}
                  </Link>
                  {run.summary && <p className="line-clamp-1 text-[12px] text-muted">{run.summary}</p>}
                </div>
                <div className="min-w-0">
                  {run.target ? (
                    <Tip label={run.pushed_sha ? `Pushed ${run.pushed_sha}` : 'Targeted, no push'}>
                      <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted">
                        <GitPullRequest className="h-3 w-3 text-muted-2" />
                        {run.target.replace('pr:newton', '')}
                      </span>
                    </Tip>
                  ) : (
                    <span className="text-[11px] text-muted-2">—</span>
                  )}
                </div>
                <div className="tabular text-right text-[12px] text-muted">{duration(run.duration_sec)}</div>
                <div className="text-right text-[12px] text-muted-2">{relativeTime(run.started_at)}</div>
                <div className="tabular text-right text-[12px] text-muted">{money(run.cost)}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </Page>
  );
}
