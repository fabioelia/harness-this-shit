// The docs/02 front-matter contract, pinned as code. normalizeRoutine() takes raw
// parsed YAML and returns { routine, errors, warnings }: errors make the file
// unloadable; warnings are lint (loaded, but flagged in .harness).
import { arr, durationMs, slugify } from './util.js';

export const TRIGGER_TYPES = ['schedule', 'github', 'webhook', 'manual', 'api', 'after'];
// connector-emitted trigger types (docs/04 §1.3) are open-ended: any other key is
// treated as a connector event trigger and checked against the registry at load.

export const CAPABILITIES = {
  'slack-read':    { tools: ['Bash(slack-read:*)'] },
  'slack-post':    { tools: ['Bash(slack-post:*)'] },
  'open-pr':       { tools: ['Bash(gh pr create:*)', 'Bash(git push:*)'] },
  'pr-comment':    { tools: ['Bash(gh pr comment:*)', 'Bash(gh api:*)'] },
  'push-commits':  { tools: ['Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git push:*)'] },
  'create-branch': { tools: ['Bash(git branch:*)', 'Bash(git switch:*)', 'Bash(git checkout:*)'] },
  'merge-pr':      { tools: ['Bash(gh pr merge:*)'], defaultDeny: true },
  'jira-write':    { tools: ['mcp__atlassian__*', 'mcp__jira__*'] },
  'web-fetch':     { tools: ['WebFetch', 'WebSearch'] },
  'label-write':   { tools: ['Bash(gh pr edit:*)', 'Bash(gh issue edit:*)', 'Bash(gh label:*)'] },
};

export const GITHUB_EVENTS = new Set([
  'pull_request', 'pull_request_target', 'push', 'label', 'issue_comment', 'issues',
  'pull_request_review', 'pull_request_review_comment', 'check_run', 'check_suite',
  'release', 'workflow_run', 'workflow_job', 'deployment_status', 'status', 'create', 'delete',
]);

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const SURFACE_TYPES = ['pr-comment', 'slack-message', 'check-run', 'none'];
const INPUT_TYPES = ['string', 'int', 'number', 'bool', 'choice'];
const ON_CONFLICT = ['skip', 'queue', 'steal-if-expired', 'coalesce'];
const MISSED = ['skip', 'run_once_on_recovery'];

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (v == null ? '' : String(v));

