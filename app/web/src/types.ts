export interface Routine {
  slug: string;
  name: string;
  summary: string;
  owner: string;
  team: string;
  ownerColor: string;
  initials: string;
  triggers: string[];
  connectors: string[];
  chain: string[];
  schedule: string;
  filters: { actions?: string[]; branches?: string[]; labels?: string[]; mode?: string; match?: 'all' | 'any'; groups?: { match: 'all' | 'any'; conditions: { field: string; op: string; values: string[] }[] }[] };
  reactions: Reaction[];
  concurrency: { scope?: string; onConflict?: string };
  model: string;
  effort: string;
  memory: boolean;
  repo: string;
  branch: string;
  state: string;
  enabled: boolean;
  lastAgo: string;
  lastStatus: string;
  next: string;
  recent: string[];
  successRate: number | null;
  runCount: number;
  spend: string;
  avg: string;
  inbox: number;
  scriptMode: boolean;
  scriptLang: string;
  compiled: boolean;
  scriptStale: boolean;
  retries: number;
  assertions: { type: string; value: string }[];
  alertOnFail: boolean;
  alertTarget: string;
  timeout: number;
  snoozedUntil: number;
  env: Record<string, string>;
  tags: string[];
  rateLimit: number;
  maxFails: number;
  failStreak: number;
  notes: string;
  pinned: boolean;
  lastSuccessAgo: string;
  staleSuccess: boolean;
}

export interface FrontMatter {
  on: { key: string; detail?: string; tone?: string }[];
  tools: { sign?: string; name?: string; tone?: string; sep?: boolean }[];
  runtime: string[];
  filters: { actions: string[]; branches: string[] };
}
export interface FlowNode { title: string; sub: string; tone?: string }
export interface RunRow { id: string; status: string; ago: string; dur: string; trigger: string }
export interface Reaction { source: string; kind: string; when: string; run: string; check?: string }
export interface Watch {
  id: string; origin: string; target: string; source: string; kind: string; when: string;
  entity: { repo?: string; pr?: number; duration_ms?: number; check?: string };
  status: 'open' | 'fired' | 'dropped' | 'expired'; detail: string; attempts: number; ago: string;
}

export interface RoutineDetail extends Routine {
  breadcrumb: string[];
  file: string;
  frontMatter: FrontMatter;
  flowNodes: FlowNode[];
  prompt: string;
  runHistory: RunRow[];
  watches: Watch[];
  leases: { key: string; runId: string; sha: string; held: string; ttl: string }[];
  inboxTasks: { summary: string; key: string; ago: string }[];
  script: string;
  lastError: { runId: string; output: string; ago: string } | null;
}

export interface RegistryServer {
  id: string; name: string; description: string; version: string;
  remoteUrl: string; transport: string; runtime: string; identifier: string;
}
export interface Connector {
  code: string; name: string; kind: string; health: 'ok' | 'degraded' | 'off';
  auth: string; scopes: string; routines: number; avColor: string;
  testable: boolean; configKey: string; mcp?: boolean; authed?: boolean; remote?: boolean;
  runs7d?: number; cost7d?: number;
}
export interface ActivityEntry { time: string; text: string; state: string }
export interface RunLite {
  id: string; routineSlug: string; routineName: string; status: string; ago: string; dur: string; trigger: string;
}
export interface TraceEvent { seq: number; t: string; ms: number; type: string; tool: string | null; ok: number | null; text: string; truncated: boolean }
export interface RunLineage {
  triggeredBy: { runId: string; routine: string; kind: string } | null;
  downstream: { runId: string; routine: string; status: string; dur: string; kind: string }[];
  watches: { target: string; source: string; kind: string; when: string; status: string; detail: string }[];
}
export interface RunDetail {
  id: string; routine: string; status: string; trigger: string; triggerKind: string; started: string; elapsed: string; model: string;
  cost: number | null; turns: number | null; sessionId: string;
  stdout: string; event: Record<string, unknown> | null;
  trace: TraceEvent[];
  toolBreakdown: { tool: string; calls: number; errors: number }[];
  inbox: { summary: string; ago: string; pending: boolean }[];
  assertResult: { passed: boolean; results: { type: string; value: string; ok: boolean; detail: string }[] } | null;
  lineage: RunLineage;
  awaiting: string | null;
  summary: { result: string; surface: string };
}
export interface Agent {
  name: string; role: string; summary: string; connectors: string[]; model: string; effort: string; memory: boolean; avColor: string;
  status: 'idle' | 'working'; currentTask: string | null; lastActive: string; taskCount: number;
}
export interface AgentTask { id: string; task: string; status: string; ago: string; dur: string; result: string }
export interface AgentDetail extends Agent { tasks: AgentTask[] }
export interface Stats {
  wordmark: string; killSwitch: boolean; total: number; enabled: number; teams: number;
  running: number; failing: number; runsToday: number;
  successRate: number | null; spend: string;
}
