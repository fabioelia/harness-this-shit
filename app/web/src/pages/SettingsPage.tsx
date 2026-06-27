import { Users, GitBranch, ShieldCheck, KeyRound } from 'lucide-react';
import { Page, PageHeader, SectionLabel } from '@/components/page';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { Switch } from '@/components/ui/switch';

const ROLES = [
  { name: 'Fabio Elia', handle: 'fabioelia', role: 'Admin', team: 'Platform', accent: '#8B7CFF' },
  { name: 'Steven Bennett', handle: 'sdbnewton', role: 'Maintainer', team: 'Platform', accent: '#5B9DFF' },
  { name: 'Dan Finkel', handle: 'danf-newton', role: 'Maintainer', team: 'Solutions', accent: '#3DD68C' },
  { name: 'Leonardo Cordoba', handle: 'LeonardoCordoba', role: 'Operator', team: 'QA', accent: '#F5B544' },
  { name: 'Charlie Clark', handle: 'clarkenheim', role: 'Viewer', team: 'QA', accent: '#FF8FA3' },
];

const ROLE_TONE: Record<string, 'brand' | 'run' | 'ok' | 'neutral'> = {
  Admin: 'brand',
  Maintainer: 'run',
  Operator: 'ok',
  Viewer: 'neutral',
};

function PolicyRow({ icon: Icon, title, desc, on }: { icon: typeof Users; title: string; desc: string; on?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-5 py-3.5">
      <div className="grid h-9 w-9 place-items-center rounded-md bg-surface-2 text-muted"><Icon className="h-4 w-4" /></div>
      <div className="flex-1">
        <div className="text-sm font-medium text-fg">{title}</div>
        <div className="text-[12px] text-muted">{desc}</div>
      </div>
      <Switch defaultChecked={on} />
    </div>
  );
}

export function SettingsPage() {
  return (
    <Page className="max-w-[980px]">
      <PageHeader eyebrow="Switchboard" title="Settings" subtitle="Team membership, roles, and the org-wide policy that bounds every routine." />

      <SectionLabel>Team & roles</SectionLabel>
      <Card className="mb-6 overflow-hidden">
        {ROLES.map((m) => (
          <div key={m.handle} className="flex items-center gap-3 border-b border-line-soft px-5 py-3 last:border-0">
            <Avatar name={m.name} accent={m.accent} size={30} />
            <div className="flex-1">
              <div className="text-sm font-medium text-fg">{m.name}</div>
              <div className="font-mono text-[11px] text-muted-2">@{m.handle} · {m.team}</div>
            </div>
            <Badge tone={ROLE_TONE[m.role]}>{m.role}</Badge>
          </div>
        ))}
      </Card>

      <SectionLabel>Org policy</SectionLabel>
      <Card className="overflow-hidden">
        <CardHeader><CardTitle>Guardrails</CardTitle><Badge tone="ok">enforced fleet-wide</Badge></CardHeader>
        <div className="border-t border-line-soft">
          <PolicyRow icon={GitBranch} title="UI edits commit via pull request" desc="Routine edits in the web editor open a PR instead of pushing to the branch." on />
          <PolicyRow icon={ShieldCheck} title="Write routines require opt-in consent" desc="A routine may only push to a PR carrying the auto-cleanup label." on />
          <PolicyRow icon={KeyRound} title="merge-pr capability denied org-wide" desc="No routine may merge a pull request, regardless of grant." on />
          <PolicyRow icon={Users} title="Approval gate for first-time write routines" desc="A maintainer approves the first run of any routine that mutates shared targets." />
        </div>
        <CardContent className="pt-4 text-[12px] text-muted-2">
          Policy is the ceiling — individual routines can be stricter, never looser.
        </CardContent>
      </Card>
    </Page>
  );
}