export function normalizeRoutine(meta, { file = '', connectorIds = new Set() } = {}) {
  const errors = [], warnings = [];
  const err = (p, m) => errors.push(`${p}: ${m}`);
  const warn = (p, m) => warnings.push(`${p}: ${m}`);
  if (!isObj(meta)) return { routine: null, errors: ['front matter: missing or not a mapping'], warnings };

  const r = {};
  // ── 2.1 identity ──
  r.name = str(meta.name).trim();
  if (!r.name) err('name', 'required');
  r.slug = slugify(str(meta.slug).trim() || file.replace(/\.routine\.md$|\.md$/i, '').split('/').pop() || r.name);
  if (!r.slug) err('slug', 'could not derive a slug');
  r.summary = str(meta.summary).trim();
  if (!r.summary) warn('summary', 'required by spec — add a one-liner');
  r.owner = str(meta.owner).trim();
  if (!r.owner) warn('owner', 'required by spec — add an accountable principal');
  r.maintainers = arr(meta.maintainers).map(str);
  r.team = str(meta.team).trim();
  r.tags = arr(meta.tags).map(str);
  r.labels = isObj(meta.labels) ? meta.labels : {};
  r.enabled = meta.enabled !== false;
  r.visibility = str(meta.visibility || 'team');
  if (!['team', 'org', 'private'].includes(r.visibility)) warn('visibility', `"${r.visibility}" not team|org|private`);

  // ── 2.2 triggers ──
  r.on = [];
  const onList = arr(meta.on);
  if (!onList.length) warn('on', 'no triggers — routine only runnable manually');
  onList.forEach((entry, i) => {
    const p = `on[${i}]`;
    if (typeof entry === 'string') { r.on.push({ type: entry, config: {}, guards: {} }); return; }
    if (!isObj(entry)) return err(p, 'each trigger is a { <type>: <filters> } mapping');
    const keys = Object.keys(entry);
    if (keys.length !== 1) return err(p, `one trigger type per entry, got [${keys.join(', ')}]`);
    const type = keys[0];
    const cfg = isObj(entry[type]) ? { ...entry[type] } : {};
    const guards = {};
    for (const g of ['if', 'gate', 'debounce', 'dedupe_key', 'dedupe_window']) {
      if (cfg[g] != null) { guards[g] = cfg[g]; delete cfg[g]; }
    }
    if (guards.debounce != null && durationMs(guards.debounce) == null) err(`${p}.debounce`, `bad duration "${guards.debounce}"`);

    if (type === 'schedule') {
      const forms = ['cron', 'at', 'every'].filter((k) => cfg[k] != null);
      if (forms.length !== 1) err(`${p}.schedule`, 'exactly one of cron | at | every');
      if (cfg.cron != null && String(cfg.cron).trim().split(/\s+/).length !== 5) err(`${p}.schedule.cron`, `"${cfg.cron}" is not 5-field cron`);
      if (cfg.every != null && durationMs(cfg.every) == null) err(`${p}.schedule.every`, `bad duration "${cfg.every}"`);
      if (cfg.jitter != null && durationMs(cfg.jitter) == null) err(`${p}.schedule.jitter`, `bad duration "${cfg.jitter}"`);
      if (cfg.at != null && Number.isNaN(Date.parse(cfg.at))) err(`${p}.schedule.at`, `"${cfg.at}" is not a timestamp`);
      if (cfg.missed != null && !MISSED.includes(cfg.missed)) warn(`${p}.schedule.missed`, `"${cfg.missed}" not ${MISSED.join('|')} (backfill unsupported)`);
    } else if (type === 'github') {
      if (!cfg.event) err(`${p}.github`, 'event: required');
      else if (!GITHUB_EVENTS.has(cfg.event)) warn(`${p}.github.event`, `"${cfg.event}" not a known webhook event`);
      if (cfg.filters != null) {
        if (!isObj(cfg.filters) || (cfg.filters.groups != null && !Array.isArray(cfg.filters.groups))) err(`${p}.github.filters`, 'must be { match, groups: [{ match, conditions }] }');
        else for (const g of cfg.filters.groups ?? []) for (const c of (g?.conditions ?? [])) {
          if (!c?.field) err(`${p}.github.filters`, 'every condition needs a field');
        }
      }
    } else if (type === 'webhook') {
      if (!cfg.id) err(`${p}.webhook`, 'id: required');
    } else if (type === 'after') {
      if (!cfg.routine) err(`${p}.after`, 'routine: required');
      const on = arr(cfg.on ?? 'success').map(str);
      const bad = on.filter((s) => !['success', 'failure', 'always'].includes(s));
      if (bad.length) err(`${p}.after.on`, `${bad.join(',')} not success|failure|always`);
      cfg.on = on;
    } else if (!['manual', 'api'].includes(type)) {
      // connector event trigger (slack:, jira:, sentry:, …) — resolvable only if registered
      if (connectorIds.size && !connectorIds.has(type)) {
        warn(p, `"${type}" is not a registered connector — this trigger can never fire until it is`);
      }
    }
    r.on.push({ type, config: cfg, guards });
  });

  // ── 2.3 inputs ──
  r.inputs = {};
  if (meta.inputs != null) {
    if (!isObj(meta.inputs)) err('inputs', 'must be a mapping of name → spec');
    else for (const [name, spec] of Object.entries(meta.inputs)) {
      const s = isObj(spec) ? spec : {};
      const type = str(s.type || 'string');
      if (!INPUT_TYPES.includes(type)) warn(`inputs.${name}.type`, `"${type}" not ${INPUT_TYPES.join('|')}`);
      r.inputs[name] = { type, required: !!s.required, default: s.default, description: str(s.description), choices: arr(s.choices).map(str) };
    }
  }

  // ── 2.4 tools / grants ──
  const t = isObj(meta.tools) ? meta.tools : {};
  r.tools = {
    mcp: arr(t.mcp).map(str),
    capabilities: arr(t.capabilities).map(str),
    scopes: isObj(t.scopes) ? t.scopes : {},
    deny: arr(t.deny).map(str),
  };
  for (const c of r.tools.capabilities) if (!CAPABILITIES[c]) warn(`tools.capabilities`, `"${c}" is not in the closed vocabulary [${Object.keys(CAPABILITIES).join(', ')}]`);
  for (const c of r.tools.mcp) if (connectorIds.size && !connectorIds.has(c)) warn('tools.mcp', `"${c}" is not a registered connector`);
  if (r.tools.capabilities.includes('merge-pr')) warn('tools.capabilities', 'merge-pr is default-denied by policy — granted here explicitly');

  // ── 2.5 runtime ──
  const rt = isObj(meta.runtime) ? meta.runtime : {};
  r.runtime = {
    model: str(rt.model).trim(),
    effort: str(rt.effort).trim(),
    repo: arr(rt.repo).map(str).filter(Boolean),
    branch: str(rt.branch || 'main'),
    checkout: str(rt.checkout || (rt.repo ? 'shallow' : 'none')),
    worktree: !!rt.worktree,
    timeoutMs: rt.timeout != null ? durationMs(rt.timeout) : null,
    container: str(rt.container || ''),
    network: isObj(rt.network) ? rt.network : null,
  };
  if (rt.timeout != null && r.runtime.timeoutMs == null) err('runtime.timeout', `bad duration "${rt.timeout}"`);
  if (r.runtime.effort && !EFFORTS.includes(r.runtime.effort)) warn('runtime.effort', `"${r.runtime.effort}" not ${EFFORTS.join('|')}`);
  if (!['full', 'shallow', 'none'].includes(r.runtime.checkout)) err('runtime.checkout', `"${r.runtime.checkout}" not full|shallow|none`);
  if (r.runtime.container) warn('runtime.container', 'container profiles are not enforced by the local harness (runs use the host toolchain)');
  if (r.runtime.network) warn('runtime.network', 'egress allowlists are not enforced by the local harness — declared for review only');

  // ── 2.6 concurrency ──
  const cc = isObj(meta.concurrency) ? meta.concurrency : {};
  r.concurrency = {
    group: str(cc.group),
    cancelInProgress: !!cc.cancel_in_progress,
    lease: null, barrier: null, yieldToHuman: !!cc.yield_to_human, budget: null,
    // Fleet-UI shorthand: `scope: auto|pr|repo|routine|off` + `on_conflict:
    // wait|drop|coalesce` — the dispatcher synthesizes a per-routine lease from it.
    scope: '', scopeConflict: 'queue',
  };
  if (cc.scope != null) {
    const scope = str(cc.scope);
    if (!['auto', 'pr', 'repo', 'routine', 'off'].includes(scope)) err('concurrency.scope', `"${scope}" not auto|pr|repo|routine|off`);
    const conflictMap = { wait: 'queue', queue: 'queue', drop: 'skip', skip: 'skip', coalesce: 'coalesce' };
    const oc = str(cc.on_conflict ?? cc.onConflict ?? 'wait');
    if (!conflictMap[oc]) err('concurrency.on_conflict', `"${oc}" not wait|drop|coalesce`);
    r.concurrency.scope = scope;
    r.concurrency.scopeConflict = conflictMap[oc] ?? 'queue';
    if (cc.lease != null) warn('concurrency', 'both scope shorthand and an explicit lease — the explicit lease wins');
  }
  if (cc.lease != null) {
    const l = isObj(cc.lease) ? cc.lease : {};
    if (!l.resource) err('concurrency.lease', 'resource: required');
    const ttl = durationMs(l.ttl ?? '20m');
    if (ttl == null) err('concurrency.lease.ttl', `bad duration "${l.ttl}"`);
    const onConflict = str(l.on_conflict || 'skip');
    if (!ON_CONFLICT.includes(onConflict)) err('concurrency.lease.on_conflict', `"${onConflict}" not ${ON_CONFLICT.join('|')}`);
    r.concurrency.lease = { resource: str(l.resource), ttlMs: ttl ?? 1_200_000, onConflict };
  }
  if (cc.barrier != null) {
    const b = isObj(cc.barrier) ? cc.barrier : {};
    if (!b.stale_if_sha_changed) err('concurrency.barrier', 'stale_if_sha_changed: required');
    r.concurrency.barrier = { staleIfShaChanged: str(b.stale_if_sha_changed) };
  }
  if (cc.budget != null) {
    const b = isObj(cc.budget) ? cc.budget : {};
    if (!b.key) err('concurrency.budget', 'key: required');
    const max = parseInt(b.max_iterations, 10);
    if (!(max > 0)) err('concurrency.budget.max_iterations', 'must be a positive integer');
    r.concurrency.budget = { key: str(b.key), maxIterations: max || 3, onExhausted: str(b.on_exhausted || 'needs-human') };
  }

  // ── 2.7 secrets ──
  r.secrets = arr(meta.secrets).map((s, i) => {
    const p = `secrets[${i}]`;
    if (!isObj(s)) { err(p, 'each secret is { name, from }'); return null; }
    if (!s.name) err(`${p}.name`, 'required');
    if (!s.from) err(`${p}.from`, 'required — a reference (env://VAR or vault://path), never a value');
    const from = str(s.from);
    if (!/^(env|vault|file):\/\//.test(from)) warn(`${p}.from`, `"${from}" — expected env:// | vault:// | file:// reference`);
    return { name: str(s.name), from, scopes: arr(s.scopes).map(str), description: str(s.description) };
  }).filter(Boolean);

  // ── 2.8 state ──
  const st = isObj(meta.state) ? meta.state : meta.state === true ? { enabled: true } : {};
  r.state = { enabled: !!st.enabled, store: str(st.store || 'routine'), files: arr(st.files).map(str) };

  // ── 2.9 outputs ──
  const o = isObj(meta.outputs) ? meta.outputs : {};
  r.outputs = { statusSurface: null, emitCheckRun: str(o.emit_check_run || ''), summary: str(o.summary || '') };
  if (o.status_surface != null) {
    const s = isObj(o.status_surface) ? o.status_surface : {};
    const type = str(s.type || 'none');
    if (!SURFACE_TYPES.includes(type)) err('outputs.status_surface.type', `"${type}" not ${SURFACE_TYPES.join('|')}`);
    r.outputs.statusSurface = { type, marker: str(s.marker || `<!-- ${r.slug} -->`), channel: str(s.channel || '') };
  }

  // ── 2.10 policy ──
  const pol = isObj(meta.policy) ? meta.policy : {};
  r.policy = {
    requiresApproval: !!pol.requires_approval,
    approvers: arr(pol.approvers).map(str),
    maxRunsPerDay: pol.max_runs_per_day != null ? parseInt(pol.max_runs_per_day, 10) || 0 : 0,
    onFailure: arr(pol.on_failure).map(str),
    retry: null,
    notify: isObj(pol.notify) ? { on: arr(pol.notify.on).map(str), channel: str(pol.notify.channel) } : null,
  };
  if (pol.retry != null) {
    const rr = isObj(pol.retry) ? pol.retry : {};
    r.policy.retry = { max: Math.max(0, Math.min(5, parseInt(rr.max, 10) || 0)), backoff: str(rr.backoff || 'exponential') };
  }
  if (r.policy.requiresApproval && !r.policy.approvers.length) warn('policy.approvers', 'requires_approval with no approvers — anyone may approve');

  // ── 2.11 includes / extends ──
  r.includes = arr(meta.includes).map(str);
  r.extends = meta.extends != null ? str(meta.extends) : null;

  // ── chain: push-model hand-off (upstream declares its downstreams; the pull
  // form is `on: [{after: …}]` on the downstream — both are supported) ──
  r.chain = arr(meta.chain).map(str).filter(Boolean);

  // ── 2.12 flow ──
  if (meta.flow != null) {
    const f = isObj(meta.flow) ? meta.flow : {};
    const sub = isObj(f.subscribe) ? f.subscribe : {};
    const reconcile = durationMs(sub.reconcile ?? '1h');
    const ttl = durationMs(sub.ttl ?? '14d');
    r.flow = {
      subscribe: {
        events: arr(sub.events ?? ['check_run', 'pull_request_review', 'issue_comment', 'pull_request']).map(str),
        until: arr(sub.until ?? ['merged', 'closed']).map(str),
        reconcileMs: reconcile ?? 3_600_000,
        ttlMs: ttl ?? 14 * 86_400_000,
      },
      reactions: arr(f.reactions).map((x, i) => {
        const p = `flow.reactions[${i}]`;
        if (!isObj(x) || !isObj(x.when) || !x.do) { err(p, 'each reaction is { when: {<event>: {…}}, do: <handler|routine:slug|done> }'); return null; }
        const whenKeys = Object.keys(x.when);
        if (whenKeys.length !== 1) err(`${p}.when`, 'exactly one event key');
        let budget = null;
        if (x.budget != null) {
          const b = isObj(x.budget) ? x.budget : {};
          budget = { key: str(b.key || `${r.slug}:${str(x.do)}`), max: parseInt(b.max ?? b.max_iterations, 10) || 3, onExhausted: str(b.on_exhausted || 'needs-human') };
        }
        return { when: { event: whenKeys[0], filters: isObj(x.when[whenKeys[0]]) ? x.when[whenKeys[0]] : {} }, do: str(x.do), budget };
      }).filter(Boolean),
    };
  } else r.flow = null;

  // Unknown top-level keys → lint, so typos ('trigger:' for 'on:') don't silently no-op.
  const KNOWN = new Set(['name', 'slug', 'summary', 'owner', 'maintainers', 'team', 'tags', 'labels', 'enabled',
    'visibility', 'on', 'inputs', 'tools', 'runtime', 'concurrency', 'secrets', 'state', 'outputs', 'policy',
    'includes', 'extends', 'flow', 'chain']);
  for (const k of Object.keys(meta)) if (!KNOWN.has(k)) warn(k, 'unknown front-matter key (ignored)');

  return { routine: errors.length ? null : r, errors, warnings };
}

// Fleet-level lint: cross-routine checks (docs/02 §5 "statically analyzable").
export function lintFleet(routines) {
  const warnings = [];
  const bySlug = new Map(routines.map((r) => [r.slug, r]));
  const leaseKeys = new Map();
  for (const r of routines) {
    for (const t of r.on) {
      if (t.type === 'after' && !bySlug.has(t.config.routine)) {
        warnings.push({ slug: r.slug, msg: `on.after points at "${t.config.routine}" which is not in this folder` });
      }
    }
    for (const c of r.chain ?? []) {
      if (!bySlug.has(c)) warnings.push({ slug: r.slug, msg: `chain points at "${c}" which is not in this folder` });
    }
    if (r.concurrency.lease) {
      const k = r.concurrency.lease.resource;
      if (leaseKeys.has(k) && !k.includes('${{')) warnings.push({ slug: r.slug, msg: `lease resource "${k}" also claimed by ${leaseKeys.get(k)} — runs will serialize across routines` });
      leaseKeys.set(k, r.slug);
    }
    for (const rx of r.flow?.reactions ?? []) {
      if (rx.do.startsWith('routine:') && !bySlug.has(rx.do.slice(8))) {
        warnings.push({ slug: r.slug, msg: `flow reaction delegates to "${rx.do}" which is not in this folder` });
      } else if (rx.do !== 'done' && !rx.do.startsWith('routine:') && !(rx.do in (r.handlers || {}))) {
        warnings.push({ slug: r.slug, msg: `flow reaction "do: ${rx.do}" has no matching "## handler: ${rx.do}" body section` });
      }
    }
  }
  return warnings;
}
