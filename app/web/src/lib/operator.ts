import { useEffect, useState, useCallback } from 'react';

// The current operator's display name — used as the default author/reviewer/assignee
// across comments, approvals, and run assignment. Stored per-browser (no auth here).
const KEY = 'sb-author';
const read = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };

const listeners = new Set<(v: string) => void>();
export function setOperator(name: string) {
  const v = name.trim();
  try { localStorage.setItem(KEY, v); } catch { /* ignore */ }
  listeners.forEach((fn) => fn(v));
}

export function useOperator(): [string, (v: string) => void] {
  const [name, setName] = useState(read);
  useEffect(() => {
    listeners.add(setName);
    return () => { listeners.delete(setName); };
  }, []);
  const set = useCallback((v: string) => setOperator(v), []);
  return [name, set];
}
