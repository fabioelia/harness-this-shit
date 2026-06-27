import { useActivity } from '@/lib/api';
import { Dot, Empty } from '@/components/sb';

export function ActivityPage() {
  const { data: activity } = useActivity();
  return (
    <div className="font-sans text-fg animate-fade-up">
      <div className="border-b border-line-soft bg-head px-[26px] py-[22px]">
        <div className="mb-3 font-mono text-[12px] font-medium text-dim"><span className="text-brand">Switchboard</span> › Activity</div>
        <div className="font-display text-[23px] font-bold tracking-tight">Activity</div>
        <div className="mt-1 text-[13px] text-muted-2">The live event log — runs that fired, and dispatch decisions (skips, kill-switch drops).</div>
      </div>
      <div className="mx-auto max-w-[860px] px-[26px] py-6">
        <div className="mb-3 flex items-center gap-2">
          <Dot color="#5fbf86" size={8} pulse />
          <span className="font-display text-[11px] font-semibold uppercase tracking-[0.1em] text-t2">Live activity</span>
        </div>
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          {activity && activity.length === 0 && <Empty title="No activity yet" hint="Runs, dispatch decisions, skips, and reaction watches land here as they happen." />}
          {activity?.map((a, i) => (
            <div key={i} className="flex items-start gap-3 border-b border-line-soft px-[18px] py-[13px] last:border-0">
              <span className="mt-1 shrink-0"><Dot state={a.state} size={8} /></span>
              <div className="min-w-0 flex-1">
                <div className="font-sans text-[12.5px] font-medium leading-[1.4] text-t2">{a.text}</div>
                <div className="mt-0.5 font-mono text-[10.5px] font-medium text-dim-3">{a.time}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
