export type RoutineState = 'idle' | 'running' | 'queued' | 'needs_human' | 'failing' | 'disabled';
export type RunStatus =
  | 'succeeded'
  | 'failed'
  | 'running'
  | 'queued'
  | 'skipped'
  | 'needs_human'
  | 'canceled';

export interface Team {
  id: string;
  name: string;
  accent: string;
}
export interface Owner {
  handle: string;
  name: string;
  accent: string;
}
export interface Trigger {
  type: 'schedule' | 'github' | 'slack' | 'sentry' | 'manual' | 'api' | 'after' | 'webhook';
  label: string;
  detail?: string | null;
}
export interface Grant {
  kind: 'mcp' | 'capability';
  name: string;
}
export interface Reaction {
  whenLabel: string;
  doLabel: string;
  budget: string | null;
}
export interface Lease {
  resource: string;
  routine_id: string;
  expires_at: number;
  sha: string | null;
}
export interface RunLite {
  id: string;
  status: RunStatus;
  startedAt: number;
  durationSec: number | null;
  summary: string | null;
  target: string | null;
}
export interface Subscription {
  id: string;
  routine_id: string;
  pr_ref: string;
  pr_title: string;
  status: 'watching' | 'reacting' | 'done' | 'needs_human';
  head_sha: string;
  last_reaction: string | null;
  budget_used: number;
  budget_max: number;
  updated_at: number;
  routine?: { slug: string; name: string };
}
export interface Routine {
  id: string;
  slug: string;
  name: string;
  summary: string;
  enabled: boolean;
  state: RoutineState;
  risk: 'read' | 'write';
  visibility: string;
  model: string;
  repo: string;
  branch: string;
  filePath: string;
  tags: string[];
  team: Team | null;
  owner: Owner;
  triggers: Trigger[];
  successRate: number;
  runs7d: number;
  avgDurationSec: number;
  spendToday: number;
  nextRunAt: number | null;
  updatedAt: number;
  watching: number;
  lastRun: RunLite | null;
  lease: Lease | null;
}
export interface RoutineDetail extends Routine {
  createdAt: number;
  prompt: string;
  grants: Grant[];
  reactions: Reaction[];
  runs: Run[];
  subscriptions: Subscription[];
}
export interface Run {
  id: string;
  routine_id: string;
  status: RunStatus;
  trigger_type: string;
  trigger_summary: string;
  started_at: number;
  finished_at: number | null;
  duration_sec: number | null;
  summary: string | null;
  decision: string | null;
  pushed_sha: string | null;
  target: string | null;
  tokens: number | null;
  cost: number | null;
  routine?: { slug: string; name: string; team: Team };
}
export interface Connector {
  id: string;
  slug: string;
  name: string;
  kind: 'mcp' | 'native';
  status: 'connected' | 'degraded' | 'disconnected';
  connected: boolean;
  auth_type: string;
  events: string[];
  tools_count: number;
  routines_count: number;
  last_checked: number;
  description: string;
}
export interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  target: string;
  detail: string | null;
  ts: number;
}
export interface Stats {
  org: string;
  killSwitch: boolean;
  total: number;
  enabled: number;
  byState: Partial<Record<RoutineState, number>>;
  runsToday: number;
  failedToday: number;
  avgSuccess: number;
  spendToday: number;
  activeLeases: number;
  watching: number;
  needsHuman: number;
}
