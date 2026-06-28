import { useState } from 'react';
import { Dot, Toggle } from '@/components/sb';
import { cn } from '@/lib/utils';
import { useSettings, useSaveSettings, useWebhookConfig, useRepoHooks, useWebhookActions, useWebhookDeliveries } from '@/lib/api';

export function SettingsPage() {
  const { data } = useSettings();
  const save = useSaveSettings();
  const id = data?.identities;

  const togglePolicy = (key: string, on: boolean) => {
    const map: Record<string, boolean> = {};
    (data?.policies || []).forEach((p) => (map[p.key] = p.key === key ? on : p.on));
    save.mutate(map);
  };

  const Identity = ({ ok, name, detail }: { ok: boolean; name: string; detail: string }) => (
    <div className="flex items-center gap-3 border-b border-line-soft px-5 py-3.5 last:border-0">
      <Dot color={ok ? '#5fbf86' : '#5d594f'} size={8} pulse={ok} />
      <div className="flex-1">
        <div className="font-display text-[13px] font-semibold text-fg">{name}</div>
        <div className="font-mono text-[11.5px] text-muted-2">{detail}</div>
      </div>
      <span className={`font-display text-[11px] font-semibold ${ok ? 'text-ok' : 'text-dim'}`}>{ok ? 'Connected' : 'Not connected'}</span>
    </div>
  );

  return (
    <div className="font-sans text-fg animate-fade-up">
      <div className="border-b border-line-soft bg-head px-[26px] py-[22px]">
        <div className="mb-3 font-mono text-[12px] font-medium text-dim"><span className="text-brand">Switchboard</span> › Settings</div>
        <div className="font-display text-[23px] font-bold tracking-tight">Settings</div>
        <div className="mt-1 text-[13px] text-muted-2">The identities this harness runs as, and the guardrails injected into every routine session.</div>
      </div>
      <div className="mx-auto max-w-[960px] px-[26px] py-6">
        {/* The Claude account every routine session runs as. */}
        <div className="mb-2 font-display text-[11px] font-semibold uppercase tracking-[0.1em] text-dim-2">Claude account · runs every session</div>
        <div className="mb-6 overflow-hidden rounded-xl border bg-surface" style={{ borderColor: id?.claude?.loggedIn ? 'rgba(95,191,134,.3)' : 'var(--line)' }}>
          <div className="flex items-center gap-3.5 px-5 py-4">
            <Dot color={id?.claude?.loggedIn ? '#5fbf86' : '#e6b052'} size={9} pulse={!!id?.claude?.loggedIn} />
            <div className="flex-1">
              {id?.claude?.loggedIn ? (
                <>
                  <div className="font-display text-[14px] font-semibold text-fg">{id.claude.email}</div>
                  <div className="font-mono text-[11.5px] text-muted-2">{id.claude.org} · {id.claude.plan} plan · via {id.claude.method}</div>
                </>
              ) : (
                <>
                  <div className="font-display text-[14px] font-semibold text-warn">Not signed in</div>
                  <div className="font-mono text-[11.5px] text-muted-2">Run <span className="text-[var(--code-accent)]">claude auth login</span> (or <span className="text-[var(--code-accent)]">! claude auth login</span>) in a terminal to authenticate the account sessions run as.</div>
                </>
              )}
            </div>
            <span className={`font-display text-[11px] font-semibold ${id?.claude?.loggedIn ? 'text-ok' : 'text-warn'}`}>{id?.claude?.loggedIn ? 'Authenticated' : 'Action needed'}</span>
          </div>
        </div>

        <div className="mb-2 font-display text-[11px] font-semibold uppercase tracking-[0.1em] text-dim-2">Connected identities</div>
        <div className="mb-7 overflow-hidden rounded-xl border border-line bg-surface">
          <Identity ok={!!id?.github.connected} name="GitHub · gh CLI" detail={id?.github.connected ? `@${id.github.account}` : 'run `gh auth login`'} />
          <Identity ok={!!id?.slack.connected} name="Slack · bot" detail={id?.slack.connected ? `${id.slack.team} · @${id.slack.bot}` : 'configure a token on the Connectors page'} />
          <div className="px-5 py-3 font-mono text-[11px] text-dim">Manage & test these on the <a href="/connectors" className="text-brand">Connectors</a> page.</div>
        </div>

        <div className="mb-2 font-display text-[11px] font-semibold uppercase tracking-[0.1em] text-dim-2">GitHub webhooks · make triggers fire for real</div>
        <WebhooksPanel />

        <div className="mb-2 mt-7 font-display text-[11px] font-semibold uppercase tracking-[0.1em] text-dim-2">Session guardrails</div>
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          {(data?.policies || []).map((p) => (
            <div key={p.key} className="flex items-center gap-3 border-b border-line-soft px-5 py-3.5 last:border-0">
              <div className="flex-1">
                <div className="font-display text-[13px] font-semibold text-fg">{p.title}</div>
                <div className="text-[12px] text-muted-2">{p.desc}</div>
              </div>
              <Toggle on={p.on} onCheckedChange={(v) => togglePolicy(p.key, v)} />
            </div>
          ))}
          <div className="px-5 py-3.5 text-[12px] text-dim-2">Each enabled guardrail is injected into every routine session as a hard constraint. Changes persist immediately.</div>
        </div>
      </div>
    </div>
  );
}

