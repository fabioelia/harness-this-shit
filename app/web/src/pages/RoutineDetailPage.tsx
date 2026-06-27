import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Play,
  Pencil,
  Cable,
  GitBranch,
  Cpu,
  FileCode2,
  ShieldHalf,
  Eye,
  GitPullRequest,
} from 'lucide-react';
import { Page } from '@/components/page';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Avatar } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { StateSignal, RunStatusPill } from '@/components/status';
import { FlowDiagram } from '@/components/FlowDiagram';
import { useRoutine, useToggleRoutine, useDispatchRoutine } from '@/lib/api';
import { duration, money, relativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { RoutineDetail, Subscription } from '@/types';

const SUB_TONE: Record<Subscription['status'], { tone: string; label: string }> = {
  watching: { tone: 'text-run', label: 'Watching' },
  reacting: { tone: 'text-brand-soft', label: 'Reacting' },
  done: { tone: 'text-ok', label: 'Merged' },
  needs_human: { tone: 'text-warn', label: 'Needs human' },
};

function Meta({ icon: Icon, label, value }: { icon: typeof Cpu; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-muted-2" />
      <span className="text-[11px] uppercase tracking-wide text-muted-2">{label}</span>
      <span className="font-mono text-[12px] text-fg">{value}</span>
    </div>
  );
}

function GrantsCard({ d }: { d: RoutineDetail }) {
  const mcp = d.grants.filter((g) => g.kind === 'mcp');
  const caps = d.grants.filter((g) => g.kind === 'capability');
  return (
    <Card>
      <CardHeader><CardTitle>Grants</CardTitle><Badge tone="neutral">least privilege</Badge></CardHeader>
      <CardContent className="space-y-3 pt-1">
        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-2">MCP connectors</div>
          <div className="flex flex-wrap gap-1.5">
            {mcp.length ? mcp.map((g) => (
              <Link key={g.name} to="/connectors" className="inline-flex items-center gap-1.5 rounded-md border border-brand/25 bg-brand/10 px-2 py-1 text-[12px] text-brand-soft hover:border-brand/50">
                <Cable className="h-3 w-3" /> {g.name}
              </Link>
            )) : <span className="text-[12px] text-muted-2">none</span>}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-2">Capabilities</div>
          <div className="flex flex-wrap gap-1.5">
            {caps.length ? caps.map((g) => (
              <span key={g.name} className="rounded-md border border-line bg-surface-2 px-2 py-1 font-mono text-[11px] text-muted">{g.name}</span>
            )) : <span className="text-[12px] text-muted-2">none</span>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ConcurrencyCard({ d }: { d: RoutineDetail }) {
  const isWrite = d.risk === 'write';
  return (
    <Card>
      <CardHeader>
        <CardTitle>Concurrency &amp; collisions</CardTitle>
        <Badge tone={isWrite ? 'warn' : 'neutral'}>{isWrite ? 'guarded' : 'read-only'}</Badge>
      </CardHeader>
      <CardContent className="space-y-2.5 pt-1 text-[12px]">
        {d.lease ? (
          <div className="flex items-center justify-between rounded-md border border-brand/25 bg-brand/10 px-3 py-2">
            <span className="inline-flex items-center gap-1.5 text-brand-soft"><Cable className="h-3.5 w-3.5" /> Holding lease</span>
            <span className="font-mono text-[11px] text-brand-soft">{d.lease.resource} · {relativeTime(d.lease.expires_at)}</span>
          </div>
        ) : (
          <div className="rounded-md border border-line-soft bg-surface px-3 py-2 text-muted-2">No active lease.</div>
        )}
        {isWrite ? (
          <ul className="space-y-1.5">
            <Guard on label="Concurrency group" detail="per-PR; serialized (cancel_in_progress: false)" />
            <Guard on label="Lease" detail={`pr:<repo>#<n> · claim before act`} />
            <Guard on label="SHA barrier" detail="stale verdict self-drops once head moves" />
            <Guard on label="Yield to human" detail="stand down if a human pushed after our last fix" />
            <Guard on label="Budget" detail={`${d.reactions[0]?.budget ?? '3'} iterations → needs-human`} />
          </ul>
        ) : (
          <p className="text-muted-2">Read-only routine — emits signals, never mutates a shared target, so it needs no lease.</p>
        )}
      </CardContent>
    </Card>
  );
}

function Guard({ on, label, detail }: { on?: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-2">
      <ShieldHalf className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', on ? 'text-ok' : 'text-muted-2')} />
      <span><span className="font-medium text-fg">{label}</span> <span className="text-muted-2">— {detail}</span></span>
    </li>
  );
}

function OwnedPRsCard({ d }: { d: RoutineDetail }) {
  if (!d.subscriptions.length) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Owned PRs</CardTitle><Badge tone="brand"><Eye className="h-3 w-3" /> {d.subscriptions.length} watched</Badge></CardHeader>
      <CardContent className="space-y-2 pt-1">
        {d.subscriptions.map((s) => {
          const m = SUB_TONE[s.status];
          const pct = Math.round((s.budget_used / s.budget_max) * 100);
          return (
            <div key={s.id} className="rounded-md border border-line-soft bg-surface px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-fg">
                  <GitPullRequest className="h-3.5 w-3.5 text-muted-2" /> {s.pr_ref}
                </span>
                <span className={cn('text-[11px] font-medium', m.tone)}>{m.label}</span>
              </div>
              <p className="mt-0.5 line-clamp-1 text-[12px] text-muted">{s.pr_title}</p>
              {s.last_reaction && <p className="mt-1 text-[11px] text-muted-2">↳ {s.last_reaction}</p>}
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-warn' : 'bg-brand')} style={{ width: `${pct}%` }} />
                </div>
                <span className="tabular text-[10px] text-muted-2">budget {s.budget_used}/{s.budget_max}</span>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function buildRoutineMd(d: RoutineDetail): string {
  const lines: string[] = ['---'];
  lines.push(`name: ${d.name}`);
  lines.push(`slug: ${d.slug}`);
  lines.push(`summary: >-`);
  lines.push(`  ${d.summary}`);
  lines.push(`owner: ${d.owner.handle}`);
  lines.push(`team: ${d.team?.id ?? 'team'}`);
  lines.push(`tags: [${d.tags.join(', ')}]`);
  lines.push(`enabled: ${d.enabled}`);
  lines.push(`visibility: ${d.visibility}`);
  lines.push('on:');
  d.triggers.forEach((t) => lines.push(`  - ${t.type}: { ${t.label}${t.detail ? ` }   # ${t.detail}` : ' }'}`));
  lines.push('tools:');
  const mcp = d.grants.filter((g) => g.kind === 'mcp').map((g) => g.name);
  const caps = d.grants.filter((g) => g.kind === 'capability').map((g) => g.name);
  lines.push(`  mcp: [${mcp.join(', ')}]`);
  lines.push(`  capabilities: [${caps.join(', ')}]`);
  lines.push('runtime:');
  lines.push(`  model: ${d.model}`);
  lines.push(`  repo: ${d.repo}`);
  lines.push(`  branch: ${d.branch}`);
  if (d.risk === 'write') {
    lines.push('concurrency:');
    lines.push('  group: "${{ event.pr.number }}"');
    lines.push('  lease: { resource: "pr:${{ event.repo }}#${{ event.pr.number }}", ttl: 20m }');
    lines.push('  barrier: { stale_if_sha_changed: "${{ event.pr.head_sha }}" }');
    lines.push('  yield_to_human: true');
    if (d.reactions[0]?.budget) lines.push(`  budget: { max_iterations: ${d.reactions[0].budget}, on_exhausted: needs-human }`);
  }
  if (d.reactions.length) {
    lines.push('flow:');
    lines.push('  subscribe: { events: [check_run, pull_request_review, pull_request], until: [merged, closed] }');
    lines.push('  reactions:');
    d.reactions.forEach((r) => {
      lines.push(`    - when: { ${r.whenLabel} }`);
      lines.push(`      do: ${r.doLabel}${r.budget ? `   # budget ${r.budget}` : ''}`);
    });
  }
  lines.push('---');
  lines.push('');
  lines.push('## Prompt');
  lines.push('');
  lines.push(d.prompt);
  return lines.join('\n');
}

export function RoutineDetailPage() {
  const { slug } = useParams();
  const { data: d, isLoading } = useRoutine(slug);
  const toggle = useToggleRoutine();
  const dispatch = useDispatchRoutine();

  if (isLoading || !d) {
    return (
      <Page>
        <Skeleton className="mb-4 h-6 w-40" />
        <Skeleton className="mb-3 h-24 w-full" />
        <Skeleton className="h-72 w-full" />
      </Page>
    );
  }

  return (
    <Page>
      <Link to="/" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Fleet
      </Link>

      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <StateSignal state={d.state} />
            <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">{d.name}</h1>
            {d.team && (
              <span className="rounded-full border px-2 py-0.5 text-[11px] font-medium"
                style={{ borderColor: `${d.team.accent}33`, background: `${d.team.accent}12`, color: d.team.accent }}>
                {d.team.name}
              </span>
            )}
            {d.risk === 'write' && <Badge tone="warn">write</Badge>}
          </div>
          <p className="mt-1.5 max-w-2xl text-sm text-muted">{d.summary}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-center gap-2">
              <Avatar name={d.owner.name} accent={d.owner.accent} size={20} />
              <span className="text-[12px] text-muted">{d.owner.name}</span>
            </div>
            <Meta icon={Cpu} label="model" value={d.model} />
            <Meta icon={GitBranch} label="repo" value={`${d.repo.split('/')[1]}@${d.branch}`} />
            <Meta icon={FileCode2} label="file" value={d.filePath} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5">
            <span className="text-[12px] text-muted">{d.enabled ? 'Enabled' : 'Disabled'}</span>
            <Switch checked={d.enabled} onCheckedChange={(v) => toggle.mutate({ slug: d.slug, enabled: v })} />
          </div>
          <Button variant="secondary"><Pencil className="h-4 w-4" /> Edit</Button>
          <Button variant="primary" onClick={() => dispatch.mutate(d.slug)}><Play className="h-4 w-4" /> Run now</Button>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="mb-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="runs">Runs <span className="text-muted-2">{d.runs.length}</span></TabsTrigger>
          <TabsTrigger value="definition">Definition</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <Card>
                <CardHeader><CardTitle>Flow</CardTitle>
                  <Badge tone={d.reactions.length ? 'brand' : 'neutral'}>{d.reactions.length ? 'reactive' : 'one-shot'}</Badge>
                </CardHeader>
                <CardContent className="pt-1">
                  <FlowDiagram name={d.name} triggers={d.triggers} reactions={d.reactions} statusSurface="pr-comment" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Recent runs</CardTitle>
                  <Link to="/runs" className="text-[12px] text-brand-soft hover:underline">View all</Link>
                </CardHeader>
                <div className="border-t border-line-soft">
                  {d.runs.slice(0, 6).map((run) => (
                    <div key={run.id} className="flex items-center gap-3 border-b border-line-soft px-5 py-2.5 last:border-0">
                      <div className="w-32"><RunStatusPill status={run.status} /></div>
                      <p className="min-w-0 flex-1 truncate text-[12px] text-muted">{run.summary ?? run.trigger_summary}</p>
                      {run.target && <span className="font-mono text-[11px] text-muted-2">{run.target.replace('pr:newton', '')}</span>}
                      <span className="tabular w-14 text-right text-[11px] text-muted-2">{duration(run.duration_sec)}</span>
                      <span className="w-16 text-right text-[11px] text-muted-2">{relativeTime(run.started_at)}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <div className="space-y-4">
              <ConcurrencyCard d={d} />
              <OwnedPRsCard d={d} />
              <GrantsCard d={d} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="runs">
          <Card className="overflow-hidden">
            {d.runs.map((run) => (
              <div key={run.id} className="flex items-center gap-3 border-b border-line-soft px-5 py-3 last:border-0">
                <div className="w-32"><RunStatusPill status={run.status} /></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-fg">{run.summary ?? run.trigger_summary}</p>
                  <p className="font-mono text-[11px] text-muted-2">{run.trigger_type} · {run.decision}</p>
                </div>
                {run.target && <span className="font-mono text-[11px] text-muted-2">{run.target.replace('pr:newton', '')}</span>}
                <span className="tabular w-16 text-right text-[12px] text-muted">{duration(run.duration_sec)}</span>
                <span className="w-20 text-right text-[12px] text-muted-2">{relativeTime(run.started_at)}</span>
                <span className="tabular w-14 text-right text-[12px] text-muted">{money(run.cost)}</span>
              </div>
            ))}
          </Card>
        </TabsContent>

        <TabsContent value="definition">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="font-mono">{d.filePath}</CardTitle>
              <Badge tone="ok">source of truth</Badge>
            </CardHeader>
            <pre className="max-h-[640px] overflow-auto border-t border-line-soft bg-bg px-5 py-4 font-mono text-[12px] leading-relaxed text-muted">
              <code>{buildRoutineMd(d)}</code>
            </pre>
          </Card>
        </TabsContent>
      </Tabs>
    </Page>
  );
}
