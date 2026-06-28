import { useEffect, useId, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCreateRoutine, useUpdateRoutine, useRoutine, useRoutines, useGithubRepos, useGithubOrgs, useGithubChecks, useGithubLabels, useModels, useMcp, useTemplates } from '@/lib/api';
import type { RoutineTemplate } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useOperator } from '@/lib/operator';

// Dropdown of known values that also accepts free text — selected items become chips.
function TokenPicker({ value, onChange, suggestions, placeholder }: { value: string; onChange: (v: string) => void; suggestions: string[]; placeholder: string }) {
  const tokens = value.split(',').map((s) => s.trim()).filter(Boolean);
  const [draft, setDraft] = useState('');
  const listId = useId();
  const add = (v: string) => { const t = v.trim(); if (t && !tokens.includes(t)) onChange([...tokens, t].join(', ')); setDraft(''); };
  const remove = (t: string) => onChange(tokens.filter((x) => x !== t).join(', '));
  const avail = suggestions.filter((s) => !tokens.includes(s));
  return (
    <div>
      {tokens.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {tokens.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded border border-brand/40 bg-brand/10 py-0.5 pl-2 pr-1 font-mono text-[11px] text-brand-soft">
              {t}<button type="button" onClick={() => remove(t)} className="text-brand/60 hover:text-brand" aria-label={`remove ${t}`}>×</button>
            </span>
          ))}
        </div>
      )}
      <input
        list={listId}
        value={draft}
        onChange={(e) => { const v = e.target.value; if (suggestions.includes(v)) add(v); else setDraft(v); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(draft); } }}
        placeholder={placeholder}
        className={cn(inputCls, 'h-8 font-mono text-[12px]')}
      />
      <datalist id={listId}>{avail.map((s) => <option key={s} value={s} />)}</datalist>
    </div>
  );
}

type Cond = { field: string; op: string; values: string[] };
type FilterGroup = { match: 'all' | 'any'; conditions: Cond[] };
type ValueGroup = { label: string; items: string[] };
const FILTER_FIELDS = [
  { v: 'action', label: 'action / conclusion' }, { v: 'check', label: 'check / job name' }, { v: 'label', label: 'label' },
  { v: 'branch', label: 'head branch' }, { v: 'base', label: 'base branch' },
  { v: 'author', label: 'author' }, { v: 'title', label: 'title' }, { v: 'draft', label: 'draft' },
];

// Action/conclusion suggestions, grouped by category, contextual to the chosen triggers.
function actionGroups(triggers: string[]): ValueGroup[] {
  const has = (...t: string[]) => t.some((x) => triggers.includes(x));
  const g: ValueGroup[] = [];
  if (has('pull_request', 'pull_request_target', 'issues', 'label', 'issue_comment'))
    g.push({ label: 'PR / issue actions', items: ['opened', 'synchronize', 'reopened', 'closed', 'edited', 'ready_for_review', 'labeled', 'unlabeled', 'assigned', 'created', 'deleted'] });
  if (has('pull_request_review')) g.push({ label: 'Review', items: ['submitted', 'dismissed', 'approved', 'changes_requested', 'commented'] });
  if (has('release')) g.push({ label: 'Release', items: ['published', 'released', 'prereleased', 'created', 'edited'] });
  if (has('check_run', 'check_suite', 'workflow_run', 'status', 'deployment_status')) {
    g.push({ label: 'CI conclusion', items: ['success', 'failure', 'neutral', 'cancelled', 'timed_out', 'action_required', 'skipped', 'error', 'pending'] });
    g.push({ label: 'CI status', items: ['queued', 'in_progress', 'completed', 'requested'] });
  }
  return g.length ? g : [{ label: 'Actions', items: ['opened', 'closed', 'edited'] }];
}

// Dropdown of category-grouped values that also accepts free text; selections become chips.
function GroupedPicker({ value, onChange, groups, placeholder }: { value: string; onChange: (v: string) => void; groups: ValueGroup[]; placeholder: string }) {
  const tokens = value.split(',').map((s) => s.trim()).filter(Boolean);
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const add = (v: string) => { const t = v.trim(); if (t && !tokens.includes(t)) onChange([...tokens, t].join(', ')); setDraft(''); };
  const remove = (t: string) => onChange(tokens.filter((x) => x !== t).join(', '));
  const q = draft.toLowerCase();
  const filtered = groups
    .map((g) => ({ label: g.label, items: g.items.filter((it) => !tokens.includes(it) && (!q || it.toLowerCase().includes(q))) }))
    .filter((g) => g.items.length);
  return (
    <div className="relative">
      {tokens.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {tokens.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded border border-brand/40 bg-brand/10 py-0.5 pl-2 pr-1 font-mono text-[11px] text-brand-soft">
              {t}<button type="button" onClick={() => remove(t)} className="text-brand/60 hover:text-brand" aria-label={`remove ${t}`}>×</button>
            </span>
          ))}
        </div>
      )}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(draft); } }}
        placeholder={placeholder}
        className={cn(inputCls, 'h-8 font-mono text-[12px]')}
      />
      {open && (filtered.length > 0 || draft.trim()) && (
        <div className="absolute z-20 mt-1 max-h-[260px] w-full overflow-auto rounded-md border border-line bg-surface-2 py-1 shadow-lg">
          {draft.trim() && !filtered.some((g) => g.items.includes(draft.trim())) && (
            <button type="button" onMouseDown={(e) => { e.preventDefault(); add(draft); }} className="block w-full px-2.5 py-1 text-left font-mono text-[12px] text-brand-soft hover:bg-brand/10">+ add “{draft.trim()}”</button>
          )}
          {filtered.map((g) => (
            <div key={g.label} className="px-1 pb-0.5">
              {g.label && <div className="px-1.5 pt-1.5 pb-0.5 font-display text-[9.5px] font-semibold uppercase tracking-[0.08em] text-dim-2">{g.label}</div>}
              {g.items.map((it) => (
                <button key={it} type="button" onMouseDown={(e) => { e.preventDefault(); add(it); }} className="block w-full rounded px-1.5 py-0.5 text-left font-mono text-[12px] text-t2 hover:bg-brand/10 hover:text-brand-soft">{it}</button>
              ))}
            </div>
          ))}
          {!filtered.length && !draft.trim() && <div className="px-2.5 py-1 font-mono text-[11px] text-dim">no suggestions — type a value</div>}
        </div>
      )}
    </div>
  );
}
const FILTER_OPS = [
  { v: 'is', label: 'is any of' }, { v: 'is_not', label: 'is none of' },
  { v: 'contains', label: 'contains' }, { v: 'matches', label: 'matches /regex/' },
];
const AndOr = ({ value, onChange, labels }: { value: 'all' | 'any'; onChange: (v: 'all' | 'any') => void; labels?: [string, string] }) => (
  <span className="inline-flex overflow-hidden rounded-md border border-line text-[11px] font-semibold">
    {(['all', 'any'] as const).map((m, i) => <button key={m} type="button" onClick={() => onChange(m)} className={cn('px-2 py-0.5 font-mono', value === m ? 'bg-brand/15 text-brand-soft' : 'text-dim hover:text-t2')}>{labels ? labels[i] : m}</button>)}
  </span>
);

