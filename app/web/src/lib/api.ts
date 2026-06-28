import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActivityEntry, Agent, AgentDetail, Connector, RegistryServer, Routine, RoutineDetail, RunDetail, RunLite, Stats } from '@/types';

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}
async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status} ${url}`;
    try {
      const e = await res.json();
      if (e?.error) msg = e.error;
    } catch {
      /* non-JSON error */
    }
    throw new Error(msg);
  }
  return res.json();
}
async function put<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) { let m = `${res.status}`; try { const e = await res.json(); if (e?.error) m = e.error; } catch { /**/ } throw new Error(m); }
  return res.json();
}
async function del<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export const useStats = () => useQuery({ queryKey: ['stats'], queryFn: () => get<Stats>('/api/stats'), refetchInterval: 8000 });

export interface Insights {
  days: number;
  daily: { date: string; runs: number; cost: number; fails: number }[];
  perRoutine: { slug: string; name: string; runs: number; cost: number; turns: number; avgMs: number; fails: number; failRate: number; costPerSuccess: number }[];
  byModel: { model: string; runs: number; cost: number; avgMs: number; tokens: number; costPer1k: number }[];
  byTag: { tag: string; runs: number; cost: number }[];
  byEffort: { effort: string; runs: number; cost: number }[];
  dispatch: Record<string, number>;
  totals: { runs: number; cost: number; turns: number; avgMs: number; fails: number; failRate: number; inTok: number; outTok: number };
  projection: { perDay: number; monthly: number; runsPerDay: number };
  budget: { cap: number; today: number; over: boolean };
  digest: { channel: string; hour: number };
  retentionDays: number;
}
export function usePruneRuns() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (days: number) => post<{ pruned: number; days: number }>('/api/runs/prune', { days }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['runs'] }); qc.invalidateQueries({ queryKey: ['insights'] }); } });
}
export function useSetRetention() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (days: number) => post('/api/runs/retention', { days }), onSuccess: () => qc.invalidateQueries({ queryKey: ['insights'] }) });
}
export function useSetDigest() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: { channel?: string; hour?: number }) => post('/api/digest', b), onSuccess: () => qc.invalidateQueries({ queryKey: ['insights'] }) });
}
export function useSendDigest() {
  return useMutation({ mutationFn: () => post<{ sent: boolean; preview: string }>('/api/digest/send', {}) });
}
export function useSetBudget() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (cap: number) => post<{ ok: boolean; cap: number; today: number }>('/api/budget', { cap }), onSuccess: () => qc.invalidateQueries({ queryKey: ['insights'] }) });
}
export const useInsights = (days = 14) => useQuery({ queryKey: ['insights', days], queryFn: () => get<Insights>(`/api/insights?days=${days}`), refetchInterval: 15000 });

export interface Graph { edges: { from: string; to: string; kind: string; label: string; fromName: string; toName: string; toExists: boolean }[] }
export const useGraph = () => useQuery({ queryKey: ['graph'], queryFn: () => get<Graph>('/api/graph'), refetchInterval: 30000 });
export interface Heatmap { grid: number[][]; max: number; days: number }
export const useHeatmap = (days = 30) => useQuery({ queryKey: ['heatmap', days], queryFn: () => get<Heatmap>(`/api/heatmap?days=${days}`), refetchInterval: 60000 });
export interface Failures { total: number; clusters: { signature: string; count: number; routines: string[]; sampleRun: string; ago: string }[] }
export const useFailures = (days = 7) => useQuery({ queryKey: ['failures', days], queryFn: () => get<Failures>(`/api/failures?days=${days}`), refetchInterval: 20000 });
export interface Recs { recommendations: { slug: string; name: string; kind: string; text: string }[] }
export const useRecommendations = () => useQuery({ queryKey: ['recs'], queryFn: () => get<Recs>('/api/recommendations'), refetchInterval: 30000 });
export interface Anomalies { anomalies: { id: string; slug: string; cost: number; avg: number; x: number; turns: number; ago: string }[] }
export const useAnomalies = (days = 14) => useQuery({ queryKey: ['anomalies', days], queryFn: () => get<Anomalies>(`/api/anomalies?days=${days}`), refetchInterval: 20000 });
export interface Lint { count: number; issues: { slug: string; name: string; warnings: string[] }[] }
export const useLint = () => useQuery({ queryKey: ['lint'], queryFn: () => get<Lint>('/api/lint'), refetchInterval: 20000 });
export interface ActiveRuns { active: { id: string; slug: string; trigger: string; status: string; elapsed: string; longRunning: boolean }[] }
export const useActiveRuns = () => useQuery({ queryKey: ['active-runs'], queryFn: () => get<ActiveRuns>('/api/runs/active'), refetchInterval: 3000 });
export interface Leases { leases: { key: string; runId: string; slug: string; sha: string; held: string; ttl: string }[]; pending: { slug: string; key: string; summary: string; ago: string }[] }
export const useLeases = () => useQuery({ queryKey: ['leases'], queryFn: () => get<Leases>('/api/leases'), refetchInterval: 4000 });
export function useReleaseLease() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (key: string) => del(`/api/leases?key=${encodeURIComponent(key)}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['leases'] }) });
}
export interface Schedule { hours: number; count: number; upcoming: { slug: string; name: string; cron: string; at: number; when: string; in: string }[]; missed: { slug: string; name: string; cron: string; expected: number; ago: string }[] }
export const useSchedule = (hours = 48) => useQuery({ queryKey: ['schedule', hours], queryFn: () => get<Schedule>(`/api/schedule?hours=${hours}`), refetchInterval: 30000 });

