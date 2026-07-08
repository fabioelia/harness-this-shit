// Trigger matching: does this envelope satisfy this routine's `on:` entry?
// Filters per docs/04 §1-2: actions/on, branches, base, paths(+ignore), name,
// status, conclusion, draft, label globs — then the `if:` guard on top.
import { arr, anyGlob } from './util.js';
import { branchOf } from './events.js';
import { evalIf } from './expr.js';
import { buildContext } from './template.js';

const labelsOf = (p) => [...new Set([
  p?.label?.name,
  ...((p?.pull_request?.labels || p?.issue?.labels || p?.labels || []).map((l) => (typeof l === 'string' ? l : l?.name))),
].filter(Boolean))];

const pathsOf = (p) => [...new Set([
  ...(p?.commits ?? []).flatMap((c) => [...(c.added ?? []), ...(c.modified ?? []), ...(c.removed ?? [])]),
  ...(p?.head_commit ? [...(p.head_commit.added ?? []), ...(p.head_commit.modified ?? []), ...(p.head_commit.removed ?? [])] : []),
  ...(arr(p?.files).map((f) => f?.filename ?? f)),
])].filter(Boolean);

const checkNameOf = (p) => p?.check_run?.name ?? p?.check_suite?.app?.slug ?? p?.workflow_run?.name ?? p?.workflow_job?.name ?? p?.context ?? null;
const conclusionOf = (p) => p?.check_run?.conclusion ?? p?.check_suite?.conclusion ?? p?.workflow_run?.conclusion ?? p?.deployment_status?.state ?? p?.state ?? null;
const statusOf = (p) => p?.check_run?.status ?? p?.check_suite?.status ?? p?.workflow_run?.status ?? null;

// Condition-group DSL (the Fleet UI's filter builder): named event fields, four
// operators, groups combined AND/OR at two levels. Complements `if:` for
// machine-written filters that must round-trip losslessly through front matter.
const eventStates = (p) => [
  p?.action, p?.conclusion, p?.state,
  p?.check_run?.conclusion, p?.check_suite?.conclusion, p?.workflow_run?.conclusion,
  p?.deployment_status?.state, p?.review?.state,
].filter(Boolean);
export const FILTER_FIELDS = {
  action: (p) => eventStates(p),
  check: (p) => [p?.check_run?.name, p?.check_suite?.app?.slug, p?.workflow_run?.name, p?.workflow_job?.name, p?.context, p?.deployment?.task].filter(Boolean),
  branch: (p) => [branchOf(p)].filter(Boolean),
  base: (p) => [p?.pull_request?.base?.ref].filter(Boolean),
  label: (p) => labelsOf(p),
  author: (p) => [p?.pull_request?.user?.login || p?.issue?.user?.login || p?.sender?.login].filter(Boolean),
  title: (p) => [p?.pull_request?.title || p?.issue?.title].filter(Boolean),
  draft: (p) => (p?.pull_request ? [String(!!p.pull_request.draft)] : []),
};
export function evalCondition(c, p) {
  const vals = (FILTER_FIELDS[c.field]?.(p) || []).map(String);
  const want = (Array.isArray(c.values) ? c.values : []).map(String);
  if (!want.length && c.op !== 'is_not') return true; // empty = no constraint
  const lc = (s) => s.toLowerCase();
  switch (c.op) {
    case 'is_not': return !vals.some((v) => want.includes(v));
    case 'contains': return vals.some((v) => want.some((w) => lc(v).includes(lc(w))));
    case 'matches': return vals.some((v) => want.some((w) => { try { return new RegExp(w).test(v); } catch { return false; } }));
    default: return vals.some((v) => want.includes(v)); // 'is'
  }
}
export function filterGroupsMatch(f, p) {
  if (!f || !Array.isArray(f.groups) || !f.groups.length) return true;
  const groupOk = (g) => {
    const conds = Array.isArray(g?.conditions) ? g.conditions : [];
    if (!conds.length) return true;
    const res = conds.map((c) => evalCondition(c, p));
    return g.match === 'any' ? res.some(Boolean) : res.every(Boolean);
  };
  const gr = f.groups.map(groupOk);
  return f.match === 'any' ? gr.some(Boolean) : gr.every(Boolean);
}