function FilterBuilder({ top, setTop, groups, setGroups, valueGroups }: {
  top: 'all' | 'any'; setTop: (v: 'all' | 'any') => void; groups: FilterGroup[]; setGroups: (g: FilterGroup[]) => void;
  valueGroups: (field: string) => ValueGroup[];
}) {
  const setGroup = (gi: number, g: FilterGroup) => setGroups(groups.map((x, i) => (i === gi ? g : x)));
  const addGroup = () => setGroups([...groups, { match: 'all', conditions: [{ field: 'action', op: 'is', values: [] }] }]);
  const removeGroup = (gi: number) => setGroups(groups.filter((_, i) => i !== gi));
  const setCond = (gi: number, ci: number, c: Cond) => setGroup(gi, { ...groups[gi], conditions: groups[gi].conditions.map((x, i) => (i === ci ? c : x)) });
  const addCond = (gi: number) => setGroup(gi, { ...groups[gi], conditions: [...groups[gi].conditions, { field: 'action', op: 'is', values: [] }] });
  const removeCond = (gi: number, ci: number) => setGroup(gi, { ...groups[gi], conditions: groups[gi].conditions.filter((_, i) => i !== ci) });
  const sel = 'h-7 shrink-0 rounded-md border border-line bg-surface-2 px-1.5 font-mono text-[11px] text-fg focus:border-brand/60 focus:outline-none';
  if (!groups.length) return (
    <button type="button" onClick={addGroup} className="rounded-md border border-dashed border-line px-3 py-1.5 font-mono text-[11.5px] text-dim hover:border-hair hover:text-t2">+ add a filter</button>
  );
  return (
    <div className="flex flex-col gap-2">
      {groups.length > 1 && (
        <div className="flex items-center gap-2 text-[11px] text-dim-2">match <AndOr value={top} onChange={setTop} labels={['all', 'any']} /> of the groups below</div>
      )}
      {groups.map((g, gi) => (
        <div key={gi}>
          {gi > 0 && <div className="my-1 text-center font-mono text-[10px] font-semibold uppercase tracking-wide text-brand-soft">{top === 'all' ? 'and' : 'or'}</div>}
          <div className="rounded-md border border-line-soft bg-surface-2/40 p-2">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="font-mono text-[10px] text-dim-2">match</span><AndOr value={g.match} onChange={(v) => setGroup(gi, { ...g, match: v })} />
              <span className="font-mono text-[10px] text-dim-2">of</span>
              <button type="button" onClick={() => removeGroup(gi)} className="ml-auto text-dim hover:text-bad" aria-label="remove group">✕</button>
            </div>
            <div className="flex flex-col gap-1.5">
              {g.conditions.map((c, ci) => (
                <div key={ci}>
                  {ci > 0 && <div className="mb-1 ml-1 font-mono text-[9px] font-semibold uppercase text-dim-3">{g.match === 'all' ? 'and' : 'or'}</div>}
                  <div className="flex items-start gap-1.5">
                    <select value={c.field} onChange={(e) => setCond(gi, ci, { ...c, field: e.target.value, values: [] })} className={sel}>{FILTER_FIELDS.map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}</select>
                    <select value={c.op} onChange={(e) => setCond(gi, ci, { ...c, op: e.target.value })} className={sel}>{FILTER_OPS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select>
                    <div className="min-w-0 flex-1">
                      <GroupedPicker value={c.values.join(', ')} onChange={(v) => setCond(gi, ci, { ...c, values: v.split(',').map((s) => s.trim()).filter(Boolean) })} groups={c.op === 'contains' || c.op === 'matches' ? [] : valueGroups(c.field)} placeholder={c.op === 'matches' ? 'regex…' : 'value…'} />
                    </div>
                    <button type="button" onClick={() => removeCond(gi, ci)} className="mt-1 shrink-0 text-dim hover:text-bad" aria-label="remove condition">✕</button>
                  </div>
                </div>
              ))}
              <button type="button" onClick={() => addCond(gi)} className="self-start font-mono text-[11px] text-brand-soft hover:underline">+ condition</button>
            </div>
          </div>
        </div>
      ))}
      <button type="button" onClick={addGroup} className="self-start rounded-md border border-dashed border-line px-2.5 py-1 font-mono text-[11px] text-dim hover:border-hair hover:text-t2">+ {top === 'all' ? 'AND' : 'OR'} group</button>
    </div>
  );
}

const TRIGGER_GROUPS: { label: string; items: string[] }[] = [
  { label: 'Control', items: ['schedule', 'manual', 'api', 'webhook'] },
  { label: 'GitHub', items: ['push', 'pull_request', 'pull_request_review', 'issues', 'issue_comment', 'label', 'release'] },
  { label: 'CI / checks', items: ['check_run', 'check_suite', 'workflow_run', 'status', 'deployment_status'] },
];
// Only tools the runner actually grants (runner.js allowedToolsFor). No phantom MCPs.
const CONNECTORS = ['github', 'slack', 'web', 'team'];

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
function ChainPicker({ value, onChange, selfSlug }: { value: string; onChange: (v: string) => void; selfSlug: string }) {
  const { data: routines } = useRoutines();
  const selected = value.split(',').map((s) => s.trim()).filter(Boolean);
  const available = (routines ?? []).filter((r) => !selected.includes(r.slug) && r.slug !== selfSlug);
  const add = (slug: string) => { if (slug && !selected.includes(slug)) onChange([...selected, slug].join(', ')); };
  const remove = (slug: string) => onChange(selected.filter((x) => x !== slug).join(', '));
  return (
    <div>
      {selected.length > 0 && (
        <div className="mb-2 flex flex-col gap-1.5">
          {selected.map((s) => (
            <div key={s} className="flex items-center gap-2 rounded-md border border-line-soft bg-surface-2 px-2.5 py-1.5 font-mono text-[11.5px]">
              <span className="text-faint">↳</span><span className="text-brand">{s}</span>
              <button type="button" onClick={() => remove(s)} className="ml-auto text-dim hover:text-bad" aria-label="remove">✕</button>
            </div>
          ))}
        </div>
      )}
      <select value="" onChange={(e) => { add(e.target.value); }} className={cn(inputCls, 'font-mono text-[12px]')}>
        <option value="">{available.length ? 'add a routine to run after this one…' : 'no other routines to chain'}</option>
        {available.map((r) => <option key={r.slug} value={r.slug}>{r.name} · {r.slug}</option>)}
      </select>
    </div>
  );
}

function ReactionsEditor({ reactions, setReactions, repo, selfSlug }: { reactions: Rx[]; setReactions: (r: Rx[]) => void; repo: string; selfSlug: string }) {
  const [preset, setPreset] = useState(0);
  const [run, setRun] = useState('');
  const [dur, setDur] = useState('4h');
  const [check, setCheck] = useState('');
  const runListId = useId();
  const { data: allRoutines } = useRoutines();
  const routineSlugs = (allRoutines ?? []).map((r) => r.slug).filter((s) => s !== selfSlug);
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
        <input list={runListId} value={run} onChange={(e) => setRun(e.target.value)} placeholder="pick a routine, or type a new slug" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} className={cn(inputCls, 'min-w-[160px] flex-1 font-mono text-[12px]')} />
        <datalist id={runListId}>{routineSlugs.map((s) => <option key={s} value={s} />)}</datalist>
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
  const { data: templates } = useTemplates();
  const [operator] = useOperator();
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
  const [scriptMode, setScriptMode] = useState(false);
  const [scriptLang, setScriptLang] = useState<'bash' | 'node'>('bash');
  const [retries, setRetries] = useState(0);
  const [assertions, setAssertions] = useState<{ type: string; value: string }[]>([]);
  const [alertOnFail, setAlertOnFail] = useState(false);
  const [alertTarget, setAlertTarget] = useState('');
  const [escalation, setEscalation] = useState('');
  const [timeoutS, setTimeoutS] = useState(0);
  const [envPairs, setEnvPairs] = useState<{ k: string; v: string }[]>([]);
  const [tags, setTags] = useState('');
  const [lifecycle, setLifecycle] = useState('active');
  const [gateReview, setGateReview] = useState(false);
  const [tier, setTier] = useState('standard');
  const [rateLimit, setRateLimit] = useState(0);
  const [maxFails, setMaxFails] = useState(0);
  const [sla, setSla] = useState(0);
  const [notes, setNotes] = useState('');
  const [winStart, setWinStart] = useState<string>('');
  const [winEnd, setWinEnd] = useState<string>('');
  const [winDays, setWinDays] = useState<number[]>([]);
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('main');
  const [prompt, setPrompt] = useState('');
  const [chain, setChain] = useState('');
  const [schedule, setSchedule] = useState('0 9 * * *');
  const [filterTop, setFilterTop] = useState<'all' | 'any'>('all');
  const [filterGroups, setFilterGroups] = useState<FilterGroup[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [reactions, setReactions] = useState<{ source: string; kind: string; when: string; run: string; check?: string }[]>([]);
  const [concScope, setConcScope] = useState('auto');
  const [concConflict, setConcConflict] = useState<'wait' | 'drop' | 'coalesce'>('wait');

  const slug = slugTouched ? slugInput : slugify(name);
  // CI / GitHub events that carry an `action` and can be filtered.
  const actionable = triggers.some((t) => ['pull_request', 'pull_request_review', 'issues', 'issue_comment', 'label', 'release', 'check_run', 'check_suite', 'workflow_run', 'deployment_status'].includes(t));
  const labelable = triggers.some((t) => ['label', 'pull_request', 'pull_request_target', 'issues'].includes(t));
  const firstRepoSel = repo.split(',')[0]?.trim() || '';
  const { data: labelsData } = useGithubLabels(firstRepoSel);
  const { data: repoChecksData } = useGithubChecks(firstRepoSel);
  const valueGroups = (field: string): ValueGroup[] => {
    if (field === 'action') return actionGroups(triggers);
    if (field === 'check') return [{ label: repoChecksData?.checks?.length ? `${firstRepoSel} jobs / checks` : 'no checks found yet — type a name', items: repoChecksData?.checks ?? [] }];
    if (field === 'label') return [{ label: labelsData?.labels?.length ? `${firstRepoSel} labels` : 'labels', items: labelsData?.labels ?? [] }];
    if (field === 'draft') return [{ label: '', items: ['true', 'false'] }];
    return [];
  };
  const cleanGroups = filterGroups
    .map((g) => ({ match: g.match, conditions: g.conditions.filter((c) => c.values.length || c.op === 'is_not') }))
    .filter((g) => g.conditions.length);
  const filtersObj = cleanGroups.length ? { match: filterTop, groups: cleanGroups } : {};
  const hasFilters = cleanGroups.length > 0;
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
    setScriptMode(!!d.scriptMode); setScriptLang(d.scriptLang === 'node' ? 'node' : 'bash'); setRetries(d.retries || 0); setAssertions(d.assertions ?? []); setAlertOnFail(!!d.alertOnFail); setAlertTarget(d.alertTarget || ''); setEscalation(d.escalation || ''); setTimeoutS(d.timeout || 0); setEnvPairs(Object.entries(d.env || {}).map(([k, v]) => ({ k, v: String(v) }))); setTags((d.tags || []).join(', ')); setLifecycle(d.lifecycle || 'active'); setGateReview(!!d.gateReview); setTier(d.tier || 'standard'); setRateLimit(d.rateLimit || 0); setMaxFails(d.maxFails || 0); setSla(d.sla || 0); setNotes(d.notes || ''); setWinStart(d.activeWindow?.start != null ? String(d.activeWindow.start) : ''); setWinEnd(d.activeWindow?.end != null ? String(d.activeWindow.end) : ''); setWinDays(d.activeWindow?.days || []);
    setPrompt(d.prompt || '');
    setChain(d.chain.join(', '));
    if (d.schedule) setSchedule(d.schedule);
    const fl = (d.filters ?? {}) as { groups?: FilterGroup[]; match?: 'all' | 'any'; actions?: string[]; branches?: string[]; labels?: string[]; mode?: 'and' | 'or' };
    if (Array.isArray(fl.groups)) {
      setFilterTop(fl.match === 'any' ? 'any' : 'all');
      setFilterGroups(fl.groups);
    } else {
      const conds: Cond[] = [];
      if (fl.actions?.length) conds.push({ field: 'action', op: 'is', values: fl.actions });
      if (fl.branches?.length) conds.push({ field: 'branch', op: 'is', values: fl.branches });
      if (fl.labels?.length) conds.push({ field: 'label', op: 'is', values: fl.labels });
      setFilterTop('all');
      setFilterGroups(conds.length ? [{ match: fl.mode === 'or' ? 'any' : 'all', conditions: conds }] : []);
    }
    setReactions(d.reactions ?? []);
    setConcScope(d.concurrency?.scope || 'auto');
    setConcConflict((['drop', 'coalesce'].includes(d.concurrency?.onConflict ?? '') ? d.concurrency!.onConflict : 'wait') as 'wait' | 'drop' | 'coalesce');
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
    triggers.forEach((t) => L.push(t === 'schedule' ? `  - schedule: { cron: "${schedule}" }` : `  - ${t}: {}`));
    if (cleanGroups.length) {
      const condStr = (c: Cond) => `${c.field} ${c.op.replace('_', ' ')} [${c.values.join(', ')}]`;
      if (cleanGroups.length === 1) { L.push(`filter: ${cleanGroups[0].match} of`); cleanGroups[0].conditions.forEach((c) => L.push(`  - ${condStr(c)}`)); }
      else { L.push(`filter: ${filterTop} of`); cleanGroups.forEach((g) => { L.push(`  - ${g.match} of:`); g.conditions.forEach((c) => L.push(`      - ${condStr(c)}`)); }); }
    }
    if (connectors.length) { L.push('tools:'); L.push(`  grant: [${connectors.join(', ')}]`); }
    L.push('runtime:');
    L.push(`  model: ${model || 'claude-opus-4-8'}`);
    if (effort) L.push(`  effort: ${effort}`);
    L.push(`  repos: [${repo.split(',').map((s) => s.trim()).filter(Boolean).join(', ') || '*'}]`);
    if (memory) L.push('  memory: enabled');
    if (concScope !== 'off') L.push(`  concurrency: { scope: ${concScope}, on_conflict: ${concConflict} }`);
    if (chainArr.length) L.push(`chain: [${chainArr.join(', ')}]`);
    if (reactions.length) {
      L.push('react:');
      reactions.forEach((rx) => L.push(`  - on: ${rx.source}:${rx.kind}${rx.when ? ':' + rx.when : ''}${rx.check ? ` [${rx.check}]` : ''}  →  run: ${rx.run}`));
    }
    L.push('---');
    L.push('');
    L.push(prompt.trim() || '## Prompt\nDescribe what this routine should do, step by step.');
    return L.join('\n');
  }, [name, slug, summary, owner, team, triggers, connectors, model, effort, memory, repo, branch, prompt, chain, schedule, filterTop, filterGroups, reactions, concScope, concConflict]);

  const valid = name.trim().length > 0 && slug.length > 0;
  function applyTemplate(t: RoutineTemplate) {
    const b = t.body;
    if (!name.trim()) setName(t.name);
    if (b.triggers) setTriggers(b.triggers);
    if (b.connectors) setConnectors(b.connectors);
    if (b.model) setModel(b.model);
    if (b.schedule) setSchedule(b.schedule);
    if (b.scriptMode != null) setScriptMode(b.scriptMode);
    if (b.scriptLang === 'bash' || b.scriptLang === 'node') setScriptLang(b.scriptLang);
    if (b.prompt) setPrompt(b.prompt);
  }
  function submit() {
    if (!valid) return;
    const body = { name: name.trim(), slug, summary, owner, team, triggers, connectors, model, effort, memory, repo, branch, prompt, chain: chainArr, schedule: triggers.includes('schedule') ? schedule.trim() : '', filters: filtersObj, reactions, concurrency: { scope: concScope, onConflict: concConflict }, scriptMode, scriptLang, retries, assertions: assertions.filter((a) => a.type === 'no_tool_errors' || a.value.trim()), alertOnFail, alertTarget, escalation, timeout: timeoutS, env: Object.fromEntries(envPairs.filter((p) => p.k.trim()).map((p) => [p.k.trim(), p.v])), tags: tags.split(',').map((t) => t.trim()).filter(Boolean), rateLimit, maxFails, notes, sla, lifecycle, gateReview, tier, editor: operator, activeWindow: (winStart || winEnd || winDays.length) ? { start: winStart === '' ? null : +winStart, end: winEnd === '' ? null : +winEnd, days: winDays } : null };
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
            <div className="mt-1 text-[13px] text-muted-2">A routine is one definition. Fill these in — the <span className="font-mono text-[var(--code-accent)]">.routine.md</span> preview on the right updates live, and is saved on {isEdit ? 'save' : 'create'}.</div>
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
          {!isEdit && templates && templates.templates.length > 0 && (
            <div className={CARD}>
              <div className={`${LABEL.replace('mb-1.5', 'mb-3')}`}>Start from a template</div>
              <div className="grid grid-cols-2 gap-2">
                {templates.templates.map((t) => (
                  <button key={t.id} type="button" onClick={() => applyTemplate(t)} className="flex items-start gap-2.5 rounded-md border border-line bg-surface-2 px-3 py-2.5 text-left hover:border-brand/50">
                    <span className="text-[16px] leading-none">{t.icon}</span>
                    <span className="min-w-0"><span className="block font-display text-[12.5px] font-semibold text-t2">{t.name}</span><span className="block truncate font-mono text-[10.5px] text-dim-2">{t.desc}</span></span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* 1 — what it is + does (the essentials) */}
          <div className={CARD}>
            <div className={`${LABEL.replace('mb-1.5', 'mb-4')}`}>1 · Identity</div>
            <div className="flex flex-col gap-3.5">
              <div><div className={LABEL}>Name</div><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="PR Attention Digest" className={inputCls} /></div>
              <div>
                <div className={LABEL}>Slug · file name</div>
                <div className="flex items-center gap-2">
                  <input value={slug} readOnly={isEdit} onChange={(e) => { setSlugTouched(true); setSlugInput(slugify(e.target.value)); }} placeholder="pr-attention-digest" className={cn(inputCls, 'font-mono', isEdit && 'opacity-60')} />
                  <span className="shrink-0 font-mono text-[12px] text-dim">.routine.md</span>
                </div>
              </div>
              <div><div className={LABEL}>Summary · one line</div><input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="On a PR, post the title to #dev-ai-slop" className={inputCls} /></div>
              <div><div className={LABEL}>Tags · <span className="font-mono lowercase tracking-normal text-dim-2">comma-separated, for grouping</span></div><input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="ci, security, experimental" className={cn(inputCls, 'font-mono text-[12px]')} /></div>
              <div><div className={LABEL}>Lifecycle</div><select value={lifecycle} onChange={(e) => setLifecycle(e.target.value)} className={cn(inputCls, 'font-mono text-[12px]')}><option value="draft">draft — work in progress</option><option value="active">active — production</option><option value="deprecated">deprecated — being retired</option></select></div>
              <div><div className={LABEL}>Criticality tier</div><select value={tier} onChange={(e) => setTier(e.target.value)} className={cn(inputCls, 'font-mono text-[12px]')}><option value="critical">critical — page immediately</option><option value="standard">standard</option><option value="experimental">experimental</option></select></div>
              <div><div className={LABEL}>Notes · <span className="font-mono lowercase tracking-normal text-dim-2">ops context / runbook (optional)</span></div><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Why this exists, known quirks, who to ping…" className={cn(inputCls, 'font-sans text-[13px] leading-relaxed')} /></div>
            </div>
          </div>

          <div className={CARD}>
            <div className={`${LABEL.replace('mb-1.5', 'mb-3')}`}>2 · What it does <span className="font-mono lowercase tracking-normal text-dim-2">— the instruction, in plain language</span></div>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={'When a pull request opens, review the diff and post the top risks to Slack #dev-ai-slop.'} rows={6} className={cn(inputCls, 'h-auto resize-y py-2.5 leading-[1.6]')} />
            <div className="mt-2.5 text-[11.5px] text-dim-2">Say what to do — the session figures out how, using the tools you grant. No output format needed.</div>
          </div>

          {/* 3 — WHEN it runs: triggers (ANY) + repo scope + filters (ALL/ANY) */}
          <div className={CARD}>
            <div className={`${LABEL.replace('mb-1.5', 'mb-1.5')}`}>3 · When it runs</div>
            <div className="mb-3 text-[11.5px] text-dim-2">Fires when <span className="font-semibold text-brand-soft">any</span> of the selected triggers happen. {hasFilters && <>It then runs only when the event matches the filters below.</>}</div>
            <div className="flex flex-col gap-3">
              {TRIGGER_GROUPS.map((g) => (
                <div key={g.label}>
                  <div className="mb-1.5 flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-dim-2">
                    {g.label}
                    {(g.label === 'GitHub' || g.label === 'CI / checks') && <span className="normal-case tracking-normal text-dim-3">→ {repo ? repo.split(',').map((s) => s.trim()).filter(Boolean).join(', ') : 'any repo'}</span>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {g.items.map((t) => <ChipToggle key={t} on={triggers.includes(t)} onClick={() => toggle(setTriggers, t)}>{t}</ChipToggle>)}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[11px] text-dim-2">{triggers.length ? `${triggers.length} selected — any one fires a run.` : 'None selected → run-now / API only.'}</div>

            {triggers.includes('schedule') && (
              <div className="mt-3.5 border-t border-line-soft pt-3">
                <div className={LABEL}>Schedule · <span className="font-mono lowercase tracking-normal text-dim-2">cron — min hour dom mon dow</span></div>
                <input value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="0 9 * * *" className={cn(inputCls, 'font-mono text-[12px]')} />
                <div className="mt-1.5 text-[11px] text-dim-2">Server local time. <span className="font-mono">0 9 * * 1-5</span> = weekdays 9am · <span className="font-mono">*/15 * * * *</span> = every 15 min.</div>
              </div>
            )}

            {(triggers.includes('push') || actionable) && (
              <div className="mt-3.5 border-t border-line-soft pt-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className={LABEL.replace('mb-1.5', '')}>Refine · run only when the event matches</span>
                  {!filterGroups.length && <span className="font-mono text-[10.5px] text-dim-3">optional — blank = every event</span>}
                </div>
                <FilterBuilder top={filterTop} setTop={setFilterTop} groups={filterGroups} setGroups={setFilterGroups} valueGroups={valueGroups} />
                <div className="mt-1.5 text-[11px] text-dim-2">Build conditions on the event — <span className="font-mono">action</span>, <span className="font-mono">label</span>, <span className="font-mono">branch</span>, <span className="font-mono">author</span>, <span className="font-mono">title</span>… Group them with <span className="font-semibold text-t2">all (AND)</span> / <span className="font-semibold text-t2">any (OR)</span> for logic like <span className="font-mono">(opened AND jira-ticket) OR (push to main)</span>.</div>
              </div>
            )}
            <div className="mt-3 border-t border-line-soft pt-3"><div className={LABEL}>Repositories · <span className="font-mono lowercase tracking-normal text-dim-2">scope GitHub/CI triggers</span></div>
              <RepoPicker value={repo} onChange={setRepo} />
              <div className="mt-1.5 text-[11px] text-dim-2">Empty = any repo. Pick from your repos/orgs, or search all of GitHub.</div>
            </div>
          </div>

          {/* 4 — tools */}
          <div className={CARD}>
            <div className={`${LABEL.replace('mb-1.5', 'mb-3')}`}>4 · Tools the session can use</div>
            <div className="flex flex-wrap gap-1.5">
              {TOOLS.map((c) => <ChipToggle key={c} on={connectors.includes(c)} onClick={() => toggle(setConnectors, c)}>{c}</ChipToggle>)}
            </div>
            <div className="mt-2.5 text-[11.5px] text-dim-2">Deny-by-default — <span className="font-mono">github</span> → gh, <span className="font-mono">slack</span> → bot, <span className="font-mono">web</span> → fetch, <span className="font-mono">team</span> → delegate to agents. Custom <span className="font-mono">MCP</span> servers appear here too.</div>
          </div>

          {/* 5 — advanced (collapsed) */}
          <div className={CARD}>
            <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="flex w-full items-center justify-between">
              <span className={LABEL.replace('mb-1.5', '')}>5 · Advanced <span className="font-mono lowercase tracking-normal text-dim-2">— runtime, ownership, chain & reactions</span></span>
              <span className="font-mono text-[12px] text-dim">{showAdvanced ? '▾' : '▸'}</span>
            </button>
            {showAdvanced && (
              <div className="mt-4 flex flex-col gap-[18px]">
                <div className="grid grid-cols-2 gap-3">
                  <div><div className={LABEL}>Model</div><select value={model} onChange={(e) => setModel(e.target.value)} className={cn(inputCls, 'font-mono text-[12px]')}>{MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></div>
                  <div><div className={LABEL}>Effort</div><select value={effort} onChange={(e) => setEffort(e.target.value)} className={cn(inputCls, 'font-mono text-[12px]')}><option value="">default</option>{EFFORTS.map((e) => <option key={e} value={e}>{e}</option>)}</select></div>
                  <div><div className={LABEL}>Owner</div><input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="ada" className={inputCls} /></div>
                  <div><div className={LABEL}>Team</div><input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="platform" className={inputCls} /></div>
                  <div className="col-span-2">
                    <div className={LABEL}>Auto-retry on failure</div>
                    <select value={retries} onChange={(e) => setRetries(+e.target.value)} className={cn(inputCls, 'font-mono text-[12px]')}>
                      <option value={0}>off — a failed run stays failed</option>
                      <option value={1}>1 retry · +5s</option>
                      <option value={2}>2 retries · +5s, 20s</option>
                      <option value={3}>3 retries · +5s, 20s, 60s</option>
                    </select>
                    <div className="mt-1 text-[11px] text-dim-2">A failed run (claude/gh/timeout) re-fires automatically with backoff — no human needed to notice and re-run.</div>
                  </div>
                  <div><div className={LABEL}>Max duration (s)</div><input type="number" min={0} max={1800} value={timeoutS || ''} onChange={(e) => setTimeoutS(+e.target.value)} placeholder="240 (default)" className={cn(inputCls, 'font-mono text-[12px]')} /></div>
                  <div><div className={LABEL}>Rate limit · <span className="font-mono lowercase tracking-normal text-dim-2">runs/hour, 0=off</span></div><input type="number" min={0} max={1000} value={rateLimit || ''} onChange={(e) => setRateLimit(+e.target.value)} placeholder="0 (unlimited)" className={cn(inputCls, 'font-mono text-[12px]')} /></div>
                  <div><div className={LABEL}>Auto-disable after · <span className="font-mono lowercase tracking-normal text-dim-2">consecutive fails, 0=off</span></div><input type="number" min={0} max={50} value={maxFails || ''} onChange={(e) => setMaxFails(+e.target.value)} placeholder="0 (never)" className={cn(inputCls, 'font-mono text-[12px]')} /></div>
                  <div><div className={LABEL}>SLA · <span className="font-mono lowercase tracking-normal text-dim-2">expected max sec, 0=off</span></div><input type="number" min={0} max={3600} value={sla || ''} onChange={(e) => setSla(+e.target.value)} placeholder="0 (no SLA)" className={cn(inputCls, 'font-mono text-[12px]')} /></div>
                  <div className="col-span-2">
                    <div className={LABEL}>Active window · <span className="font-mono lowercase tracking-normal text-dim-2">events outside skip (blank = always)</span></div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <input type="number" min={0} max={23} value={winStart} onChange={(e) => setWinStart(e.target.value)} placeholder="from h" className={cn(inputCls, 'h-8 w-20 font-mono text-[12px]')} />
                      <span className="font-mono text-[12px] text-dim">→</span>
                      <input type="number" min={0} max={24} value={winEnd} onChange={(e) => setWinEnd(e.target.value)} placeholder="to h" className={cn(inputCls, 'h-8 w-20 font-mono text-[12px]')} />
                      <span className="mx-1 h-5 w-px bg-line" />
                      {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((lbl, di) => (
                        <button key={di} type="button" onClick={() => setWinDays(winDays.includes(di) ? winDays.filter((x) => x !== di) : [...winDays, di])} className={cn('h-8 w-8 rounded-md border font-mono text-[11px]', winDays.includes(di) ? 'border-brand/50 bg-brand/15 text-brand-soft' : 'border-line text-dim hover:text-t2')}>{lbl}</button>
                      ))}
                    </div>
                    <div className="mt-1 text-[11px] text-dim-2">e.g. 9 → 18 with Mo–Fr = business hours only. No days selected = every day.</div>
                  </div>
                  <div className="col-span-2">
                    <div className={LABEL}>Environment variables <span className="font-mono lowercase tracking-normal text-dim-2">— available to the session shell & scripts</span></div>
                    {envPairs.map((p, i) => (
                      <div key={i} className="mt-1.5 flex items-center gap-1.5">
                        <input value={p.k} onChange={(e) => setEnvPairs(envPairs.map((x, j) => j === i ? { ...x, k: e.target.value } : x))} placeholder="NAME" className={cn(inputCls, 'h-8 w-40 font-mono text-[12px]')} />
                        <input value={p.v} onChange={(e) => setEnvPairs(envPairs.map((x, j) => j === i ? { ...x, v: e.target.value } : x))} placeholder="value" className={cn(inputCls, 'h-8 flex-1 font-mono text-[12px]')} />
                        <button type="button" onClick={() => setEnvPairs(envPairs.filter((_, j) => j !== i))} className="shrink-0 text-dim hover:text-bad" aria-label="remove">✕</button>
                      </div>
                    ))}
                    <button type="button" onClick={() => setEnvPairs([...envPairs, { k: '', v: '' }])} className="mt-1.5 font-mono text-[11px] text-brand-soft hover:underline">+ variable</button>
                  </div>
                  <div className="col-span-2">
                    <label className="flex cursor-pointer items-center gap-2 text-[12px] text-t2"><input type="checkbox" checked={alertOnFail} onChange={(e) => setAlertOnFail(e.target.checked)} className="h-4 w-4 accent-[#e5736b]" />Alert on failure</label>
                    {alertOnFail && <input value={alertTarget} onChange={(e) => setAlertTarget(e.target.value)} placeholder="@fabio or #alerts · blank = the owner" className={cn(inputCls, 'mt-1.5 font-mono text-[12px]')} />}
                    <div className="mt-1 text-[11px] text-dim-2">When a run finally fails (after retries), Slack-DMs the target so nobody has to watch the dashboard.</div>
                  </div>
                  <div className="col-span-2"><div className={LABEL}>Escalation contact · <span className="font-mono lowercase tracking-normal text-dim-2">CC'd on failure alerts when the owner is out</span></div><input value={escalation} onChange={(e) => setEscalation(e.target.value)} placeholder="@oncall or #incidents" className={cn(inputCls, 'font-mono text-[12px]')} /></div>
                  <div className="col-span-2">
                    <label className="flex cursor-pointer items-center gap-2 text-[12px] text-t2"><input type="checkbox" checked={gateReview} onChange={(e) => setGateReview(e.target.checked)} className="h-4 w-4 accent-[#e6b052]" />Require approval to run</label>
                    <div className="mt-1 text-[11px] text-dim-2">When a config change is unreviewed, event/schedule dispatch is blocked until a teammate approves (manual runs still allowed).</div>
                  </div>
                </div>
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input type="checkbox" checked={memory} onChange={(e) => setMemory(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#5b9ee6]" />
                  <div><div className="font-display text-[12.5px] font-semibold text-t2">Persistent memory</div><div className="text-[11px] text-dim-2">A <span className="font-mono text-[var(--code-accent)]">memory.md</span> the session reads at start and updates as it learns.</div></div>
                </label>
                <div className="border-t border-line-soft pt-3.5">
                  <label className="flex cursor-pointer items-start gap-2.5">
                    <input type="checkbox" checked={scriptMode} onChange={(e) => setScriptMode(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#5fbf86]" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-display text-[12.5px] font-semibold text-t2">Deterministic script</span>
                        {scriptMode && (
                          <select value={scriptLang} onChange={(e) => setScriptLang(e.target.value as 'bash' | 'node')} onClick={(e) => e.preventDefault()} className="h-6 rounded border border-line bg-surface-2 px-1.5 font-mono text-[11px] text-fg">
                            <option value="bash">bash</option><option value="node">node</option>
                          </select>
                        )}
                      </div>
                      <div className="text-[11px] text-dim-2">The <span className="text-t2">first run</span> is an agent that explores the repo and <span className="text-t2">writes a reusable {scriptLang} extractor</span> from your prompt. Every run after just executes that script — deterministic, fast, $0. Edit the prompt to recompile.</div>
                    </div>
                  </label>
                </div>
                <div className="border-t border-line-soft pt-3.5">
                  <div className={LABEL}>Assertions · <span className="font-mono lowercase tracking-normal text-dim-2">checked over the result — fail = gate chain & reactions</span></div>
                  {assertions.length > 0 && (
                    <div className="mb-2 mt-1 flex flex-col gap-1.5">
                      {assertions.map((a, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <select value={a.type} onChange={(e) => setAssertions(assertions.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))} className="h-8 shrink-0 rounded-md border border-line bg-surface-2 px-1.5 font-mono text-[11px] text-fg">
                            {[['contains', 'output contains'], ['not_contains', "output doesn't contain"], ['matches', 'output matches /regex/'], ['max_cost', 'cost ≤ ($)'], ['max_turns', 'turns ≤'], ['min_length', 'output length ≥'], ['no_tool_errors', 'no tool errors']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                          {a.type !== 'no_tool_errors' && <input value={a.value} onChange={(e) => setAssertions(assertions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder={a.type === 'max_cost' ? '0.50' : a.type === 'max_turns' || a.type === 'min_length' ? '10' : 'value…'} className={cn(inputCls, 'h-8 flex-1 font-mono text-[12px]')} />}
                          <button type="button" onClick={() => setAssertions(assertions.filter((_, j) => j !== i))} className="shrink-0 text-dim hover:text-bad" aria-label="remove">✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <button type="button" onClick={() => setAssertions([...assertions, { type: 'contains', value: '' }])} className="font-mono text-[11px] text-brand-soft hover:underline">+ assertion</button>
                  <div className="mt-1.5 text-[11px] text-dim-2">Checked harness-side over the run's output, cost, turns and trace — the agent can't fake a pass. A failed assertion blocks chains and reactions, catching silent regressions.</div>
                </div>
                <div className="border-t border-line-soft pt-3.5">
                  <div className={LABEL}>Concurrency · <span className="font-mono lowercase tracking-normal text-dim-2">no two routines touch the same thing at once</span></div>
                  <div className="mt-1 flex gap-3">
                    <select value={concScope} onChange={(e) => setConcScope(e.target.value)} className={cn(inputCls, 'font-mono text-[12px]')}>
                      <option value="auto">auto (per-PR, else per-routine)</option>
                      <option value="pr">per PR</option>
                      <option value="repo">per repo</option>
                      <option value="routine">per routine</option>
                      <option value="off">off (no lease)</option>
                    </select>
                    <select value={concConflict} onChange={(e) => setConcConflict(e.target.value as 'wait' | 'drop' | 'coalesce')} disabled={concScope === 'off'} className={cn(inputCls, 'font-mono text-[12px] disabled:opacity-40')}>
                      <option value="wait">wait (serialize)</option>
                      <option value="drop">drop (stand down)</option>
                      <option value="coalesce">coalesce (hand off to the running agent)</option>
                    </select>
                  </div>
                  <div className="mt-1.5 text-[11px] text-dim-2">A run acquires a lease on its scope (e.g. <span className="font-mono text-[var(--code-accent)]">pr:acme/x#42</span>). If held: <span className="font-mono">wait</span> serializes; <span className="font-mono">drop</span> stands down; <span className="font-mono">coalesce</span> hands the new event to the <span className="text-t2">already-running agent</span> as a task (only one agent per PR — it drains its <span className="font-mono">inbox</span> before finishing). Leases expire after 15m; per-PR scope also runs a SHA barrier.</div>
                </div>
                <div className="border-t border-line-soft pt-3.5">
                  <div className={LABEL}>Chain · <span className="font-mono lowercase tracking-normal text-dim-2">run routines immediately after</span></div>
                  <ChainPicker value={chain} onChange={setChain} selfSlug={slug} />
                </div>
                <div className="border-t border-line-soft pt-3.5">
                  <div className={LABEL}>React · <span className="font-mono lowercase tracking-normal text-dim-2">follow the PR this run creates, later</span></div>
                  <ReactionsEditor reactions={reactions} setReactions={setReactions} repo={repo} selfSlug={slug} />
                  <div className="mt-2 text-[11px] text-dim-2">Watches the PR (polls gh) and fires a routine when CI checks finish, it merges, etc. A <span className="font-mono">timeout</span> fires after a delay.</div>
                </div>
              </div>
            )}
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
                  <div key={i} style={line.startsWith('##') ? { color: 'var(--dim-2)' } : line === '---' ? { color: 'var(--faint)' } : undefined}>{line || ' '}</div>
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
