import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActivityEntry, Connector, Routine, RoutineDetail, RunDetail, RunLite, Stats } from '@/types';

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
export const useConnectors = () => useQuery({ queryKey: ['connectors'], queryFn: () => get<Connector[]>('/api/connectors') });
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
  repo?: string;
  branch?: string;
  prompt?: string;
  sinks?: { type: string; target?: string }[];
  chain?: string[];
}
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
  identities: { github: { connected: boolean; account: string | null }; slack: { connected: boolean; team: string | null; bot: string | null } };
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
