import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCreateRoutine, useUpdateRoutine, useRoutine, useGithubRepos, useGithubOrgs } from '@/lib/api';
import { cn } from '@/lib/utils';

const TRIGGER_GROUPS: { label: string; items: string[] }[] = [
  { label: 'Control', items: ['schedule', 'manual', 'api', 'webhook'] },
  { label: 'GitHub', items: ['push', 'pull_request', 'pull_request_review', 'issues', 'issue_comment', 'label', 'release'] },
  { label: 'CI / checks', items: ['check_run', 'check_suite', 'workflow_run', 'status', 'deployment_status'] },
  { label: 'Other sources', items: ['sentry', 'slack'] },
];
// Only tools the runner actually grants (runner.js allowedToolsFor). No phantom MCPs.
const CONNECTORS = ['github', 'slack', 'web'];

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

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

function RepoPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: orgsData } = useGithubOrgs();
  const orgs = orgsData?.orgs ?? [];
  const [owner, setOwner] = useState(''); // '' = my repos, '*' = search all GitHub, else an org
  const [draft, setDraft] = useState('');
  const q = useDebounced(draft.trim(), 300);
  const searchMode = owner === '*';
  // In search mode the query drives results; otherwise we list the owner's repos and filter client-side.
  const { data, isFetching } = useGithubRepos(owner, searchMode ? q : '');
  const repos = value.split(',').map((s) => s.trim()).filter(Boolean);
  const all = data?.repos ?? [];
  const suggestions = (searchMode ? all : all.filter((r) => r.toLowerCase().includes(draft.toLowerCase())))
    .filter((r) => !repos.includes(r))
    .slice(0, 60);
  const add = (v: string) => { const t = v.trim(); if (t && !repos.includes(t)) onChange([...repos, t].join(', ')); setDraft(''); };
  const remove = (r: string) => onChange(repos.filter((x) => x !== r).join(', '));
  const selCls = 'h-9 shrink-0 rounded-md border border-line bg-surface-2 px-2 font-mono text-[12px] text-fg focus:border-brand/60 focus:outline-none';
  return (
    <div>
      {repos.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {repos.map((r) => (
            <span key={r} className="inline-flex items-center gap-1.5 rounded-md border border-brand/40 bg-brand/10 py-1 pl-2.5 pr-1.5 font-mono text-[11.5px] font-medium text-brand-soft">
              {r}
              <button type="button" onClick={() => remove(r)} className="text-brand/60 hover:text-brand" aria-label={`remove ${r}`}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <select value={owner} onChange={(e) => { setOwner(e.target.value); setDraft(''); }} className={selCls} title="Owner / org to browse">
          <option value="">My repos</option>
          {orgs.map((o) => <option key={o} value={o}>{o}</option>)}
          <option value="*">Search all GitHub…</option>
        </select>
        <input
          list="gh-repos"
          value={draft}
          onChange={(e) => { const v = e.target.value; if (all.includes(v)) add(v); else setDraft(v); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(draft); } }}
          placeholder={searchMode ? 'search repos across GitHub — type a name…' : 'filter, or type org/repo · Enter to add'}
          className={cn(inputCls, 'font-mono text-[12px]')}
        />
      </div>
      <datalist id="gh-repos">{suggestions.map((r) => <option key={r} value={r} />)}</datalist>
      {isFetching && <div className="mt-1.5 font-mono text-[10.5px] text-dim">{searchMode ? 'searching GitHub…' : 'loading repos…'}</div>}
    </div>
  );
}

const onLine = (t: string, slug: string) =>
  ({
    schedule: '- schedule: { cron: "0 9 * * *", tz: UTC }',
    push: '- github: { event: push, branches: [main] }',
    label: '- github: { event: label, name: needs-review, on: added }',
    comment: '- github: { event: issue_comment, on: edited }',
    check_run: '- github: { event: check_run, status: completed, conclusion: [success, failure] }',
    check_suite: '- github: { event: check_suite, status: completed }',
    workflow_run: '- github: { event: workflow_run, status: completed }',
    status: '- github: { event: status, state: [success, failure] }',
    deployment_status: '- github: { event: deployment_status }',
    pull_request: '- github: { event: pull_request, actions: [opened, synchronize, reopened] }',
    pull_request_review: '- github: { event: pull_request_review, state: changes_requested }',
    issues: '- github: { event: issues, actions: [opened, labeled] }',
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
  const { slug: editSlug } = useParams();
  const isEdit = !!editSlug;
  const existing = useRoutine(editSlug);
  const create = useCreateRoutine();
  const update = useUpdateRoutine();
  const mut = isEdit ? update : create;

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
  const [chain, setChain] = useState('');
  const [schedule, setSchedule] = useState('0 9 * * *');
  const [filterActions, setFilterActions] = useState('');
  const [filterBranches, setFilterBranches] = useState('');

  const slug = slugTouched ? slugInput : slugify(name);
  // CI / GitHub events that carry an `action` and can be filtered.
  const actionable = triggers.some((t) => ['pull_request', 'pull_request_review', 'issues', 'issue_comment', 'label', 'release', 'check_run', 'check_suite', 'workflow_run', 'deployment_status'].includes(t));
  const filtersObj = {
    actions: filterActions.split(',').map((s) => s.trim()).filter(Boolean),
    branches: filterBranches.split(',').map((s) => s.trim()).filter(Boolean),
  };
  const toggle = (set: React.Dispatch<React.SetStateAction<string[]>>, v: string) =>
    set((arr) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]));
  const chainArr = chain.split(',').map((s) => slugify(s)).filter(Boolean);

  // Prefill when editing
  useEffect(() => {
    const d = existing.data;
    if (!isEdit || !d) return;
    setName(d.name); setSlugTouched(true); setSlugInput(d.slug);
    setSummary(d.summary); setOwner(d.owner); setTeam(d.team);
    setTriggers(d.triggers); setConnectors(d.connectors);
    setModel(d.model || 'claude-opus-4-8'); setRepo(d.repo || ''); setBranch(d.branch || 'main');
    setPrompt(d.prompt || '');
    setChain(d.chain.join(', '));
    if (d.schedule) setSchedule(d.schedule);
    setFilterActions((d.filters?.actions ?? []).join(', '));
    setFilterBranches((d.filters?.branches ?? []).join(', '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data, isEdit]);

  const md = useMemo(() => {
    const L: string[] = ['---'];
    L.push(`name: ${name || 'Untitled routine'}`);
    L.push(`slug: ${slug || 'untitled-routine'}`);
    L.push('summary: >-');
    L.push(`  ${summary || 'One line on what this routine does.'}`);
    L.push(`owner: ${owner || 'unassigned'}`);
    L.push(`team: ${team || 'general'}`);
    L.push('on:');
    (triggers.length ? triggers : ['manual']).forEach((t) => {
      if (t === 'schedule') L.push(`  - schedule: { cron: "${schedule}" }`);
      else if (t === 'push' && filtersObj.branches.length) L.push(`  - push: { branches: [${filtersObj.branches.join(', ')}] }`);
      else if (actionable && filtersObj.actions.length && t !== 'push') L.push(`  - ${t}: { actions: [${filtersObj.actions.join(', ')}] }`);
      else L.push(`  ${onLine(t, slug)}`);
    });
    if (connectors.length) {
      L.push('tools:');
      L.push(`  mcp: [${connectors.join(', ')}]`);
    }
    L.push('runtime:');
    L.push(`  model: ${model || 'claude-opus-4-8'}`);
    L.push(`  repos: [${repo.split(',').map((s) => s.trim()).filter(Boolean).join(', ') || '*'}]`);
    L.push(`  branch: ${branch || 'main'}`);
    if (chainArr.length) L.push(`chain: [${chainArr.join(', ')}]`);
    L.push('---');
    L.push('');
    L.push(prompt.trim() || '## Prompt\nDescribe what this routine should do, step by step.');
    return L.join('\n');
  }, [name, slug, summary, owner, team, triggers, connectors, model, repo, branch, prompt, chain, schedule, filterActions, filterBranches]);

  const valid = name.trim().length > 0 && slug.length > 0;
  function submit() {
    if (!valid) return;
    const body = { name: name.trim(), slug, summary, owner, team, triggers, connectors, model, repo, branch, prompt, chain: chainArr, schedule: triggers.includes('schedule') ? schedule.trim() : '', filters: filtersObj };
    if (isEdit) update.mutate({ slug: editSlug!, body }, { onSuccess: () => navigate(`/routines/${editSlug}`) });
    else create.mutate(body, { onSuccess: (r) => navigate(`/routines/${r.slug}`) });
  }

  return (
    <div className="font-sans text-fg animate-fade-up">
      <div className="border-b border-line-soft bg-head px-[26px] py-[22px]">
        <div className="mb-3 font-mono text-[12px] font-medium text-dim">
          <span className="text-brand">Switchboard</span> › <Link to="/" className="text-brand">Fleet</Link> › {isEdit ? <><Link to={`/routines/${editSlug}`} className="text-brand">{editSlug}</Link> › Edit</> : 'New routine'}
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-display text-[23px] font-bold tracking-tight">{isEdit ? 'Edit routine' : 'New routine'}</div>
            <div className="mt-1 text-[13px] text-muted-2">A routine is one file. Fill these in — the <span className="font-mono text-[#ada695]">.routine.md</span> on the right updates live, and is committed on {isEdit ? 'save' : 'create'}.</div>
          </div>
          <div className="flex items-center gap-[9px]">
            <Link to={isEdit ? `/routines/${editSlug}` : '/'} className="flex h-[34px] items-center rounded-md border border-line bg-surface-2 px-[13px] font-display text-[12.5px] font-semibold text-t2 hover:border-hair">Cancel</Link>
            <button
              onClick={submit}
              disabled={!valid || mut.isPending}
              className="flex h-[34px] items-center gap-[7px] rounded-md bg-brand px-3.5 font-display text-[12.5px] font-semibold text-[#16130f] transition-colors hover:bg-brand-deep disabled:cursor-not-allowed disabled:opacity-40"
            >
              {mut.isPending ? (isEdit ? 'Saving…' : 'Creating…') : isEdit ? 'Save changes' : 'Create routine'}
            </button>
          </div>
        </div>
        {mut.isError && <div className="mt-3 inline-block rounded-md border border-bad/30 bg-bad/10 px-3 py-1.5 text-[12px] text-bad">{(mut.error as Error).message}</div>}
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
                  <input value={slug} readOnly={isEdit} onChange={(e) => { setSlugTouched(true); setSlugInput(slugify(e.target.value)); }} placeholder="pr-attention-digest" className={cn(inputCls, 'font-mono', isEdit && 'opacity-60')} />
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

          {/* Repo-first: pick the repos, then the GitHub/CI triggers below are scoped to them. */}
          <div className={CARD}>
            <div className={`${LABEL.replace('mb-1.5', 'mb-3')}`}>Repositories · <span className="font-mono lowercase tracking-normal text-dim-2">which repos to watch</span></div>
            <RepoPicker value={repo} onChange={setRepo} />
            <div className="mt-2.5 text-[11.5px] text-dim-2">Pick these first — the GitHub & CI triggers below are scoped to them. Leave empty to react to <span className="font-mono">any</span> repo. Choose from your repos/orgs, or search all of GitHub.</div>
          </div>

          <div className={CARD}>
            <div className={`${LABEL.replace('mb-1.5', 'mb-3')}`}>Triggers · <span className="font-mono lowercase tracking-normal text-dim-2">on:</span></div>
            <div className="flex flex-col gap-3">
              {TRIGGER_GROUPS.map((g) => (
                <div key={g.label}>
                  <div className="mb-1.5 flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-dim-2">
                    {g.label}
                    {(g.label === 'GitHub' || g.label === 'CI / checks') && (
                      <span className="normal-case tracking-normal text-dim-3">→ {repo ? repo.split(',').map((s) => s.trim()).filter(Boolean).join(', ') : 'any repo'}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {g.items.map((t) => <ChipToggle key={t} on={triggers.includes(t)} onClick={() => toggle(setTriggers, t)}>{t}</ChipToggle>)}
                  </div>
                </div>
              ))}
            </div>
            {triggers.includes('schedule') && (
              <div className="mt-3.5 border-t border-line-soft pt-3">
                <div className={LABEL}>Schedule · <span className="font-mono lowercase tracking-normal text-dim-2">cron — min hour dom mon dow</span></div>
                <input value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="0 9 * * *" className={cn(inputCls, 'font-mono text-[12px]')} />
                <div className="mt-1.5 text-[11px] text-dim-2">Server local time. <span className="font-mono">0 9 * * 1-5</span> = weekdays 9am · <span className="font-mono">*/15 * * * *</span> = every 15 min.</div>
              </div>
            )}
            {triggers.includes('push') && (
              <div className="mt-3.5 border-t border-line-soft pt-3">
                <div className={LABEL}>Push branches · <span className="font-mono lowercase tracking-normal text-dim-2">optional filter</span></div>
                <input value={filterBranches} onChange={(e) => setFilterBranches(e.target.value)} placeholder="main, develop  ·  blank = any branch" className={cn(inputCls, 'font-mono text-[12px]')} />
              </div>
            )}
            {actionable && (
              <div className="mt-3.5 border-t border-line-soft pt-3">
                <div className={LABEL}>Event actions · <span className="font-mono lowercase tracking-normal text-dim-2">optional filter</span></div>
                <input value={filterActions} onChange={(e) => setFilterActions(e.target.value)} placeholder="opened, synchronize, reopened  ·  blank = all actions" className={cn(inputCls, 'font-mono text-[12px]')} />
                <div className="mt-1.5 text-[11px] text-dim-2">Only fire when the event’s <span className="font-mono">action</span>/conclusion matches — e.g. PR <span className="font-mono">opened</span>, check_run <span className="font-mono">completed</span>.</div>
              </div>
            )}
            <div className="mt-3 text-[11.5px] text-dim-2">{triggers.length ? `${triggers.length} selected — any one firing starts a run.` : 'Pick one or more. None selected defaults to manual.'}</div>
          </div>

          <div className={CARD}>
            <div className={`${LABEL.replace('mb-1.5', 'mb-3')}`}>Tools the session can use</div>
            <div className="flex flex-wrap gap-1.5">
              {CONNECTORS.map((c) => <ChipToggle key={c} on={connectors.includes(c)} onClick={() => toggle(setConnectors, c)}>{c}</ChipToggle>)}
            </div>
            <div className="mt-2.5 text-[11.5px] text-dim-2">Deny-by-default. The session is autonomous and uses these to do the work — <span className="font-mono">github</span> → gh CLI, <span className="font-mono">slack</span> → post via the bot, <span className="font-mono">web</span> → fetch. Just say what to do in the prompt.</div>
          </div>

          <div className={CARD}>
            <div className={`${LABEL.replace('mb-1.5', 'mb-3')}`}>Chain · <span className="font-mono lowercase tracking-normal text-dim-2">kick off downstream routines</span></div>
            <input value={chain} onChange={(e) => setChain(e.target.value)} placeholder="other-routine-slug, another-one" className={cn(inputCls, 'font-mono text-[12px]')} />
            <div className="mt-2.5 text-[11.5px] text-dim-2">On success, these routines fire with this run’s output as <span className="font-mono text-[#ada695]">{'${upstream.output}'}</span>.</div>
          </div>

          <div className={CARD}>
            <div className={`${LABEL.replace('mb-1.5', 'mb-3')}`}>Runtime</div>
            <div className="grid grid-cols-2 gap-3">
              <div><div className={LABEL}>Model</div><input value={model} onChange={(e) => setModel(e.target.value)} className={cn(inputCls, 'font-mono text-[12px]')} /></div>
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
