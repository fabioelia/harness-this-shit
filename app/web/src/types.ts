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
  filters: { actions?: string[]; branches?: string[] };
  reactions: Reaction[];
  model: string;
  effort: string;
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
}

export interface Connector {
  code: string; name: string; kind: string; health: 'ok' | 'degraded' | 'off';
  auth: string; scopes: string; routines: number; avColor: string;
}
export interface ActivityEntry { time: string; text: string; state: string }
export interface RunLite {
  id: string; routineSlug: string; routineName: string; status: string; ago: string; dur: string; trigger: string;
}
export interface TraceEvent { seq: number; t: string; type: string; tool: string | null; ok: number | null; text: string; truncated: boolean }
export interface RunDetail {
  id: string; routine: string; status: string; trigger: string; started: string; elapsed: string; model: string;
  cost: number | null; turns: number | null; sessionId: string;
  stdout: string; event: Record<string, unknown> | null;
  trace: TraceEvent[];
  awaiting: string | null;
  summary: { result: string; surface: string };
}
export interface Stats {
  wordmark: string; killSwitch: boolean; total: number; enabled: number; teams: number;
  running: number; failing: number; runsToday: number;
  successRate: number | null; spend: string;
}
