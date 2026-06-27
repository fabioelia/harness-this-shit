import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCreateRoutine } from '@/lib/api';
import { cn } from '@/lib/utils';

const TRIGGERS = ['schedule', 'push', 'label', 'comment', 'check_run', 'pull_request', 'release', 'sentry', 'slack', 'webhook', 'manual', 'api', 'after'];
const CONNECTORS = ['github', 'slack', 'jira', 'sentry', 'notion', 'figma', 'pagerduty', 'linear'];

const CARD = 'rounded-lg border border-line bg-surface p-[18px]';
const LABEL = 'mb-1.5 font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-dim';
const inputCls =
  'h-9 w-full rounded-md border border-line bg-surface-2 px-3 text-[13px] text-fg placeholder:text-dim-2 focus:border-brand/60 focus:outline-none focus:ring-2 focus:ring-brand/15 transition-colors';

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function ChipToggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-[5px] border px-2.5 py-1 font-mono text-[11px] font-medium transition-colors',
        on ? 'border-brand/50 bg-brand/12 text-brand-soft' : 'border-line bg-surface text-muted hover:border-hair hover:text-t2'
      )}
    >
      {children}
    </button>
  );
}

const onLine = (t: string, slug: string) =>
  ({
    schedule: '- schedule: { cron: "0 9 * * *", tz: UTC }',
    push: '- github: { event: push, branches: [main] }',
    label: '- github: { event: label, name: needs-review, on: added }',
    comment: '- github: { event: issue_comment, on: edited }',
    check_run: '- github: { event: check_run, status: completed }',
    pull_request: '- github: { event: pull_request, actions: [opened, synchronize] }',
    release: '- github: { event: release, actions: [published] }',
    sentry: '- sentry: { event: issue, level: error }',
    slack: '- slack: { channel: C0…, on: message }',
    webhook: `- webhook: { id: ${slug || 'my-routine'} }`,
    manual: '- manual: {}',
    api: '- api: {}',
    after: '- after: { routine: upstream-routine, on: [success] }',
  })[t] ?? `- ${t}: {}`;

