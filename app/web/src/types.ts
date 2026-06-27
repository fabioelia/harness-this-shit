export interface Sink { type: string; target?: string }
export interface SinkResult { type: string; target?: string; ok: boolean; detail: string }

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
  sinks: Sink[];
  chain: string[];
  model: string;
  repo: string;
  branch: string;
  state: string;
  enabled: boolean;
  lastAgo: string;
  lastStatus: string;
  next: string;
  success: number | null;
  spend: string;
  metaShort: string;
  leaseRef: string;
  avg: string;
}

export interface FrontMatter {
  on: { key: string; detail?: string; tone?: string }[];
  tools: { sign?: string; name?: string; tone?: string; sep?: boolean }[];
  runtime: string[];
  concurrency: string[][];
}
export interface FlowNode { title: string; sub: string; tone?: string }
export interface Reaction { dot: string; when: string; to: string; toTone: string }
export interface OwnedPR {
  ref: string; title: string; status: string; label: string; waiting: string; last: string; budget: string;
}
export interface Lease {
  claiming: string; ttlLeft: string; ttlPct: number; budget: string; budgetPct: number; yield: boolean; barrier: string;
}
export interface RunRow { id: string; status: string; ago: string; dur: string; trigger: string }

export interface RoutineDetail extends Routine {
  breadcrumb: string[];
  file: string;
  frontMatter: FrontMatter;
  flowNodes: FlowNode[];
  reactions: Reaction[];
  prompt: string;
  lease: Lease | null;
  ownedPRs: OwnedPR[];
  runHistory: RunRow[];
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
  stdout: string; event: Record<string, unknown> | null; sinksResult: SinkResult[];
  trace: TraceEvent[];
  timeline: { t: string; tag: string; tool?: string | null; ok?: number | null; text: string; dot: string }[];
  awaiting: string | null;
  summary: { result: string; iteration: string; commit: string; surface: string };
  diff: { file: string; add: string; del: string; note: string } | null;
  dispatcher: { label: string; val: string }[];
  outputs: { dot: string; label: string; val: string; tone: string }[];
  leaseBarrier: string[][];
}
export interface Stats {
  wordmark: string; killSwitch: boolean; total: number; enabled: number; teams: number;
  running: number; needsHuman: number; failing: number; runsToday: number; success7d: number | null;
  reactions24h: number; leases: number;
}