// Match one github-trigger config against a github envelope's payload.
export function githubFiltersMatch(cfg, envelope) {
  const p = envelope.payload ?? {};
  if (cfg.event && cfg.event !== envelope.type) return false;

  const actions = arr(cfg.actions ?? cfg.on).map(String); // `on:` is the docs' alias for label/comment actions
  if (actions.length) {
    const act = p.action ?? '';
    const aliases = { added: 'labeled', removed: 'unlabeled' };            // label trigger vocabulary
    if (!actions.some((a) => a === act || aliases[a] === act)) return false;
  }
  if (cfg.name != null) {                                                  // label name or check/workflow name glob
    const cands = envelope.type === 'label' ? labelsOf(p) : [checkNameOf(p)].filter(Boolean);
    if (!cands.some((c) => anyGlob(cfg.name, c))) return false;
  }
  if (cfg.label != null && !labelsOf(p).some((l) => anyGlob(cfg.label, l))) return false;
  if (cfg.branches != null) {
    const br = branchOf(p);
    if (br && !anyGlob(cfg.branches, br)) return false;
  }
  if (cfg.branches_ignore != null) {
    const br = branchOf(p);
    if (br && anyGlob(cfg.branches_ignore, br)) return false;
  }
  if (cfg.base != null) {
    const base = p?.pull_request?.base?.ref;
    if (base && !anyGlob(cfg.base, base)) return false;
  }
  if (cfg.paths != null) {
    const files = pathsOf(p);
    if (files.length && !files.some((f) => anyGlob(cfg.paths, f))) return false;
  }
  if (cfg.paths_ignore != null) {
    const files = pathsOf(p);
    if (files.length && files.every((f) => anyGlob(cfg.paths_ignore, f))) return false;
  }
  if (cfg.status != null && statusOf(p) && String(cfg.status) !== String(statusOf(p))) return false;
  if (cfg.conclusion != null) {
    const c = conclusionOf(p);
    if (c && !arr(cfg.conclusion).map(String).includes(String(c))) return false;
  }
  if (cfg.draft != null) {
    const d = p?.pull_request?.draft;
    if (d != null && !!cfg.draft !== !!d) return false;
  }
  if (cfg.state != null) {
    const s = p?.review?.state ?? p?.pull_request?.state ?? p?.state;
    if (s && !arr(cfg.state).map(String).includes(String(s))) return false;
  }
  if (cfg.filters != null && !filterGroupsMatch(cfg.filters, p)) return false;
  return true;
}

// Connector event triggers (slack:, sentry:, jira:, …): match `event:` against the
// envelope type, then every other scalar/array key against the payload field.
export function connectorFiltersMatch(cfg, envelope) {
  if (cfg.event && String(cfg.event) !== String(envelope.type)) return false;
  for (const [k, v] of Object.entries(cfg)) {
    if (k === 'event') continue;
    const actual = envelope.payload?.[k];
    if (actual == null) continue;                     // absent field = no constraint violated
    if (!arr(v).some((w) => anyGlob(w, actual))) return false;
  }
  return true;
}

// Does routine trigger `t` fire for `envelope`? Repo targeting from runtime.repo
// applies to github events; the if: guard applies to everything.
export function triggerMatches(routine, t, envelope) {
  let hit = false;
  if (t.type === 'github' && envelope.source === 'github') {
    if (routine.runtime.repo.length && envelope.repo && !routine.runtime.repo.includes(envelope.repo)) return false;
    hit = githubFiltersMatch(t.config, envelope);
  } else if (t.type === 'webhook' && envelope.source === 'webhook') {
    hit = String(t.config.id) === String(envelope.webhook_id);
  } else if (t.type === 'manual' && envelope.source === 'manual') hit = true;
  else if (t.type === 'api' && envelope.source === 'api') hit = true;
  else if (t.type === 'after' && envelope.source === 'after') {
    hit = envelope.upstream?.routine === t.config.routine
      && (t.config.on.includes('always') || t.config.on.includes(envelope.upstream?.outcome));
  } else if (!['schedule', 'github', 'webhook', 'manual', 'api', 'after'].includes(t.type) && envelope.source === t.type) {
    hit = connectorFiltersMatch(t.config, envelope);
  }
  if (!hit) return false;
  if (t.guards.if) {
    const ctx = buildContext({ event: envelope, runtime: routine.runtime });
    if (!evalIf(t.guards.if, ctx)) return false;
  }
  return true;
}

// All (routine, trigger) pairs an envelope fires, with per-pair guard metadata.
export function matchFleet(routines, envelope) {
  const out = [];
  for (const r of routines) {
    if (!r.enabled) continue;
    for (const t of r.on) {
      if (t.type === 'schedule') continue;            // scheduler dispatches these directly
      if (triggerMatches(r, t, envelope)) { out.push({ routine: r, trigger: t }); break; }
    }
  }
  return out;
}
