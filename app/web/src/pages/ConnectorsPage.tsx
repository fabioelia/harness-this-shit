import { useConnectors } from '@/lib/api';
import { Pill, Dot, Empty, SIGNAL } from '@/components/sb';
import type { Connector } from '@/types';

const GRID = { display: 'grid', gridTemplateColumns: '44px minmax(0,1.3fr) 138px minmax(0,1.5fr) minmax(0,1.7fr) 150px', alignItems: 'center', gap: 14 } as const;
const HEALTH: Record<Connector['health'], { label: string; color: string }> = {
  ok: { label: 'Connected', color: SIGNAL.success },
  degraded: { label: 'Degraded', color: SIGNAL.needs_human },
  off: { label: 'Not connected', color: SIGNAL.disabled },
};

export function ConnectorsPage() {
  const { data: connectors } = useConnectors();
  const counts = (h: Connector['health']) => (connectors ?? []).filter((c) => c.health === h).length;

  return (
    <div className="font-sans text-fg animate-fade-up">
      <div className="border-b border-line-soft bg-head px-[26px] py-[22px]">
        <div className="mb-3 font-mono text-[12px] font-medium text-dim"><span className="text-brand">Switchboard</span> › Connectors</div>
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="font-display text-[23px] font-bold tracking-tight">Connectors &amp; MCPs</div>
            <div className="mt-1 text-[13px] text-muted-2">{connectors?.length ?? 7} connectors · grants flow to routines by registry id · secrets stored as references</div>
          </div>
          <button className="flex h-9 items-center gap-2 rounded-md bg-brand px-[15px] font-display text-[12.5px] font-semibold text-[#16130f] hover:bg-brand-deep"><span className="-mt-px text-[16px] leading-none">+</span>Add connector</button>
        </div>
        <div className="mt-3.5 flex items-center gap-[18px] font-sans text-[12px] font-medium text-muted-2">
          <span className="inline-flex items-center gap-1.5"><Dot color={SIGNAL.success} size={7} /><span className="font-semibold text-t2">{counts('ok')}</span> connected</span>
          <span className="inline-flex items-center gap-1.5"><Dot color={SIGNAL.needs_human} size={7} /><span className="font-semibold text-t2">{counts('degraded')}</span> degraded</span>
          <span className="inline-flex items-center gap-1.5"><Dot color={SIGNAL.disabled} size={7} /><span className="font-semibold text-t2">{counts('off')}</span> not connected</span>
        </div>
      </div>

      <div className="px-[26px] py-5 pb-[26px]">
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="border-b border-line bg-surface-2 px-[18px] py-[11px] font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-dim-2" style={GRID}>
            <div /><div>Connector</div><div>Health</div><div>Auth</div><div>Scopes</div><div className="text-right">Used by</div>
          </div>
          {connectors && connectors.length === 0 && <Empty title="No connectors yet" hint="Add an MCP server or native capability, then grant it to routines with a checkbox. Secrets stay as vault:// references." />}
          {connectors?.map((c) => (
            <div key={c.code} className="border-b border-line-soft px-[18px] py-[15px] last:border-0 hover:bg-white/[0.015]" style={GRID}>
              <div className="grid place-items-center font-mono text-[11px] font-bold text-[#16130f]" style={{ width: 30, height: 30, borderRadius: 8, background: c.avColor }}>{c.code}</div>
              <div className="flex min-w-0 items-center gap-2">
                <span className="font-display text-[14px] font-semibold text-fg-2">{c.name}</span>
                <span className="rounded-[4px] border border-white/[0.08] bg-white/[0.045] px-1.5 py-px font-mono text-[9.5px] font-semibold uppercase tracking-[0.05em] text-muted-2">{c.kind}</span>
              </div>
              <div><Pill label={HEALTH[c.health].label} color={HEALTH[c.health].color} /></div>
              <div className="truncate font-mono text-[11.5px] font-medium text-muted-2">{c.auth}</div>
              <div className="truncate font-mono text-[11.5px] font-medium text-muted">{c.scopes}</div>
              <div className="flex items-center justify-end gap-3">
                <span className="font-mono text-[12px] font-semibold text-t2">{c.routines}</span>
                <span className="font-mono text-[11px] font-medium text-brand">Manage ›</span>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3.5 flex items-center gap-[9px] font-sans text-[11.5px] font-medium text-dim-2">
          <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="#6f685c" strokeWidth="1.6"><circle cx="9" cy="9" r="6.5" /><line x1="9" y1="8" x2="9" y2="12.5" strokeLinecap="round" /><circle cx="9" cy="5.6" r="0.6" fill="#6f685c" /></svg>
          Granting a connector to a routine is a checkbox in its editor — secrets resolve from <span className="font-mono text-[#ada695]">vault://</span> references and never appear in the file, the UI, or logs.
        </div>
      </div>
    </div>
  );
}
