import { Plus, Plug, Wrench, Zap, RefreshCw } from 'lucide-react';
import { Page, PageHeader } from '@/components/page';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Signal } from '@/components/status';
import { useConnectors } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import type { Connector } from '@/types';

const STATUS_META: Record<Connector['status'], { tone: 'ok' | 'warn' | 'neutral'; label: string }> = {
  connected: { tone: 'ok', label: 'Connected' },
  degraded: { tone: 'warn', label: 'Degraded' },
  disconnected: { tone: 'neutral', label: 'Not connected' },
};

function ConnectorCard({ c }: { c: Connector }) {
  const s = STATUS_META[c.status];
  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg border border-line bg-surface-2 font-display text-sm font-semibold text-fg">
            {c.name[0]}
          </div>
          <div>
            <div className="font-display text-[15px] font-medium text-fg">{c.name}</div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-2">
              <Badge tone={c.kind === 'mcp' ? 'brand' : 'neutral'} className="px-1.5 py-0">{c.kind.toUpperCase()}</Badge>
              <span>{c.auth_type}</span>
            </div>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium" style={{ color: s.tone === 'ok' ? '#3DD68C' : s.tone === 'warn' ? '#F5B544' : '#8A93A7' }}>
          <Signal tone={s.tone} live={c.status === 'degraded'} />
          {s.label}
        </span>
      </div>

      <p className="mt-3 text-[13px] leading-relaxed text-muted">{c.description}</p>

      {c.events.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-2">Emits events</div>
          <div className="flex flex-wrap gap-1.5">
            {c.events.map((e) => (
              <span key={e} className="inline-flex items-center gap-1 rounded border border-line-soft bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted">
                <Zap className="h-2.5 w-2.5 text-warn" /> {e}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto flex items-center gap-4 border-t border-line-soft pt-3 text-[11px] text-muted-2">
        <span className="inline-flex items-center gap-1.5"><Wrench className="h-3 w-3" /> {c.tools_count} tools</span>
        <span className="inline-flex items-center gap-1.5"><Plug className="h-3 w-3" /> {c.routines_count} routines</span>
        <span className="ml-auto inline-flex items-center gap-1.5"><RefreshCw className="h-3 w-3" /> {relativeTime(c.last_checked)}</span>
      </div>

      <div className="mt-3">
        {c.connected ? (
          <Button variant="secondary" size="sm" className="w-full">Configure</Button>
        ) : c.status === 'degraded' ? (
          <Button variant="secondary" size="sm" className="w-full">Reconnect</Button>
        ) : (
          <Button variant="primary" size="sm" className="w-full">Authorize</Button>
        )}
      </div>
    </Card>
  );
}

export function ConnectorsPage() {
  const { data: connectors, isLoading } = useConnectors();

  return (
    <Page>
      <PageHeader
        eyebrow="Switchboard"
        title="Connectors"
        subtitle="MCP servers and native capabilities your routines can be granted. Add one once; grant it with a checkbox."
        actions={
          <>
            <Button variant="secondary" size="md"><Plug className="h-4 w-4" /> Bring your own MCP</Button>
            <Button variant="primary" size="md"><Plus className="h-4 w-4" /> Add connector</Button>
          </>
        }
      />
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-56" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {connectors?.map((c) => <ConnectorCard key={c.id} c={c} />)}
        </div>
      )}
    </Page>
  );
}