export function NewRoutinePage() {
  const navigate = useNavigate();
  const create = useCreateRoutine();

  const [name, setName] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugInput, setSlugInput] = useState('');
  const [summary, setSummary] = useState('');
  const [owner, setOwner] = useState('');
  const [team, setTeam] = useState('');
  const [triggers, setTriggers] = useState<string[]>([]);
  const [connectors, setConnectors] = useState<string[]>([]);
  const [model, setModel] = useState('claude-opus-4-8');
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('main');
  const [prompt, setPrompt] = useState('');

  const slug = slugTouched ? slugInput : slugify(name);
  const toggle = (set: React.Dispatch<React.SetStateAction<string[]>>, v: string) =>
    set((arr) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]));

  const md = useMemo(() => {
    const L: string[] = ['---'];
    L.push(`name: ${name || 'Untitled routine'}`);
    L.push(`slug: ${slug || 'untitled-routine'}`);
    L.push('summary: >-');
    L.push(`  ${summary || 'One line on what this routine does.'}`);
    L.push(`owner: ${owner || 'unassigned'}`);
    L.push(`team: ${team || 'general'}`);
    L.push('on:');
    (triggers.length ? triggers : ['manual']).forEach((t) => L.push(`  ${onLine(t, slug)}`));
    if (connectors.length) {
      L.push('tools:');
      L.push(`  mcp: [${connectors.join(', ')}]`);
    }
    L.push('runtime:');
    L.push(`  model: ${model || 'claude-opus-4-8'}`);
    L.push(`  repo: ${repo || '—'}`);
    L.push(`  branch: ${branch || 'main'}`);
    L.push('---');
    L.push('');
    L.push(prompt.trim() || '## Prompt\nDescribe what this routine should do, step by step.');
    return L.join('\n');
  }, [name, slug, summary, owner, team, triggers, connectors, model, repo, branch, prompt]);

  const valid = name.trim().length > 0 && slug.length > 0;
  function submit() {
    if (!valid) return;
    create.mutate(
      { name: name.trim(), slug, summary, owner, team, triggers, connectors, model, repo, branch, prompt },
      { onSuccess: (r) => navigate(`/routines/${r.slug}`) }
    );
  }

  return (
    <div className="font-sans text-fg animate-fade-up">
      <div className="border-b border-line-soft bg-head px-[26px] py-[22px]">
        <div className="mb-3 font-mono text-[12px] font-medium text-dim">
          <span className="text-brand">Switchboard</span> › <Link to="/" className="text-brand">Fleet</Link> › New routine
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-display text-[23px] font-bold tracking-tight">New routine</div>
            <div className="mt-1 text-[13px] text-muted-2">A routine is one file. Fill these in — the <span className="font-mono text-[#ada695]">.routine.md</span> on the right updates live, and is committed on create.</div>
          </div>
          <div className="flex items-center gap-[9px]">
            <Link to="/" className="flex h-[34px] items-center rounded-md border border-line bg-surface-2 px-[13px] font-display text-[12.5px] font-semibold text-t2 hover:border-hair">Cancel</Link>
            <button
              onClick={submit}
              disabled={!valid || create.isPending}
              className="flex h-[34px] items-center gap-[7px] rounded-md bg-brand px-3.5 font-display text-[12.5px] font-semibold text-[#16130f] transition-colors hover:bg-brand-deep disabled:cursor-not-allowed disabled:opacity-40"
            >
              {create.isPending ? 'Creating…' : 'Create routine'}
            </button>
          </div>
        </div>
        {create.isError && <div className="mt-3 inline-block rounded-md border border-bad/30 bg-bad/10 px-3 py-1.5 text-[12px] text-bad">{(create.error as Error).message}</div>}
      </div>

      <div className="grid gap-[22px] px-[26px] py-[22px] pb-[26px]" style={{ gridTemplateColumns: 'minmax(0,1.35fr) minmax(0,1fr)' }}>
        {/* form */}
        <div className="flex min-w-0 flex-col gap-[18px]">
          <div className={CARD}>
            <div className={`${LABEL.replace('mb-1.5', 'mb-4')}`}>Identity</div>
            <div className="flex flex-col gap-3.5">
              <div>
                <div className={LABEL}>Name</div>
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="PR Attention Digest" className={inputCls} />
              </div>
              <div>
                <div className={LABEL}>Slug · file name</div>
                <div className="flex items-center gap-2">
                  <input value={slug} onChange={(e) => { setSlugTouched(true); setSlugInput(slugify(e.target.value)); }} placeholder="pr-attention-digest" className={cn(inputCls, 'font-mono')} />
                  <span className="shrink-0 font-mono text-[12px] text-dim">.routine.md</span>
                </div>
              </div>
              <div>
                <div className={LABEL}>Summary</div>
                <textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="One line shown in the fleet, the digest, and logs." rows={2} className={cn(inputCls, 'h-auto py-2 leading-snug')} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><div className={LABEL}>Owner</div><input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="ada" className={inputCls} /></div>
                <div><div className={LABEL}>Team</div><input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="platform" className={inputCls} /></div>
              </div>
            </div>
          </div>

          <div className={CARD}>
            <div className={`${LABEL.replace('mb-1.5', 'mb-3')}`}>Triggers · <span className="font-mono lowercase tracking-normal text-dim-2">on:</span></div>
            <div className="flex flex-wrap gap-1.5">
              {TRIGGERS.map((t) => <ChipToggle key={t} on={triggers.includes(t)} onClick={() => toggle(setTriggers, t)}>{t}</ChipToggle>)}
            </div>
            <div className="mt-2.5 text-[11.5px] text-dim-2">{triggers.length ? `${triggers.length} selected — any one firing starts a run.` : 'Pick one or more. None selected defaults to manual.'}</div>
          </div>

          <div className={CARD}>
            <div className={`${LABEL.replace('mb-1.5', 'mb-3')}`}>Connectors · <span className="font-mono lowercase tracking-normal text-dim-2">tools.mcp:</span></div>
            <div className="flex flex-wrap gap-1.5">
              {CONNECTORS.map((c) => <ChipToggle key={c} on={connectors.includes(c)} onClick={() => toggle(setConnectors, c)}>{c}</ChipToggle>)}
            </div>
            <div className="mt-2.5 text-[11.5px] text-dim-2">Grants are deny-by-default — the agent only sees what you select here.</div>
          </div>

          <div className={CARD}>
            <div className={`${LABEL.replace('mb-1.5', 'mb-3')}`}>Runtime</div>
            <div className="grid grid-cols-3 gap-3">
              <div><div className={LABEL}>Model</div><input value={model} onChange={(e) => setModel(e.target.value)} className={cn(inputCls, 'font-mono text-[12px]')} /></div>
              <div><div className={LABEL}>Repo</div><input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="org/repo" className={cn(inputCls, 'font-mono text-[12px]')} /></div>
              <div><div className={LABEL}>Branch</div><input value={branch} onChange={(e) => setBranch(e.target.value)} className={cn(inputCls, 'font-mono text-[12px]')} /></div>
            </div>
          </div>

          <div className={CARD}>
            <div className={`${LABEL.replace('mb-1.5', 'mb-3')}`}>Prompt body</div>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={'## Prompt\nDescribe what this routine should do, step by step.\n\n## Constraints\n- …'} rows={8} className={cn(inputCls, 'h-auto resize-y py-2.5 font-mono text-[12px] leading-[1.6]')} />
          </div>
        </div>

        {/* live preview */}
        <div className="min-w-0">
          <div className="sticky top-6">
            <div className="overflow-hidden rounded-lg border border-line bg-surface">
              <div className="flex items-center justify-between border-b border-line-soft px-4 py-2.5">
                <span className="font-mono text-[12px] font-medium text-t2">{slug || 'untitled-routine'}.routine.md</span>
                <span className="rounded-full border border-ok/30 bg-ok/10 px-2 py-0.5 font-display text-[10px] font-semibold text-ok">live preview</span>
              </div>
              <pre className="max-h-[70vh] overflow-auto bg-code px-4 py-3.5 font-mono text-[12px] leading-[1.7] text-muted">
                {md.split('\n').map((line, i) => (
                  <div key={i} style={line.startsWith('##') ? { color: '#6f685c' } : line === '---' ? { color: '#5d584d' } : undefined}>{line || ' '}</div>
                ))}
              </pre>
            </div>
            <div className="mt-2.5 text-[11.5px] text-dim-2">This is the whole routine — one reviewable file. Editing it later is a commit; the UI writes the same file.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
