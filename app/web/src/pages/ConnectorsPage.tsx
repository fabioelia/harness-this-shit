import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useConnectors, useTestConnector, useConfigConnector, useMcp, useAddMcp, useDeleteMcp, useAuthMcp } from '@/lib/api';
import { Pill, Dot, Empty, SIGNAL } from '@/components/sb';
import { cn } from '@/lib/utils';
import type { Connector } from '@/types';

const connSlug = (name: string) => name.toLowerCase().split(/[ /]/)[0];
const btn = 'h-7 rounded-md border border-line bg-surface-2 px-2.5 font-display text-[11.5px] font-semibold text-t2 hover:border-hair disabled:opacity-40';

function ConnectorRow({ c, GRID }: { c: Connector; GRID: React.CSSProperties }) {
  const test = useTestConnector();
  const config = useConfigConnector();
  const delMcp = useDeleteMcp();
  const authMcp = useAuthMcp();
  const [showCfg, setShowCfg] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [token, setToken] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [authHeader, setAuthHeader] = useState('');
  const [authScheme, setAuthScheme] = useState<'bearer' | 'raw'>('bearer');
  const [channel, setChannel] = useState('#dev-ai-slop');
  const result = test.data;
  const HEALTH: Record<Connector['health'], { label: string; color: string }> = {
    ok: { label: 'Connected', color: SIGNAL.success }, degraded: { label: 'Degraded', color: SIGNAL.needs_human }, off: { label: 'Not connected', color: SIGNAL.disabled },
  };
  return (
    <div className="border-b border-line-soft last:border-0">
      <div className="px-[18px] py-[15px] hover:bg-white/[0.015]" style={GRID}>
        <div className="grid place-items-center font-mono text-[11px] font-bold text-[#16130f]" style={{ width: 30, height: 30, borderRadius: 8, background: c.avColor }}>{c.code.slice(0, 2).toUpperCase()}</div>
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-display text-[14px] font-semibold text-fg-2">{c.name}</span>
          <span className="rounded-[4px] border border-white/[0.08] bg-white/[0.045] px-1.5 py-px font-mono text-[9.5px] font-semibold uppercase tracking-[0.05em] text-muted-2">{c.kind}</span>
        </div>
        <div><Pill label={HEALTH[c.health].label} color={HEALTH[c.health].color} /></div>
        <div className="truncate font-mono text-[11.5px] font-medium text-muted-2">{c.auth}</div>
        <div className="truncate font-mono text-[11.5px] font-medium text-muted">{c.scopes}</div>
        <div className="flex items-center justify-end gap-2">
          <span className="font-mono text-[12px] font-semibold text-t2">{c.routines}</span>
          {c.testable && <button onClick={() => test.mutate({ code: c.code, body: c.configKey === 'slack' ? { channel } : {} })} disabled={test.isPending} className={btn}>{test.isPending ? 'Testing…' : 'Test'}</button>}
          {c.configKey && <button onClick={() => setShowCfg((v) => !v)} className={btn}>Configure</button>}
          {c.mcp && <button onClick={() => setShowAuth((v) => !v)} className={cn(btn, c.authed && 'border-brand/40 text-brand-soft')}>{c.authed ? '🔑 Auth' : 'Authenticate'}</button>}
          {c.mcp && <button onClick={() => { if (confirm(`Remove MCP server "${c.name}"?`)) delMcp.mutate(c.name); }} className={cn(btn, 'border-bad/40 text-bad')}>Remove</button>}
        </div>
      </div>
      {(result || showCfg || showAuth) && (
        <div className="px-[18px] pb-3.5" style={{ paddingLeft: 72 }}>
          {result && <div className={cn('font-mono text-[11.5px]', result.ok ? 'text-ok' : 'text-warn')}>{result.ok ? '✓' : '✗'} {result.detail}</div>}
          {showAuth && (
            <div className="mt-2">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="inline-flex overflow-hidden rounded-md border border-line text-[11px] font-semibold">
                  {(['bearer', 'raw'] as const).map((s) => <button key={s} type="button" onClick={() => setAuthScheme(s)} className={cn('px-2 py-0.5 font-mono', authScheme === s ? 'bg-brand/15 text-brand-soft' : 'text-dim hover:text-t2')}>{s}</button>)}
                </span>
                <input value={authHeader} onChange={(e) => setAuthHeader(e.target.value)} placeholder="header / env (default Authorization)" className="h-8 w-56 rounded-md border border-line bg-surface-2 px-2.5 font-mono text-[11.5px] text-fg focus:border-brand/60 focus:outline-none" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input type="password" value={authToken} onChange={(e) => setAuthToken(e.target.value)} placeholder={`token / API key for ${c.name}`} className="h-8 min-w-[260px] flex-1 rounded-md border border-line bg-surface-2 px-2.5 font-mono text-[12px] text-fg focus:border-brand/60 focus:outline-none" />
                <button onClick={() => authMcp.mutate({ name: c.name, token: authToken, scheme: authScheme, header: authHeader }, { onSuccess: () => { setAuthToken(''); setShowAuth(false); } })} disabled={authMcp.isPending} className={cn(btn, 'h-8 border-brand/50 bg-brand/10 text-brand-soft')}>{authMcp.isPending ? 'Saving…' : authToken ? 'Save auth' : 'Clear auth'}</button>
              </div>
              <div className="mt-1.5 font-mono text-[10.5px] text-dim">Stored masked, injected at runtime — http → header (<span className="text-[#ada695]">{authScheme === 'bearer' ? 'Bearer <token>' : '<token>'}</span>), stdio → env var. For OAuth servers, run <span className="text-[#ada695]">claude mcp add --transport http {c.name} &lt;url&gt;</span> once.</div>
            </div>
          )}
          {showCfg && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {c.configKey === 'slack' && <input value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="#channel for the test" className="h-8 w-40 rounded-md border border-line bg-surface-2 px-2.5 font-mono text-[12px] text-fg focus:border-brand/60 focus:outline-none" />}
              <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={`paste ${c.name} token`} className="h-8 min-w-[240px] flex-1 rounded-md border border-line bg-surface-2 px-2.5 font-mono text-[12px] text-fg focus:border-brand/60 focus:outline-none" />
              <button onClick={() => config.mutate({ code: c.configKey, token }, { onSuccess: () => { setToken(''); setShowCfg(false); } })} disabled={config.isPending} className={cn(btn, 'h-8 border-brand/50 bg-brand/10 text-brand-soft')}>{config.isPending ? 'Saving…' : token ? 'Save token' : 'Clear token'}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const GRID = { display: 'grid', gridTemplateColumns: '44px minmax(0,1.3fr) 138px minmax(0,1.5fr) minmax(0,1.7fr) 150px', alignItems: 'center', gap: 14 } as const;
const HEALTH: Record<Connector['health'], { label: string; color: string }> = {
  ok: { label: 'Connected', color: SIGNAL.success },
  degraded: { label: 'Degraded', color: SIGNAL.needs_human },
  off: { label: 'Not connected', color: SIGNAL.disabled },
};

function AddMcpServer() {
  const add = useAddMcp();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [config, setConfig] = useState('{\n  "command": "npx",\n  "args": ["-y", "@your/mcp-server"],\n  "env": { "API_KEY": "your-key" }\n}');
  const submit = () => add.mutate({ name, config }, { onSuccess: () => { setOpen(false); setName(''); } });
  if (!open) return <button onClick={() => setOpen(true)} className="mt-4 flex h-9 items-center gap-2 rounded-md border border-line bg-surface-2 px-3.5 font-display text-[12.5px] font-semibold text-t2 hover:border-hair"><span className="text-[15px] leading-none">+</span>Add MCP server</button>;
  return (
    <div className="mt-4 rounded-xl border border-line bg-surface p-[18px]">
      <div className="mb-3 font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-dim-2">Add MCP server</div>
      <div className="flex flex-col gap-2.5">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="server name — e.g. linear (letters, digits, -, _)" className="h-9 rounded-md border border-line bg-surface-2 px-3 font-mono text-[12px] text-fg focus:border-brand/60 focus:outline-none" />
        <textarea value={config} onChange={(e) => setConfig(e.target.value)} rows={7} spellCheck={false} className="resize-y rounded-md border border-line bg-code px-3 py-2.5 font-mono text-[12px] leading-[1.5] text-fg focus:border-brand/60 focus:outline-none" />
        <div className="text-[11px] text-dim-2">Drop in a server def — <span className="font-mono text-[#ada695]">command/args/env</span> (stdio) or <span className="font-mono text-[#ada695]">type/url/headers</span> (http/sse). Secrets in <span className="font-mono">env</span>/<span className="font-mono">headers</span> authenticate it. Grant it to a routine by adding its name as a tool; <span className="font-semibold text-t2">Test</span> boots it and lists its tools.</div>
        {add.isError && <div className="text-[12px] text-bad">{(add.error as Error).message}</div>}
        <div className="flex gap-2">
          <button onClick={submit} disabled={add.isPending} className="h-9 rounded-md bg-brand px-3.5 font-display text-[12.5px] font-semibold text-[#16130f] hover:bg-brand-deep disabled:opacity-40">{add.isPending ? 'Saving…' : 'Save server'}</button>
          <button onClick={() => setOpen(false)} className="h-9 rounded-md border border-line bg-surface-2 px-3.5 font-display text-[12.5px] font-semibold text-t2 hover:border-hair">Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function ConnectorsPage() {
  const { data: connectors } = useConnectors();
  const counts = (h: Connector['health']) => (connectors ?? []).filter((c) => c.health === h).length;

  return (
    <div className="font-sans text-fg animate-fade-up">
      <div className="border-b border-line-soft bg-head px-[26px] py-[22px]">
        <div className="mb-3 font-mono text-[12px] font-medium text-dim"><span className="text-brand">Switchboard</span> › Connectors</div>
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="font-display text-[23px] font-bold tracking-tight">Connectors</div>
            <div className="mt-1 text-[13px] text-muted-2">The tools a routine session can be granted. Status reflects this machine — gh keychain, env tokens.</div>
          </div>
        </div>
        <div className="mt-3.5 flex items-center gap-[18px] font-sans text-[12px] font-medium text-muted-2">
          <span className="inline-flex items-center gap-1.5"><Dot color={SIGNAL.success} size={7} /><span className="font-semibold text-t2">{counts('ok')}</span> connected</span>
          <span className="inline-flex items-center gap-1.5"><Dot color={SIGNAL.disabled} size={7} /><span className="font-semibold text-t2">{counts('off')}</span> not connected</span>
        </div>
      </div>

      <div className="px-[26px] py-5 pb-[26px]">
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="border-b border-line bg-surface-2 px-[18px] py-[11px] font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-dim-2" style={GRID}>
            <div /><div>Connector</div><div>Status</div><div>Auth</div><div>Capabilities</div><div className="text-right">Used by</div>
          </div>
          {connectors && connectors.length === 0 && <Empty title="No connectors" hint="Grant github, slack, or web to a routine in its editor." />}
          {connectors?.map((c) => <ConnectorRow key={c.code} c={c} GRID={GRID as React.CSSProperties} />)}
        </div>
        <AddMcpServer />
        <div className="mt-3.5 flex items-center gap-[9px] font-sans text-[11.5px] font-medium text-dim-2">
          <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="#6f685c" strokeWidth="1.6"><circle cx="9" cy="9" r="6.5" /><line x1="9" y1="8" x2="9" y2="12.5" strokeLinecap="round" /><circle cx="9" cy="5.6" r="0.6" fill="#6f685c" /></svg>
          <span><span className="font-semibold text-t2">Test</span> checks a connector live; <span className="font-semibold text-t2">Configure</span> stores a token (Slack/Atlassian) — it's kept in the harness store and loaded into the session env, never the routine file. GitHub uses your <span className="font-mono">gh</span> login.</span>
        </div>
      </div>
    </div>
  );
}
