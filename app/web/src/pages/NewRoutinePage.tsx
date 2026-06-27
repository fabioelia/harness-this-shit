import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCreateRoutine, useUpdateRoutine, useRoutine, useGithubRepos, useGithubOrgs, useGithubChecks, useModels, useMcp } from '@/lib/api';
import { cn } from '@/lib/utils';

const TRIGGER_GROUPS: { label: string; items: string[] }[] = [
  { label: 'Control', items: ['schedule', 'manual', 'api', 'webhook'] },
  { label: 'GitHub', items: ['push', 'pull_request', 'pull_request_review', 'issues', 'issue_comment', 'label', 'release'] },
  { label: 'CI / checks', items: ['check_run', 'check_suite', 'workflow_run', 'status', 'deployment_status'] },
];
// Only tools the runner actually grants (runner.js allowedToolsFor). No phantom MCPs.
const CONNECTORS = ['github', 'slack', 'web'];

// Reactions the watcher can actually evaluate (index.js pollWatch). Generalizes beyond these.
const REACTION_PRESETS = [
  { label: 'PR checks pass', source: 'github', kind: 'checks', when: 'success' },
  { label: 'PR checks fail', source: 'github', kind: 'checks', when: 'failure' },
  { label: 'PR checks complete (pass or fail)', source: 'github', kind: 'checks', when: 'any' },
  { label: 'PR approved', source: 'github', kind: 'review', when: 'approved' },
  { label: 'PR changes requested', source: 'github', kind: 'review', when: 'changes_requested' },
  { label: 'PR merged', source: 'github', kind: 'merge', when: 'merged' },
  { label: 'After a delay (timeout)', source: 'timeout', kind: 'after', when: '' },
];
const reactionLabel = (r: { source: string; kind: string; when: string; check?: string }) => {
  if (r.source === 'timeout') return `after ${r.when || '?'}`;
  const base = REACTION_PRESETS.find((p) => p.source === r.source && p.kind === r.kind && p.when === r.when)?.label || `${r.source}:${r.kind}:${r.when}`;
  return r.check ? `${base} · ${r.check}` : base;
};

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

