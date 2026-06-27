import { Dot, Toggle } from '@/components/sb';
import { useSettings, useSaveSettings } from '@/lib/api';

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
        <div className="mb-3 font-mono text-[12px] font-medium text-dim"><span className="text-brand">Switchboard</span> › Config</div>
        <div className="font-display text-[23px] font-bold tracking-tight">Settings</div>
        <div className="mt-1 text-[13px] text-muted-2">The identities this harness runs as, and the guardrails injected into every routine session.</div>
      </div>
      <div className="mx-auto max-w-[960px] px-[26px] py-6">
        <div className="mb-2 font-display text-[11px] font-semibold uppercase tracking-[0.1em] text-dim-2">Connected identities</div>
        <div className="mb-7 overflow-hidden rounded-xl border border-line bg-surface">
          <Identity ok={!!id?.github.connected} name="GitHub · gh CLI" detail={id?.github.connected ? `@${id.github.account}` : 'run `gh auth login`'} />
          <Identity ok={!!id?.slack.connected} name="Slack · bot" detail={id?.slack.connected ? `${id.slack.team} · @${id.slack.bot}` : 'set SLACK_BOT_TOKEN'} />
        </div>

        <div className="mb-2 font-display text-[11px] font-semibold uppercase tracking-[0.1em] text-dim-2">Session guardrails</div>
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
