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
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

export const useStats = () => useQuery({ queryKey: ['stats'], queryFn: () => get<Stats>('/api/stats'), refetchInterval: 8000 });
export const useRoutines = () => useQuery({ queryKey: ['routines'], queryFn: () => get<Routine[]>('/api/routines'), refetchInterval: 10000 });
export const useRoutine = (slug?: string) =>
  useQuery({ queryKey: ['routine', slug], queryFn: () => get<RoutineDetail>(`/api/routines/${slug}`), enabled: !!slug });
export const useRuns = () => useQuery({ queryKey: ['runs'], queryFn: () => get<RunLite[]>('/api/runs'), refetchInterval: 8000 });
export const useRun = (id?: string) =>
  useQuery({ queryKey: ['run', id], queryFn: () => get<RunDetail>(`/api/runs/${id}`), enabled: !!id });
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
export function useDispatchRoutine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => post(`/api/routines/${slug}/dispatch`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routines'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}
export function useKillSwitch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (engaged: boolean) => post<{ killSwitch: boolean }>('/api/kill-switch', { engaged }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stats'] }),
  });
}
