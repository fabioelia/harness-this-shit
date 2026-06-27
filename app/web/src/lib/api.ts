import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActivityEntry, Agent, AgentDetail, Connector, Routine, RoutineDetail, RunDetail, RunLite, Stats } from '@/types';

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
export const useModels = () => useQuery({ queryKey: ['models'], queryFn: () => get<{ models: { id: string; label: string }[]; efforts: string[]; defaultModel: string }>('/api/models'), staleTime: Infinity });
export const useGithubOrgs = () => useQuery({ queryKey: ['gh-orgs'], queryFn: () => get<{ orgs: string[] }>('/api/github/orgs'), staleTime: 300_000 });
export const useGithubChecks = (repo: string) =>
  useQuery({ queryKey: ['gh-checks', repo], enabled: !!repo, queryFn: () => get<{ checks: string[] }>(`/api/github/checks?repo=${encodeURIComponent(repo)}`), staleTime: 120_000 });
export const useGithubRepos = (owner = '', q = '') =>
  useQuery({
    queryKey: ['gh-repos', owner, q],
    queryFn: () => get<{ repos: string[] }>(`/api/github/repos?owner=${encodeURIComponent(owner)}&q=${encodeURIComponent(q)}`),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
export const useRoutines = () => useQuery({ queryKey: ['routines'], queryFn: () => get<Routine[]>('/api/routines'), refetchInterval: 10000 });
export const useRoutine = (slug?: string) =>
  useQuery({ queryKey: ['routine', slug], queryFn: () => get<RoutineDetail>(`/api/routines/${slug}`), enabled: !!slug, retry: false });
export const useRuns = () => useQuery({ queryKey: ['runs'], queryFn: () => get<RunLite[]>('/api/runs'), refetchInterval: 8000 });
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
  return useMutation({ mutationFn: (b: { name: string; role?: string; summary?: string; connectors?: string[]; model?: string; memory?: boolean }) => post<Agent>('/api/agents', b), onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }) });
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
  return useMutation({ mutationFn: (b: { name: string; config: string }) => post<{ ok: boolean; name: string }>('/api/mcp', b), onSuccess: () => { qc.invalidateQueries({ queryKey: ['mcp'] }); qc.invalidateQueries({ queryKey: ['connectors'] }); } });
}
export function useDeleteMcp() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (name: string) => del(`/api/mcp/${name}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['mcp'] }); qc.invalidateQueries({ queryKey: ['connectors'] }); } });
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
  filters?: { actions?: string[]; branches?: string[] };
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
