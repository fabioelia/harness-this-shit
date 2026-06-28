import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRoutines } from '@/lib/api';

type Item = { label: string; sub: string; to: string; kind: string };

const PAGES: Item[] = [
  { label: 'Fleet', sub: 'all routines', to: '/', kind: 'page' },
  { label: 'Runs', sub: 'execution history', to: '/runs', kind: 'page' },
  { label: 'Insights', sub: 'spend · schedule · concurrency', to: '/insights', kind: 'page' },
  { label: 'Team', sub: 'agents', to: '/team', kind: 'page' },
  { label: 'Activity', sub: 'live event log', to: '/activity', kind: 'page' },
  { label: 'Connectors', sub: 'integrations', to: '/connectors', kind: 'page' },
  { label: 'Settings', sub: 'identities · webhooks · digest', to: '/settings', kind: 'page' },
  { label: 'New routine', sub: 'create', to: '/routines/new', kind: 'action' },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { data: routines } = useRoutines();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((v) => !v); }
      else if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);

  const items = useMemo(() => {
    const routineItems: Item[] = (routines ?? []).map((r) => ({ label: r.name, sub: `${r.slug} · ${r.team}`, to: `/routines/${r.slug}`, kind: 'routine' }));
    const all = [...PAGES, ...routineItems];
    const t = q.trim().toLowerCase();
    if (!t) return all.slice(0, 12);
    return all.filter((i) => `${i.label} ${i.sub}`.toLowerCase().includes(t)).slice(0, 12);
  }, [routines, q]);

  useEffect(() => { setSel(0); }, [q]);
  if (!open) return null;
  const go = (i: Item) => { navigate(i.to); setOpen(false); };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 p-8" onClick={() => setOpen(false)}>
      <div className="mt-[12vh] w-full max-w-[560px] overflow-hidden rounded-xl border border-line bg-surface shadow-pop" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            else if (e.key === 'Enter' && items[sel]) { e.preventDefault(); go(items[sel]); }
          }}
          placeholder="Jump to a routine or page…"
          className="w-full border-b border-line-soft bg-transparent px-4 py-3.5 font-sans text-[14px] text-fg placeholder:text-dim focus:outline-none"
        />
        <div className="max-h-[50vh] overflow-auto py-1.5">
          {items.length === 0 && <div className="px-4 py-3 font-mono text-[12px] text-dim">no matches</div>}
          {items.map((i, idx) => (
            <button
              key={i.to}
              onMouseEnter={() => setSel(idx)}
              onClick={() => go(i)}
              className={`flex w-full items-center gap-3 px-4 py-2 text-left ${idx === sel ? 'bg-brand/12' : ''}`}
            >
              <span className={`w-[58px] shrink-0 font-mono text-[10px] font-semibold uppercase ${i.kind === 'routine' ? 'text-brand-soft' : i.kind === 'action' ? 'text-ok' : 'text-dim'}`}>{i.kind}</span>
              <span className="flex-1 truncate font-sans text-[13px] font-medium text-t2">{i.label}</span>
              <span className="shrink-0 truncate font-mono text-[11px] text-dim">{i.sub}</span>
            </button>
          ))}
        </div>
        <div className="border-t border-line-soft px-4 py-2 font-mono text-[10.5px] text-dim-2">↑↓ navigate · ↵ open · esc close · ⌘K toggle</div>
      </div>
    </div>
  );
}