// GitHub webhooks
export interface WebhookConfig { publicUrl: string; receiverUrl: string; secretSet: boolean; events: string[]; tunnel: { available: boolean; running: boolean; url: string } }
export interface RepoHook { id: number; url: string; active: boolean; events: string[]; ours: boolean }
export const useWebhookConfig = () => useQuery({ queryKey: ['wh-config'], queryFn: () => get<WebhookConfig>('/api/webhooks/config'), refetchInterval: 6000 });
export interface Delivery { at: number; ago: string; source: string; type: string; repo: string; action: string; pr: number | null; labels: string[]; matched: string[] }
export const useWebhookDeliveries = () => useQuery({ queryKey: ['wh-deliveries'], queryFn: () => get<{ deliveries: Delivery[] }>('/api/webhooks/deliveries'), refetchInterval: 5000 });
export const useRepoHooks = (repo: string) => useQuery({ queryKey: ['wh-hooks', repo], enabled: /^[\w.-]+\/[\w.-]+$/.test(repo), queryFn: () => get<{ hooks: RepoHook[] }>(`/api/webhooks/hooks?repo=${encodeURIComponent(repo)}`) });
export function useWebhookActions() {
  const qc = useQueryClient();
  const inval = () => { qc.invalidateQueries({ queryKey: ['wh-config'] }); qc.invalidateQueries({ queryKey: ['wh-hooks'] }); };
  return {
    genSecret: useMutation({ mutationFn: () => post('/api/webhooks/secret', {}), onSuccess: inval }),
    setUrl: useMutation({ mutationFn: (publicUrl: string) => post('/api/webhooks/config', { publicUrl }), onSuccess: inval }),
    startTunnel: useMutation({ mutationFn: () => post<{ url?: string; error?: string }>('/api/webhooks/tunnel/start', {}), onSuccess: inval }),
    stopTunnel: useMutation({ mutationFn: () => post('/api/webhooks/tunnel/stop', {}), onSuccess: inval }),
    setup: useMutation({ mutationFn: (repo: string) => post<{ id?: number; error?: string }>('/api/webhooks/setup', { repo }), onSuccess: inval }),
    remove: useMutation({ mutationFn: (v: { repo: string; id: number }) => del(`/api/webhooks/hooks?repo=${encodeURIComponent(v.repo)}&id=${v.id}`), onSuccess: inval }),
  };
}
export const useModels = () => useQuery({ queryKey: ['models'], queryFn: () => get<{ models: { id: string; label: string }[]; efforts: string[]; defaultModel: string }>('/api/models'), staleTime: Infinity });
export interface RoutineTemplate { id: string; name: string; desc: string; icon: string; body: { triggers?: string[]; connectors?: string[]; schedule?: string; model?: string; scriptMode?: boolean; scriptLang?: string; prompt?: string } }
export const useTemplates = () => useQuery({ queryKey: ['templates'], queryFn: () => get<{ templates: RoutineTemplate[] }>('/api/templates'), staleTime: Infinity });
export const useGithubOrgs = () => useQuery({ queryKey: ['gh-orgs'], queryFn: () => get<{ orgs: string[] }>('/api/github/orgs'), staleTime: 300_000 });
export const useGithubChecks = (repo: string) =>
  useQuery({ queryKey: ['gh-checks', repo], enabled: !!repo, queryFn: () => get<{ checks: string[] }>(`/api/github/checks?repo=${encodeURIComponent(repo)}`), staleTime: 120_000 });
