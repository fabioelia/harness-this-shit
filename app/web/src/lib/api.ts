import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AuditEntry,
  Connector,
  Routine,
  RoutineDetail,
  Run,
  Stats,
  Subscription,
} from '@/types';

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
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

export const useStats = () =>
  useQuery({ queryKey: ['stats'], queryFn: () => get<Stats>('/api/stats'), refetchInterval: 8000 });

export const useRoutines = () =>
  useQuery({ queryKey: ['routines'], queryFn: () => get<Routine[]>('/api/routines'), refetchInterval: 10000 });

export const useRoutine = (slug?: string) =>
  useQuery({
    queryKey: ['routine', slug],
    queryFn: () => get<RoutineDetail>(`/api/routines/${slug}`),
    enabled: !!slug,
  });

export const useRuns = (limit = 50) =>
  useQuery({ queryKey: ['runs', limit], queryFn: () => get<Run[]>(`/api/runs?limit=${limit}`), refetchInterval: 8000 });

export const useConnectors = () =>
  useQuery({ queryKey: ['connectors'], queryFn: () => get<Connector[]>('/api/connectors') });

export const useSubscriptions = () =>
  useQuery({ queryKey: ['subscriptions'], queryFn: () => get<Subscription[]>('/api/subscriptions'), refetchInterval: 8000 });

export const useActivity = () =>
  useQuery({ queryKey: ['activity'], queryFn: () => get<AuditEntry[]>('/api/activity'), refetchInterval: 10000 });

export function useToggleRoutine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, enabled }: { slug: string; enabled: boolean }) =>
      post(`/api/routines/${slug}/enable`, { enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routines'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}

export function useDispatchRoutine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => post<{ runId: string }>(`/api/routines/${slug}/dispatch`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routines'] });
      qc.invalidateQueries({ queryKey: ['runs'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}

export function useKillSwitch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (engaged: boolean) => post<{ killSwitch: boolean }>('/api/kill-switch', { engaged }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}
