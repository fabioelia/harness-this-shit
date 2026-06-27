import { Empty, Toggle } from '@/components/sb';

const POLICIES = [
  ['UI edits commit via pull request', 'Routine edits in the web editor open a PR instead of pushing to the branch.', true],
  ['Write routines require opt-in consent', 'A routine may only push to a PR carrying the auto-cleanup label.', true],
  ['merge-pr capability denied org-wide', 'No routine may merge a pull request, regardless of grant.', true],
  ['Approval gate for first-time write routines', 'A maintainer approves the first run of any routine that mutates shared targets.', false],
] as const;

export function SettingsPage() {
  return (
    <div className="font-sans text-fg animate-fade-up">
      <div className="border-b border-line-soft bg-head px-[26px] py-[22px]">
        <div className="mb-3 font-mono text-[12px] font-medium text-dim"><span className="text-brand">Switchboard</span> › Config</div>
        <div className="font-display text-[23px] font-bold tracking-tight">Settings</div>
        <div className="mt-1 text-[13px] text-muted-2">Team membership, roles, and the org-wide policy that bounds every routine.</div>
      </div>
      <div className="mx-auto max-w-[960px] px-[26px] py-6">
        <div className="mb-2 font-display text-[11px] font-semibold uppercase tracking-[0.1em] text-dim-2">Team &amp; roles</div>
        <div className="mb-7 overflow-hidden rounded-xl border border-line bg-surface">
          <Empty title="No members yet" hint="Invite your team and assign roles (Admin · Maintainer · Operator · Viewer) to control who can edit and run routines." />
        </div>

        <div className="mb-2 font-display text-[11px] font-semibold uppercase tracking-[0.1em] text-dim-2">Org policy · guardrails</div>
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          {POLICIES.map(([title, desc, on]) => (
            <div key={title} className="flex items-center gap-3 border-b border-line-soft px-5 py-3.5 last:border-0">
              <div className="flex-1">
                <div className="font-display text-[13px] font-semibold text-fg">{title}</div>
                <div className="text-[12px] text-muted-2">{desc}</div>
              </div>
              <Toggle on={on} />
            </div>
          ))}
          <div className="px-5 py-3.5 text-[12px] text-dim-2">Policy is the ceiling — individual routines can be stricter, never looser.</div>
        </div>
      </div>
    </div>
  );
}
