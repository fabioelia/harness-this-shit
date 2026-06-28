import { useEffect, useState } from 'react';

const SHORTCUTS: [string, string][] = [
  ['⌘ K / Ctrl K', 'Command palette — jump to any routine or page'],
  ['/', 'Focus the Fleet search'],
  ['?', 'Show this shortcuts help'],
  ['Esc', 'Close any overlay'],
];

export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
      if (e.key === '?' && !typing) { e.preventDefault(); setOpen((v) => !v); }
      else if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-8" onClick={() => setOpen(false)}>
      <div className="w-full max-w-[440px] overflow-hidden rounded-xl border border-line bg-surface shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-line-soft px-4 py-3 font-display text-[13px] font-semibold">Keyboard shortcuts</div>
        <div className="flex flex-col gap-1 p-3">
          {SHORTCUTS.map(([k, label]) => (
            <div key={k} className="flex items-center gap-3 px-1 py-1.5">
              <kbd className="shrink-0 rounded border border-line bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-t2">{k}</kbd>
              <span className="font-sans text-[12.5px] text-muted-2">{label}</span>
            </div>
          ))}
        </div>
        <div className="border-t border-line-soft px-4 py-2 font-mono text-[10.5px] text-dim-2">press ? anywhere to toggle · esc to close</div>
      </div>
    </div>
  );
}
