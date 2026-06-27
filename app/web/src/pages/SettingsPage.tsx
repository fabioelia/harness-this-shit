import { Avatar, Pill, Toggle, SIGNAL, initialsOf } from '@/components/sb';

const ROLES = [
  { name: 'Fabio Elia', handle: 'fabio', role: 'Admin', team: 'platform', color: '#d98a5c' },
  { name: 'Steven Bennett', handle: 'steven', role: 'Maintainer', team: 'platform', color: '#c9a24a' },
  { name: 'Maya Okafor', handle: 'maya', role: 'Maintainer', team: 'infra', color: '#6fae9a' },
  { name: 'Leo Park', handle: 'leo', role: 'Operator', team: 'web', color: '#7f9bd1' },
  { name: 'Priya Nair', handle: 'priya', role: 'Viewer', team: 'web', color: '#b59ad6' },
];
const ROLE_COLOR: Record<string, string> = { Admin: SIGNAL.running, Maintainer: SIGNAL.lease, Operator: SIGNAL.success, Viewer: SIGNAL.idle };

const POLICIES = [
  ['UI edits commit via pull request', 'Routine edits in the web editor open a PR instead of pushing to the branch.', true],
  ['Write routines require opt-in consent', 'A routine may only push to a PR carrying the auto-cleanup label.', true],
  ['merge-pr capability denied org-wide', 'No routine may merge a pull request, regardless of grant.', true],
  ['Approval gate for first-time write routines', 'A maintainer approves the first run of any routine that mutates shared targets.', false],
];

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
          {ROLES.map((m) => (
            <div key={m.handle} className="flex items-center gap-3 border-b border-line-soft px-5 py-3 last:border-0">
              <Avatar color={m.color} initials={initialsOf(m.name)} size={30} />
              <div className="flex-1">
                <div className="font-display text-[13px] font-semibold text-fg-2">{m.name}</div>
                <div className="font-mono text-[11px] font-medium text-dim">@{m.handle} · {m.team}</div>
              </div>
              <Pill label={m.role} color={ROLE_COLOR[m.role]} />
            </div>
          ))}
        </div>

        <div className="mb-2 font-display text-[11px] font-semibold uppercase tracking-[0.1em] text-dim-2">Org policy · guardrails</div>
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          {POLICIES.map(([title, desc, on]) => (
            <div key={title as string} className="flex items-center gap-3 border-b border-line-soft px-5 py-3.5 last:border-0">
              <div className="flex-1">
                <div className="font-display text-[13px] font-semibold text-fg">{title}</div>
                <div className="text-[12px] text-muted-2">{desc}</div>
              </div>
              <Toggle on={on as boolean} />
            </div>
          ))}
          <div className="px-5 py-3.5 text-[12px] text-dim-2">Policy is the ceiling — individual routines can be stricter, never looser.</div>
        </div>
      </div>
    </div>
  );
}