export const useGithubLabels = (repo: string) =>
  useQuery({ queryKey: ['gh-labels', repo], enabled: /^[\w.-]+\/[\w.-]+$/.test(repo), queryFn: () => get<{ labels: string[] }>(`/api/github/labels?repo=${encodeURIComponent(repo)}`), staleTime: 120_000 });
export const useGithubRepos = (owner = '', q = '') =>
  useQuery({
    queryKey: ['gh-repos', owner, q],
    queryFn: () => get<{ repos: string[] }>(`/api/github/repos?owner=${encodeURIComponent(owner)}&q=${encodeURIComponent(q)}`),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
export function usePinRoutine() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (slug: string) => post<{ ok: boolean; pinned: boolean }>(`/api/routines/${slug}/pin`), onSuccess: () => qc.invalidateQueries({ queryKey: ['routines'] }) });
}
export interface FleetView { name: string; params: Record<string, string | boolean> }
export const useFleetViews = () => useQuery({ queryKey: ['views'], queryFn: () => get<{ views: FleetView[] }>('/api/views') });
export function useSaveView() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: FleetView) => post('/api/views', v), onSuccess: () => qc.invalidateQueries({ queryKey: ['views'] }) });
}
export function useDeleteView() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (name: string) => del(`/api/views?name=${encodeURIComponent(name)}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['views'] }) });
}
export function useBulkRoutines() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: { slugs: string[]; action: string; hours?: number; tag?: string }) => post<{ ok: boolean; affected: number }>('/api/routines/bulk', b), onSuccess: () => { qc.invalidateQueries({ queryKey: ['routines'] }); qc.invalidateQueries({ queryKey: ['stats'] }); } });
}
export const useRoutines = (archived = false) => useQuery({ queryKey: ['routines', archived], queryFn: () => get<Routine[]>(`/api/routines${archived ? '?archived=1' : ''}`), refetchInterval: 10000 });
export function useArchiveRoutine() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ slug, archived }: { slug: string; archived: boolean }) => post<{ ok: boolean; archived: boolean }>(`/api/routines/${slug}/archive`, { archived }), onSuccess: () => qc.invalidateQueries({ queryKey: ['routines'] }) });
}
export const useRoutine = (slug?: string) =>
  useQuery({ queryKey: ['routine', slug], queryFn: () => get<RoutineDetail>(`/api/routines/${slug}`), enabled: !!slug, retry: false });
export const useRuns = () => useQuery({ queryKey: ['runs'], queryFn: () => get<RunLite[]>('/api/runs'), refetchInterval: 8000 });
export function useRerunFailed() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (hours: number) => post<{ rerun: number }>('/api/runs/rerun-failed', { hours }), onSuccess: () => qc.invalidateQueries({ queryKey: ['runs'] }) });
}
export interface RunSearch { q: string; results: { id: string; slug: string; status: string; ago: string; snippet: string }[] }
export const useRunSearch = (q: string) => useQuery({ queryKey: ['runsearch', q], enabled: q.trim().length >= 2, queryFn: () => get<RunSearch>(`/api/runs/search?q=${encodeURIComponent(q)}`) });
export interface RunDiff { current: { id: string; output: string; cost: number | null; turns: number | null; status: string; ago: string } | null; previous: { id: string; output: string; cost: number | null; turns: number | null; status: string; ago: string } | null }
export const useRunDiff = (id: string, enabled: boolean) => useQuery({ queryKey: ['rundiff', id], enabled, queryFn: () => get<RunDiff>(`/api/runs/${id}/diff`) });
export interface RunCompare { a: { id: string; slug: string; output: string; cost: number | null; turns: number | null; status: string; ago: string }; b: RunCompare['a'] }
export const useRunCompare = (a: string, b: string) => useQuery({ queryKey: ['runcompare', a, b], enabled: !!a && b.trim().length > 3, queryFn: () => get<RunCompare>(`/api/runs/compare?a=${a}&b=${encodeURIComponent(b.trim())}`), retry: false });
export const useRun = (id?: string) =>
  useQuery({
    queryKey: ['run', id],
    queryFn: () => get<RunDetail>(`/api/runs/${id}`),
    enabled: !!id,
    retry: false,
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 1500 : false),
  });
export const useConnectors = () => useQuery({ queryKey: ['connectors'], queryFn: () => get<Connector[]>('/api/connectors'), refetchInterval: 15000 });
export const useAgents = () => useQuery({ queryKey: ['agents'], queryFn: () => get<Agent[]>('/api/agents'), refetchInterval: 5000 });
export function useLoadSamples() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<{ repo: string; routines: string[]; agents: string[] }>('/api/samples/load', {}),
    onSuccess: () => { ['routines', 'agents', 'stats'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
  });
}
export const useAgent = (name?: string) =>
  useQuery({ queryKey: ['agent', name], enabled: !!name, queryFn: () => get<AgentDetail>(`/api/agents/${name}`), refetchInterval: (q) => (q.state.data?.status === 'working' ? 2000 : 8000) });
export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: { name: string; role?: string; summary?: string; connectors?: string[]; model?: string; effort?: string; memory?: boolean }) => post<Agent>('/api/agents', b), onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }) });
}
export function useMessageAgent() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ name, text }: { name: string; text: string }) => post<{ runId: string }>(`/api/agents/${name}/message`, { text }), onSuccess: (_r, v) => { qc.invalidateQueries({ queryKey: ['agent', v.name] }); qc.invalidateQueries({ queryKey: ['agents'] }); } });
}
export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (name: string) => del(`/api/agents/${name}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }) });
}
export function useTestConnector() {
  return useMutation({ mutationFn: ({ code, body }: { code: string; body?: unknown }) => post<{ ok: boolean; detail: string }>(`/api/connectors/${code}/test`, body ?? {}) });
}
export function useConfigConnector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ code, token }: { code: string; token: string }) => post<{ ok: boolean; configured: boolean }>(`/api/connectors/${code}/config`, { token }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['connectors'] }); qc.invalidateQueries({ queryKey: ['settings'] }); },
  });
}
export const useMcp = () => useQuery({ queryKey: ['mcp'], queryFn: () => get<{ name: string; config: Record<string, unknown> }[]>('/api/mcp') });
export function useAddMcp() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: { name?: string; config?: string; remote?: boolean; url?: string }) => post<{ ok: boolean; name: string }>('/api/mcp', b), onSuccess: () => { qc.invalidateQueries({ queryKey: ['mcp'] }); qc.invalidateQueries({ queryKey: ['connectors'] }); } });
}
export function useMcpOauth() {
  return useMutation({ mutationFn: (name: string) => post<{ ok: boolean; detail?: string; authUrl?: string; error?: string }>(`/api/mcp/${name}/oauth`, {}) });
}
export function useMcpRegistry(q: string, enabled: boolean) {
  return useQuery({ queryKey: ['mcp-registry', q], queryFn: () => get<{ servers: RegistryServer[] }>(`/api/mcp/registry?q=${encodeURIComponent(q)}`), enabled, staleTime: 60_000 });
}
export function useAddFromRegistry() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (s: { name: string; remoteUrl: string; runtime: string; identifier: string }) => post<{ ok: boolean; name: string; remote: boolean }>('/api/mcp/registry/add', s), onSuccess: () => { ['mcp', 'connectors'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); } });
}
export function useDeleteMcp() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (name: string) => del(`/api/mcp/${name}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['mcp'] }); qc.invalidateQueries({ queryKey: ['connectors'] }); } });
}
export function useAuthMcp() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ name, token, scheme, header }: { name: string; token: string; scheme?: string; header?: string }) => post<{ ok: boolean; configured: boolean }>(`/api/mcp/${name}/auth`, { token, scheme, header }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['mcp'] }); qc.invalidateQueries({ queryKey: ['connectors'] }); } });
}
export const useActivity = () => useQuery({ queryKey: ['activity'], queryFn: () => get<ActivityEntry[]>('/api/activity'), refetchInterval: 10000 });

export function useToggleRoutine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, enabled }: { slug: string; enabled: boolean }) => post(`/api/routines/${slug}/enable`, { enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routines'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['routine'] });
    },
  });
}
interface DispatchResult { ok: boolean; runId: string; status: string }
export function useDispatchRoutine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => post<DispatchResult>(`/api/routines/${slug}/dispatch`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routines'] });
      qc.invalidateQueries({ queryKey: ['runs'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}
export interface MetricHistory {
  points: { runId: string; at: number; ago: string; value: number | null; raw: string }[];
  numeric: boolean;
  latest: { runId: string; at: number; ago: string; value: number | null; raw: string } | null;
}
export const useRoutineMetric = (slug: string, enabled = true) => useQuery({ queryKey: ['metric', slug], enabled, queryFn: () => get<MetricHistory>(`/api/routines/${slug}/metric?n=30`), refetchInterval: 15000 });
export interface RoutinePreview { prompt: string; tools: string[]; agents: string[]; wouldMatch: boolean; leaseKey: string | null; scriptMode: boolean; willCompile: boolean; allowedTools: string[]; promptChars: number; estTokens: number }
export interface Audit { entries: { summary: string; ago: string }[] }
export const useRoutineAudit = (slug: string, enabled = true) => useQuery({ queryKey: ['audit', slug], enabled, queryFn: () => get<Audit>(`/api/routines/${slug}/audit`) });
export function useSnooze() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ slug, hours }: { slug: string; hours: number }) => post<{ ok: boolean; snoozedUntil: number }>(`/api/routines/${slug}/snooze`, { hours }), onSuccess: (_r, v) => { qc.invalidateQueries({ queryKey: ['routine', v.slug] }); qc.invalidateQueries({ queryKey: ['routines'] }); } });
}
export function useFireEvent() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ type, payload }: { type: string; payload: unknown }) => post<{ matched: string[]; runs: { slug: string; runId: string }[] }>(`/api/events/${type}`, payload), onSuccess: () => { qc.invalidateQueries({ queryKey: ['runs'] }); qc.invalidateQueries({ queryKey: ['routines'] }); } });
}
export function usePreviewRoutine() {
  return useMutation({ mutationFn: (slug: string) => post<RoutinePreview>(`/api/routines/${slug}/preview`, {}) });
}
export interface PromptHistory { current: string; versions: { id: number; ago: string; chars: number; prompt: string }[] }
export const useRoutineHistory = (slug: string, enabled = true) => useQuery({ queryKey: ['history', slug], enabled, queryFn: () => get<PromptHistory>(`/api/routines/${slug}/history`) });
export function useRestorePrompt() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ slug, id }: { slug: string; id: number }) => post(`/api/routines/${slug}/restore/${id}`), onSuccess: (_r, v) => { qc.invalidateQueries({ queryKey: ['routine', v.slug] }); qc.invalidateQueries({ queryKey: ['history', v.slug] }); } });
}
export function useCloneRoutine() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (slug: string) => post<Routine>(`/api/routines/${slug}/clone`), onSuccess: () => qc.invalidateQueries({ queryKey: ['routines'] }) });
}
export function useImportRoutine() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (bundle: unknown) => post<Routine>('/api/routines/import', bundle), onSuccess: () => qc.invalidateQueries({ queryKey: ['routines'] }) });
}
export function useReplayRun() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => post<{ ok: boolean; runId: string }>(`/api/runs/${id}/replay`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['runs'] }); } });
}
export function useSetBaseline() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => post(`/api/runs/${id}/baseline`), onSuccess: (_r, id) => qc.invalidateQueries({ queryKey: ['run', id] }) });
}
export function useCancelRun() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => post<{ ok: boolean; killed: boolean }>(`/api/runs/${id}/cancel`), onSuccess: (_r, id) => { qc.invalidateQueries({ queryKey: ['run', id] }); qc.invalidateQueries({ queryKey: ['runs'] }); } });
}
export function useReplayModel() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, model }: { id: string; model: string }) => post<{ ok: boolean; runId: string }>(`/api/runs/${id}/replay-model`, { model }), onSuccess: () => qc.invalidateQueries({ queryKey: ['runs'] }) });
}
export function useRerunRun() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, event }: { id: string; event: string }) => post<{ ok: boolean; runId: string }>(`/api/runs/${id}/rerun`, { event }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['runs'] }); } });
}
export function useRecompile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => post<{ ok: boolean; runId: string }>(`/api/routines/${slug}/recompile`),
    onSuccess: (_r, slug) => { qc.invalidateQueries({ queryKey: ['routine', slug] }); qc.invalidateQueries({ queryKey: ['routines'] }); qc.invalidateQueries({ queryKey: ['runs'] }); },
  });
}

export interface PushResult {
  matched: string[];
  runs: { slug: string; runId: string }[];
  event: Record<string, unknown>;
}
export function useSimulatePush() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload?: Record<string, unknown>) => post<PushResult>('/api/events/push', payload ?? {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routines'] });
      qc.invalidateQueries({ queryKey: ['runs'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
      qc.invalidateQueries({ queryKey: ['routine'] });
    },
  });
}
export interface CreateRoutineInput {
  name: string;
  slug?: string;
  summary?: string;
  owner?: string;
  team?: string;
  triggers?: string[];
  connectors?: string[];
  model?: string;
  effort?: string;
  repo?: string;
  branch?: string;
  prompt?: string;
  chain?: string[];
  schedule?: string;
  filters?: { actions?: string[]; branches?: string[]; labels?: string[]; mode?: string; match?: string; groups?: { match: string; conditions: { field: string; op: string; values: string[] }[] }[] };
  scriptMode?: boolean;
  scriptLang?: string;
  retries?: number;
  assertions?: { type: string; value: string }[];
  alertOnFail?: boolean;
  alertTarget?: string;
  timeout?: number;
  env?: Record<string, string>;
  tags?: string[];
  rateLimit?: number;
  maxFails?: number;
  notes?: string;
  activeWindow?: { start: number | null; end: number | null; days: number[] } | null;
  sla?: number;
  reactions?: { source: string; kind: string; when: string; run: string; check?: string }[];
  memory?: boolean;
}
export const useRoutineMemory = (slug: string | undefined, enabled: boolean) =>
  useQuery({ queryKey: ['memory', slug], enabled: !!slug && enabled, queryFn: () => get<{ enabled: boolean; exists: boolean; md: string; files: string[] }>(`/api/routines/${slug}/memory`) });
export function useCreateRoutine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRoutineInput) => post<Routine>('/api/routines', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routines'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

export function useUpdateRoutine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, body }: { slug: string; body: CreateRoutineInput }) => put<Routine>(`/api/routines/${slug}`, body),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['routines'] });
      qc.invalidateQueries({ queryKey: ['routine', v.slug] });
      qc.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}
export function useDeleteRoutine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => del(`/api/routines/${slug}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['routines'] }); qc.invalidateQueries({ queryKey: ['stats'] }); },
  });
}
export interface ValidateResult { ok: boolean; checks: { label: string; ok: boolean; detail: string }[] }
export function useValidateRoutine() {
  return useMutation({ mutationFn: (slug: string) => post<ValidateResult>(`/api/routines/${slug}/validate`) });
}
export const useRoutineRaw = (slug?: string, enabled = false) =>
  useQuery({ queryKey: ['raw', slug], queryFn: () => get<{ file: string; md: string }>(`/api/routines/${slug}/raw`), enabled: !!slug && enabled });

export interface Settings {
  identities: {
    github: { connected: boolean; account: string | null };
    slack: { connected: boolean; team: string | null; bot: string | null };
    claude?: { loggedIn: boolean; email?: string | null; org?: string | null; plan?: string | null; method?: string | null };
  };
  policies: { key: string; title: string; desc: string; on: boolean }[];
}
export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => get<Settings>('/api/settings') });
export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (policies: Record<string, boolean>) => post('/api/settings', { policies }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
}

export function useKillSwitch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (engaged: boolean) => post<{ killSwitch: boolean }>('/api/kill-switch', { engaged }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stats'] }),
  });
}