type Rx = { source: string; kind: string; when: string; run: string; check?: string };
function ReactionsEditor({ reactions, setReactions, repo }: { reactions: Rx[]; setReactions: (r: Rx[]) => void; repo: string }) {
  const [preset, setPreset] = useState(0);
  const [run, setRun] = useState('');
  const [dur, setDur] = useState('4h');
  const [check, setCheck] = useState('');
  const firstRepo = repo.split(',').map((s) => s.trim()).filter(Boolean)[0] || '';
  const p = REACTION_PRESETS[preset];
  const isChecks = p.kind === 'checks';
  const { data: checksData, isFetching } = useGithubChecks(isChecks ? firstRepo : '');
  const add = () => {
    if (!run.trim()) return;
    const when = p.source === 'timeout' ? dur.trim() : p.when;
    setReactions([...reactions, { source: p.source, kind: p.kind, when, run: slugify(run), check: isChecks ? check : '' }]);
    setRun('');
  };
  const remove = (i: number) => setReactions(reactions.filter((_, x) => x !== i));
  const selCls = 'h-9 shrink-0 rounded-md border border-line bg-surface-2 px-2 font-mono text-[12px] text-fg focus:border-brand/60 focus:outline-none';
  return (
    <div>
      {reactions.length > 0 && (
        <div className="mb-2.5 flex flex-col gap-1.5">
          {reactions.map((r, i) => (
            <div key={i} className="flex items-center gap-2 rounded-md border border-line-soft bg-surface-2 px-2.5 py-1.5 font-mono text-[11.5px]">
              <span className="text-lease">when</span><span className="text-t2">{reactionLabel(r)}</span>
              <span className="text-faint">→ run</span><span className="text-brand">{r.run}</span>
              <button type="button" onClick={() => remove(i)} className="ml-auto text-dim hover:text-bad" aria-label="remove">✕</button>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] text-dim-2">When</span>
        <select value={preset} onChange={(e) => { setPreset(+e.target.value); setCheck(''); }} className={selCls}>
          {REACTION_PRESETS.map((x, i) => <option key={i} value={i}>{x.label}</option>)}
        </select>
        {p.source === 'timeout' && <input value={dur} onChange={(e) => setDur(e.target.value)} placeholder="4h" className={cn(inputCls, 'w-20 font-mono text-[12px]')} />}
        {isChecks && firstRepo && (
          <select value={check} onChange={(e) => setCheck(e.target.value)} className={selCls} title="Which check to watch">
            <option value="">any check</option>
            {(checksData?.checks ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <span className="font-mono text-[11px] text-dim-2">→ run</span>
        <input value={run} onChange={(e) => setRun(e.target.value)} placeholder="routine-slug" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} className={cn(inputCls, 'min-w-[140px] flex-1 font-mono text-[12px]')} />
        <button type="button" onClick={add} className="h-9 shrink-0 rounded-md border border-line bg-surface-2 px-3 font-display text-[12px] font-semibold text-t2 hover:border-hair">Add</button>
      </div>
      {isChecks && firstRepo && <div className="mt-1.5 font-mono text-[10.5px] text-dim">{isFetching ? `discovering checks in ${firstRepo}…` : `${(checksData?.checks ?? []).length} checks found in ${firstRepo}`}</div>}
      {isChecks && !firstRepo && <div className="mt-1.5 font-mono text-[10.5px] text-dim">add a repository above to pick a specific check</div>}
    </div>
  );
}

const onLine = (t: string, slug: string) =>
  ({
    schedule: '- schedule: { cron: "0 9 * * *" }',
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
  const { data: modelsData } = useModels();
  const { data: mcpServers } = useMcp();
  const TOOLS = [...CONNECTORS, ...(mcpServers?.map((m) => m.name) ?? [])];
  const MODELS = modelsData?.models ?? [{ id: 'claude-opus-4-8', label: 'Opus 4.8' }];
  const EFFORTS = modelsData?.efforts ?? ['low', 'medium', 'high', 'xhigh', 'max'];

  const [name, setName] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugInput, setSlugInput] = useState('');
  const [summary, setSummary] = useState('');
  const [owner, setOwner] = useState('');
  const [team, setTeam] = useState('');
  const [triggers, setTriggers] = useState<string[]>([]);
  const [connectors, setConnectors] = useState<string[]>([]);
  const [model, setModel] = useState('claude-opus-4-8');
  const [effort, setEffort] = useState('');
  const [memory, setMemory] = useState(false);
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('main');
  const [prompt, setPrompt] = useState('');
  const [chain, setChain] = useState('');
  const [schedule, setSchedule] = useState('0 9 * * *');
  const [filterActions, setFilterActions] = useState('');
  const [filterBranches, setFilterBranches] = useState('');
  const [reactions, setReactions] = useState<{ source: string; kind: string; when: string; run: string; check?: string }[]>([]);

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
    setModel(d.model || 'claude-opus-4-8'); setEffort(d.effort || ''); setMemory(!!d.memory); setRepo(d.repo || ''); setBranch(d.branch || 'main');
    setPrompt(d.prompt || '');
    setChain(d.chain.join(', '));
    if (d.schedule) setSchedule(d.schedule);
    setFilterActions((d.filters?.actions ?? []).join(', '));
    setFilterBranches((d.filters?.branches ?? []).join(', '));
    setReactions(d.reactions ?? []);
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
    if (!triggers.length) L.push('  # no triggers selected — run-now / API only');
    triggers.forEach((t) => {
      if (t === 'schedule') L.push(`  - schedule: { cron: "${schedule}" }`);
      else if (t === 'push' && filtersObj.branches.length) L.push(`  - push: { branches: [${filtersObj.branches.join(', ')}] }`);
      else if (actionable && filtersObj.actions.length && t !== 'push') L.push(`  - ${t}: { actions: [${filtersObj.actions.join(', ')}] }`);
      else L.push(`  - ${t}: {}`);
    });
    if (connectors.length) { L.push('tools:'); L.push(`  grant: [${connectors.join(', ')}]`); }
    L.push('runtime:');
    L.push(`  model: ${model || 'claude-opus-4-8'}`);
    if (effort) L.push(`  effort: ${effort}`);
    L.push(`  repos: [${repo.split(',').map((s) => s.trim()).filter(Boolean).join(', ') || '*'}]`);
    L.push(`  branch: ${branch || 'main'}`);
    if (memory) L.push('  memory: enabled');
    if (chainArr.length) L.push(`chain: [${chainArr.join(', ')}]`);
    if (reactions.length) {
      L.push('react:');
      reactions.forEach((rx) => L.push(`  - on: ${rx.source}:${rx.kind}${rx.when ? ':' + rx.when : ''}${rx.check ? ` [${rx.check}]` : ''}  →  run: ${rx.run}`));
    }
    L.push('---');
    L.push('');
    L.push(prompt.trim() || '## Prompt\nDescribe what this routine should do, step by step.');
    return L.join('\n');
  }, [name, slug, summary, owner, team, triggers, connectors, model, effort, memory, repo, branch, prompt, chain, schedule, filterActions, filterBranches, reactions]);

  const valid = name.trim().length > 0 && slug.length > 0;
  function submit() {
    if (!valid) return;
    const body = { name: name.trim(), slug, summary, owner, team, triggers, connectors, model, effort, memory, repo, branch, prompt, chain: chainArr, schedule: triggers.includes('schedule') ? schedule.trim() : '', filters: filtersObj, reactions };
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
            <div className="mt-1 text-[13px] text-muted-2">A routine is one definition. Fill these in — the <span className="font-mono text-[#ada695]">.routine.md</span> preview on the right updates live, and is saved on {isEdit ? 'save' : 'create'}.</div>
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
              {TOOLS.map((c) => <ChipToggle key={c} on={connectors.includes(c)} onClick={() => toggle(setConnectors, c)}>{c}</ChipToggle>)}
            </div>
            <div className="mt-2.5 text-[11.5px] text-dim-2">Deny-by-default. The session uses these to do the work — <span className="font-mono">github</span> → gh CLI, <span className="font-mono">slack</span> → bot, <span className="font-mono">web</span> → fetch. Custom <span className="font-mono">MCP</span> servers (added on the Connectors page) appear here too. Just say what to do in the prompt.</div>
          </div>

          <div className={CARD}>
            <div className={`${LABEL.replace('mb-1.5', 'mb-3')}`}>Chain · <span className="font-mono lowercase tracking-normal text-dim-2">kick off downstream routines now</span></div>
            <input value={chain} onChange={(e) => setChain(e.target.value)} placeholder="other-routine-slug, another-one" className={cn(inputCls, 'font-mono text-[12px]')} />
            <div className="mt-2.5 text-[11.5px] text-dim-2">On success, these routines fire <span className="text-t2">immediately</span> — the downstream session gets this run’s output in its event payload at <span className="font-mono text-[#ada695]">upstream.output</span>.</div>
          </div>

          <div className={CARD}>
            <div className={`${LABEL.replace('mb-1.5', 'mb-3')}`}>React · <span className="font-mono lowercase tracking-normal text-dim-2">follow the work this routine creates</span></div>
            <ReactionsEditor reactions={reactions} setReactions={setReactions} repo={repo} />
            <div className="mt-2.5 text-[11.5px] text-dim-2">After a run resolves a PR, Switchboard <span className="text-t2">watches</span> it and fires the chosen routine <span className="text-t2">later</span> when the condition is met — e.g. when CI checks finish. Polls with <span className="font-mono">gh</span>, so no webhook needed. A <span className="font-mono">timeout</span> fires after a delay if nothing resolved first.</div>
          </div>

          <div className={CARD}>
            <div className={`${LABEL.replace('mb-1.5', 'mb-3')}`}>Runtime</div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className={LABEL}>Model</div>
                <select value={model} onChange={(e) => setModel(e.target.value)} className={cn(inputCls, 'font-mono text-[12px]')}>
                  {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <div className={LABEL}>Effort</div>
                <select value={effort} onChange={(e) => setEffort(e.target.value)} className={cn(inputCls, 'font-mono text-[12px]')}>
                  <option value="">default</option>
                  {EFFORTS.map((e) => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>
              <div><div className={LABEL}>Branch</div><input value={branch} onChange={(e) => setBranch(e.target.value)} className={cn(inputCls, 'font-mono text-[12px]')} /></div>
            </div>
            <div className="mt-2.5 text-[11.5px] text-dim-2">The session runs on this model (passed to <span className="font-mono">claude --model</span>); effort tunes its reasoning depth (<span className="font-mono">--effort</span>).</div>
            <label className="mt-3.5 flex cursor-pointer items-start gap-2.5 border-t border-line-soft pt-3">
              <input type="checkbox" checked={memory} onChange={(e) => setMemory(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#5b9ee6]" />
              <div>
                <div className="font-display text-[12.5px] font-semibold text-t2">Persistent memory</div>
                <div className="text-[11px] text-dim-2">Grant a <span className="font-mono text-[#ada695]">memory.md</span> the session reads at the start and updates as it learns — durable facts carry across runs.</div>
              </div>
            </label>
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
            <div className="mt-2.5 text-[11.5px] text-dim-2">This preview is the whole routine — one reviewable definition. Editing it later updates the same record.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