const fld = 'h-9 rounded-md border border-line bg-surface-2 px-3 font-mono text-[12px] text-fg focus:border-brand/60 focus:outline-none';
const btn = 'h-9 rounded-md border border-line bg-surface-2 px-3.5 font-display text-[12.5px] font-semibold text-t2 hover:border-hair disabled:opacity-40';

function WebhooksPanel() {
  const { data: cfg } = useWebhookConfig();
  const { data: deliv } = useWebhookDeliveries();
  const a = useWebhookActions();
  const [repo, setRepo] = useState('fabioelia/harness-this-shit');
  const [urlDraft, setUrlDraft] = useState('');
  const { data: hooksData } = useRepoHooks(repo);
  const hooks = hooksData?.hooks ?? [];
  const receiver = cfg?.receiverUrl;
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      {/* public URL / tunnel */}
      <div className="border-b border-line-soft px-5 py-4">
        <div className="mb-1 flex items-center gap-2"><Dot color={cfg?.publicUrl ? '#5fbf86' : '#e6b052'} size={8} pulse={!!cfg?.tunnel?.running} /><span className="font-display text-[13px] font-semibold">Public URL</span>{cfg?.tunnel?.running && <span className="rounded bg-ok/15 px-1.5 py-px font-mono text-[10px] text-ok">tunnel up</span>}</div>
        <div className="mb-2 text-[12px] text-muted-2">GitHub needs a public URL to reach this local harness. Start a quick <span className="font-mono">cloudflared</span> tunnel, or paste your own (ngrok, a domain…).</div>
        {receiver ? <div className="mb-2 font-mono text-[11.5px] text-t2">receiver: <span className="text-[var(--code-accent)]">{receiver}</span></div> : <div className="mb-2 font-mono text-[11.5px] text-dim">no public URL yet</div>}
        <div className="flex flex-wrap items-center gap-2">
          {cfg?.tunnel?.running
            ? <button onClick={() => a.stopTunnel.mutate()} className={cn(btn, 'border-bad/40 text-bad')}>Stop tunnel</button>
            : <button onClick={() => a.startTunnel.mutate()} disabled={a.startTunnel.isPending} className={cn(btn, 'border-brand/50 text-brand-soft')}>{a.startTunnel.isPending ? 'Starting…' : 'Start cloudflared tunnel'}</button>}
          <input value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} placeholder="or paste https://your-tunnel.example" className={cn(fld, 'min-w-[260px] flex-1')} />
          <button onClick={() => a.setUrl.mutate(urlDraft.trim())} disabled={!urlDraft.trim()} className={btn}>Set URL</button>
        </div>
        {a.startTunnel.data?.error && <div className="mt-1.5 text-[12px] text-bad">{a.startTunnel.data.error}</div>}
      </div>
      {/* secret */}
      <div className="flex items-center gap-3 border-b border-line-soft px-5 py-3.5">
        <Dot color={cfg?.secretSet ? '#5fbf86' : '#e6b052'} size={8} />
        <div className="flex-1"><div className="font-display text-[13px] font-semibold">Signing secret</div><div className="text-[12px] text-muted-2">HMAC-verifies every delivery (X-Hub-Signature-256). {cfg?.secretSet ? 'Set — kept server-side, never shown.' : 'Not set — generate one before installing.'}</div></div>
        <button onClick={() => a.genSecret.mutate()} className={btn}>{cfg?.secretSet ? 'Rotate' : 'Generate'}</button>
      </div>
      {/* per-repo install */}
      <div className="px-5 py-4">
        <div className="mb-2 font-display text-[13px] font-semibold">Install on a repo</div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/name" className={cn(fld, 'min-w-[240px] flex-1')} />
          <button onClick={() => a.setup.mutate(repo)} disabled={!receiver || a.setup.isPending} className={cn(btn, 'border-brand/50 bg-brand/10 text-brand-soft')}>{a.setup.isPending ? 'Installing…' : 'Install webhook'}</button>
        </div>
        {!receiver && <div className="mb-2 text-[11.5px] text-warn">Set a public URL above first.</div>}
        {a.setup.data?.error && <div className="mb-2 text-[12px] text-bad">{a.setup.data.error}</div>}
        {hooks.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {hooks.map((h) => (
              <div key={h.id} className="flex items-center gap-2 rounded-md border border-line-soft bg-surface-2 px-3 py-2 font-mono text-[11.5px]">
                <Dot color={h.active ? '#5fbf86' : '#5d594f'} size={7} />
                <span className={cn('truncate', h.ours ? 'text-t2' : 'text-dim')}>{h.url}</span>
                {h.ours && <span className="shrink-0 rounded bg-brand/15 px-1.5 py-px text-[10px] text-brand-soft">this harness</span>}
                <span className="ml-auto shrink-0 text-dim">{h.events.length} events</span>
                <button onClick={() => a.remove.mutate({ repo, id: h.id })} className="shrink-0 text-dim hover:text-bad">remove</button>
              </div>
            ))}
          </div>
        )}
        <div className="mt-2.5 text-[11px] text-dim-2">Installs a hook (pull_request, issue_comment, push, check_run, release…) pointing at this harness. The quick cloudflared URL is ephemeral — for always-on, use a named tunnel or a domain.</div>
      </div>
      {/* recent deliveries */}
      <div className="border-t border-line-soft px-5 py-4">
        <div className="mb-2 font-display text-[13px] font-semibold">Recent deliveries</div>
        {!deliv || deliv.deliveries.length === 0 ? (
          <div className="font-mono text-[11.5px] text-dim">No inbound events yet — they appear here the moment a webhook or API event arrives.</div>
        ) : (
          <div className="flex flex-col gap-1">
            {deliv.deliveries.slice(0, 12).map((x, i) => (
              <div key={i} className="flex items-center gap-2 font-mono text-[11px]">
                <span className={`w-[52px] shrink-0 ${x.source === 'webhook' ? 'text-lease' : 'text-dim'}`}>{x.source}</span>
                <span className="w-[120px] shrink-0 truncate text-t2">{x.type}{x.action ? `:${x.action}` : ''}</span>
                <span className="flex-1 truncate text-dim-2">{x.repo}{x.pr ? ` #${x.pr}` : ''}{x.labels.length ? ` [${x.labels.join(',')}]` : ''}</span>
                <span className="shrink-0">{x.matched.length ? <span className="text-ok">→ {x.matched.join(', ')}</span> : <span className="text-dim">no match</span>}</span>
                <span className="w-[56px] shrink-0 text-right text-dim">{x.ago}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
