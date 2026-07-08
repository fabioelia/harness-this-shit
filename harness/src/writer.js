// Write routines back to disk: the Fleet UI's edit model → a real docs/02
// front-matter .md file. This is the inversion the design demands — the UI is a
// structured editor over the same file the runtime executes; nothing lives only
// in a database. Also: connectors.yaml round-trip for UI-managed MCP servers.
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { arr } from './util.js';
import { BUILTIN_CONNECTORS } from './loader.js';

const GITHUBISH = new Set(['pull_request', 'pull_request_target', 'push', 'label', 'issue_comment', 'issues',
  'pull_request_review', 'pull_request_review_comment', 'check_run', 'check_suite', 'release', 'workflow_run',
  'workflow_job', 'deployment_status', 'status', 'create', 'delete']);

const cleanFilters = (f) => {
  const o = f && typeof f === 'object' ? f : {};
  const arrs = (x) => (Array.isArray(x) ? x.map((s) => String(s).trim()).filter(Boolean) : []);
  if (Array.isArray(o.groups)) {
    const groups = o.groups.map((g) => ({
      match: g?.match === 'any' ? 'any' : 'all',
      conditions: (Array.isArray(g?.conditions) ? g.conditions : [])
        .map((c) => ({ field: String(c?.field || 'action'), op: String(c?.op || 'is'), values: arrs(c?.values) }))
        .filter((c) => c.values.length || c.op === 'is_not'),
    })).filter((g) => g.conditions.length);
    return groups.length ? { match: o.match === 'any' ? 'any' : 'all', groups } : null;
  }
  // legacy flat shape → one AND group
  const conds = [];
  if (arrs(o.actions).length) conds.push({ field: 'action', op: 'is', values: arrs(o.actions) });
  if (arrs(o.branches).length) conds.push({ field: 'branch', op: 'is', values: arrs(o.branches) });
  if (arrs(o.labels).length) conds.push({ field: 'label', op: 'is', values: arrs(o.labels) });
  return conds.length ? { match: o.mode === 'or' ? 'any' : 'all', groups: [{ match: o.mode === 'or' ? 'any' : 'all', conditions: conds }] } : null;
};

// UI reaction rows → flow reactions ({source, kind, when, check, run} → when/do).
function reactionToFlow(rx) {
  const target = `routine:${rx.run}`;
  if (rx.source === 'timeout') return { when: { timeout: { after: rx.when || '30m' } }, do: target };
  if (rx.kind === 'checks') {
    const f = {};
    if (rx.when && rx.when !== 'any') f.conclusion = rx.when;
    if (rx.check) f.name = rx.check;
    return { when: { check_run: f }, do: target };
  }
  if (rx.kind === 'review') {
    return { when: { pull_request_review: rx.when && rx.when !== 'any' ? { state: rx.when } : {} }, do: target };
  }
  if (rx.kind === 'merge') return { when: { pull_request: { merged: true } }, do: target };
  return null;
}

// RAW front-matter flow reactions → UI rows (null for a reaction the UI can't
// represent — a handler `do:` or `do: done`). Mirrors flowToReactions but on the
// on-disk shape ({ when: { check_run: {...} }, do }), used by the PUT merge.
export function rawFlowToRows(flow) {
  const arrx = Array.isArray(flow?.reactions) ? flow.reactions : [];
  return arrx.map((rx) => {
    const run = typeof rx.do === 'string' && rx.do.startsWith('routine:') ? rx.do.slice(8) : '';
    if (!run) return null;
    const when = rx.when ?? {};
    const ev = Object.keys(when)[0]; const f = when[ev] ?? {};
    if (ev === 'timeout') return { source: 'timeout', kind: 'after', when: String(f.after ?? ''), check: '', run };
    if (ev === 'check_run' || ev === 'status') return { source: 'github', kind: 'checks', when: String(f.conclusion ?? 'any'), check: String(f.name ?? ''), run };
    if (ev === 'pull_request_review') return { source: 'github', kind: 'review', when: String(f.state ?? 'any'), check: '', run };
    if (ev === 'pull_request') return { source: 'github', kind: 'merge', when: 'merged', check: '', run };
    return null;
  }).filter(Boolean);
}

// Merge the UI's reaction rows into the file's existing `flow:`, preserving what
// the UI can't model: handler/`done` reactions, per-reaction budgets, exact
// filters, and the subscribe block. Returns null when nothing remains.
export function mergeFlow(rawOriginalFlow, uiRows) {
  const rows = Array.isArray(uiRows) ? uiRows : [];
  const orig = Array.isArray(rawOriginalFlow?.reactions) ? rawOriginalFlow.reactions : [];
  const key = (r) => `${r.source}|${r.kind}|${r.when}|${r.check}|${r.run}`;
  const origByKey = new Map();
  for (const rx of orig) { const row = rawFlowToRows({ reactions: [rx] })[0]; if (row) origByKey.set(key(row), rx); }
  const merged = []; const used = new Set();
  for (const row of rows) {
    const k = key(row);
    if (origByKey.has(k)) { const rx = origByKey.get(k); merged.push(rx); used.add(rx); }   // keep original (budget, exact filters)
    else { const f = reactionToFlow(row); if (f) merged.push(f); }
  }
  for (const rx of orig) { if (used.has(rx)) continue; if (!rawFlowToRows({ reactions: [rx] })[0]) merged.push(rx); }   // preserve handlers / done
  if (!merged.length) return null;
  return {
    subscribe: rawOriginalFlow?.subscribe ?? { events: ['check_run', 'pull_request_review', 'pull_request'], until: ['merged', 'closed'], reconcile: '45s', ttl: '45m' },
    reactions: merged,
  };
}

// The reverse: flow reactions back into UI rows (for display/edit). Reactions
// that don't fit the UI vocabulary (handlers, exotic filters) map best-effort.
export function flowToReactions(flow) {
  if (!flow) return [];
  return flow.reactions.map((rx) => {
    const run = rx.do.startsWith('routine:') ? rx.do.slice(8) : rx.do === 'done' ? '' : `#${rx.do}`;
    const ev = rx.when.event, f = rx.when.filters ?? {};
    if (ev === 'timeout') return { source: 'timeout', kind: 'after', when: String(f.after ?? ''), check: '', run };
    if (ev === 'check_run' || ev === 'status') return { source: 'github', kind: 'checks', when: String(f.conclusion ?? 'any'), check: String(f.name ?? ''), run };
    if (ev === 'pull_request_review') return { source: 'github', kind: 'review', when: String(f.state ?? 'any'), check: '', run };
    if (ev === 'pull_request') return { source: 'github', kind: 'merge', when: 'merged', check: '', run };
    return { source: 'github', kind: ev, when: '', check: '', run };
  }).filter((x) => x.run && !x.run.startsWith('#'));
}

// Build the front-matter meta object from the Fleet UI's create/update body.
export function uiToMeta(b) {
  const meta = {
    name: String(b.name || '').trim(),
    slug: String(b.slug || '').trim() || undefined,
    summary: String(b.summary || '').trim(),
    owner: String(b.owner || '').trim() || 'unassigned',
    team: String(b.team || '').trim() || 'general',
  };
  if (b.enabled === false) meta.enabled = false;

  const filters = cleanFilters(b.filters);
  meta.on = arr(b.triggers).filter(Boolean).map((t) => {
    if (t === 'schedule') return { schedule: { cron: String(b.schedule || '').trim() } };
    if (t === 'manual') return { manual: {} };
    if (t === 'api') return { api: {} };
    if (t === 'webhook') return { webhook: { id: meta.slug || 'hook' } };
    if (GITHUBISH.has(t)) return { github: { event: t, ...(filters ? { filters } : {}) } };
    return { [t]: {} };                       // connector event trigger
  });

  const connectors = arr(b.connectors).filter(Boolean);
  if (connectors.length) meta.tools = { mcp: connectors };

  meta.runtime = {
    model: String(b.model || '').trim() || undefined,
    ...(String(b.effort || '').trim() ? { effort: String(b.effort).trim() } : {}),
    ...(String(b.repo || '').trim() ? { repo: String(b.repo).split(',').map((s) => s.trim()).filter(Boolean), checkout: 'none' } : {}),
    ...(String(b.branch || '').trim() && b.branch !== 'main' ? { branch: String(b.branch).trim() } : {}),
  };
  if (!meta.runtime.model) delete meta.runtime.model;
  if (!Object.keys(meta.runtime).length) delete meta.runtime;

  if (b.memory) meta.state = { enabled: true };

  // Concurrency shorthand: `auto` + `wait` is the "no opinion" default — don't
  // stamp a lease onto a routine the user never asked to serialize.
  const conc = b.concurrency && typeof b.concurrency === 'object' ? b.concurrency : {};
  if (conc.scope && !(conc.scope === 'auto' && (conc.onConflict ?? 'wait') === 'wait')) {
    meta.concurrency = { scope: conc.scope, on_conflict: conc.onConflict || 'wait' };
  }

  const retries = Math.max(0, Math.min(3, parseInt(b.retries, 10) || 0));
  if (retries) meta.policy = { retry: { max: retries, backoff: 'exponential' } };

  const chain = arr(b.chain).filter(Boolean);
  if (chain.length) meta.chain = chain;

  const flowReactions = arr(b.reactions).map(reactionToFlow).filter(Boolean);
  if (flowReactions.length) {
    meta.flow = {
      subscribe: { events: ['check_run', 'pull_request_review', 'pull_request'], until: ['merged', 'closed'], reconcile: '45s', ttl: '45m' },
      reactions: flowReactions,
    };
  }
  return meta;
}

// The stable "token" a raw on-entry maps to a UI trigger checkbox by.
function onToken(entry) {
  if (!entry || typeof entry !== 'object') return String(entry);
  const type = Object.keys(entry)[0];
  const cfg = entry[type] ?? {};
  return type === 'github' ? (cfg.event || 'github') : type;
}
const isUiOwnedEntry = (entry) => {
  const type = Object.keys(entry)[0];
  const cfg = entry[type] ?? {};
  const hasGuards = ['if', 'gate', 'debounce', 'dedupe_key', 'dedupe_window'].some((k) => cfg[k] != null);
  if (hasGuards) return false;
  if (type === 'schedule') return cfg.cron != null;          // every:/at: are UI-invisible → preserve
  if (type === 'github' || type === 'manual' || type === 'api') return true;
  return false;                                              // after:/webhook:/connector: → preserve verbatim
};

// Merge the form's freshly-built `on:` with the file's existing `on:`, so an edit
// that only touches unrelated fields never destroys triggers the UI can't model
// (every:/at: schedules, after:, webhook:, connector events, trigger guards) and
// so hand-written github filters survive when there are several github triggers.
export function mergeOn(originalOn, uiOn, uiTriggers) {
  const orig = Array.isArray(originalOn) ? originalOn : [];
  const tokens = new Set(uiTriggers);
  const out = [];
  const usedUi = new Set();
  const githubCount = orig.filter((e) => Object.keys(e)[0] === 'github').length;

  // 1. Walk the original entries in order; keep the ones the UI still wants.
  for (const entry of orig) {
    const tok = onToken(entry);
    const uiOwned = isUiOwnedEntry(entry);
    // UI-owned entries (github events, cron schedule, manual, api) are dropped when
    // the form removed their checkbox; entries the UI CAN'T see (after/webhook/
    // connector/every-at/guarded) are always preserved — the UI never chose to drop them.
    if (uiOwned && !tokens.has(tok)) continue;
    if (uiOwned) {
      const ui = uiOn.find((u, i) => !usedUi.has(i) && onToken(u) === tok);
      if (ui) {
        usedUi.add(uiOn.indexOf(ui));
        const type = Object.keys(entry)[0];
        if (type === 'github' && githubCount > 1) {
          // several github triggers, one UI filter builder → don't stamp the single
          // filter set onto all of them; keep each entry's own filters.
          out.push(entry);
        } else {
          // regenerate from the form, but carry any guards the original held
          const merged = structuredClone(ui);
          const uType = Object.keys(merged)[0];
          const guards = {};
          for (const k of ['if', 'gate', 'debounce', 'dedupe_key', 'dedupe_window']) if (entry[type]?.[k] != null) guards[k] = entry[type][k];
          if (Object.keys(guards).length) merged[uType] = { ...merged[uType], ...guards };
          out.push(merged);
        }
      } else out.push(entry);
    } else {
      out.push(entry);                                       // preserve verbatim (every/at/after/webhook/connector/guarded)
      const ui = uiOn.findIndex((u, i) => !usedUi.has(i) && onToken(u) === tok);
      if (ui >= 0) usedUi.add(ui);                           // consume the UI's lossy stand-in so it isn't re-added
    }
  }
  // 2. Append UI triggers that had no original counterpart (newly added).
  uiOn.forEach((u, i) => { if (!usedUi.has(i)) out.push(u); });
  return out;
}

// Split a body into ordered {heading, text} sections (heading '' = pre-first-H2).
function bodySections(body) {
  const out = [];
  let heading = '', buf = [];
  for (const line of String(body).split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { out.push({ heading, text: buf.join('\n') }); heading = h[1]; buf = []; }
    else buf.push(line);
  }
  out.push({ heading, text: buf.join('\n') });
  return out;
}

// Rebuild a routine body with a new operative prompt while preserving the
// human-facing preamble above `## Prompt` and every `## handler:` section.
export function rebuildBody(originalBody, newPrompt) {
  const secs = bodySections(originalBody);
  const promptIdx = secs.findIndex((s) => /^prompt$/i.test(s.heading));
  const cut = promptIdx >= 0 ? promptIdx : secs.findIndex((s) => /^handler:/i.test(s.heading));
  const preamble = (cut > 0 ? secs.slice(0, cut) : cut === 0 ? [] : secs)
    .filter((s) => !/^handler:/i.test(s.heading))
    .map((s) => (s.heading ? `## ${s.heading}\n${s.text}` : s.text)).join('\n').trim();
  const handlers = secs.filter((s) => /^handler:/i.test(s.heading)).map((s) => `## ${s.heading}\n${s.text}`.trim());
  const p = String(newPrompt).trim();
  const promptBlock = p.startsWith('#') ? p : `## Prompt\n\n${p}`;
  // When there's no ## Prompt and no handlers, the whole body IS the prompt.
  const hasPromptSection = promptIdx >= 0 || handlers.length > 0;
  return [hasPromptSection ? preamble : '', promptBlock, ...handlers].filter(Boolean).join('\n\n') + '\n';
}

export function routineFileText(meta, prompt) {
  const yaml = YAML.stringify(meta, { lineWidth: 120 });
  const body = String(prompt || '').trim() || `## Prompt\n${meta.summary || ''}`;
  return `---\n${yaml}---\n\n${body.startsWith('#') ? body : `## Prompt\n\n${body}`}\n`;
}

export function writeRoutineFile(dir, slug, meta, prompt) {
  const path = join(dir, `${slug}.md`);
  writeFileSync(path, routineFileText(meta, prompt));
  return path;
}

// Patch just the front matter of an existing file, preserving the body verbatim
// (e.g. the enable toggle). fn mutates-or-returns the parsed meta object.
export function patchRoutineMeta(path, fn) {
  const raw = readFileSync(path, 'utf8');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error('file has no front matter');
  const meta = YAML.parse(m[1]) ?? {};
  const next = fn(meta) ?? meta;
  writeFileSync(path, `---\n${YAML.stringify(next, { lineWidth: 120 })}---\n${m[2]}`);
}

export function deleteRoutineFile(dir, slugOrFile) {
  for (const name of [slugOrFile, `${slugOrFile}.md`, `${slugOrFile}.routine.md`]) {
    const p = join(dir, name);
    if (existsSync(p)) { unlinkSync(p); return true; }
  }
  return false;
}

// ── connectors.yaml round-trip for UI-managed MCP servers ──
const CONN_FILE = 'connectors.yaml';
export function readConnectorsFile(dir) {
  const p = join(dir, CONN_FILE);
  if (!existsSync(p)) return {};
  const doc = YAML.parse(readFileSync(p, 'utf8')) ?? {};
  if (Array.isArray(doc)) return Object.fromEntries(doc.filter((c) => c?.id).map((c) => [c.id, c]));
  if (Array.isArray(doc.connectors)) return Object.fromEntries(doc.connectors.filter((c) => c?.id).map((c) => [c.id, c]));
  return doc;
}
export function upsertConnector(dir, id, entry) {
  const doc = readConnectorsFile(dir);
  doc[id] = entry;
  writeFileSync(join(dir, CONN_FILE), YAML.stringify(doc, { lineWidth: 120 }));
}
export function removeConnector(dir, id) {
  const doc = readConnectorsFile(dir);
  if (!(id in doc)) return false;
  delete doc[id];
  writeFileSync(join(dir, CONN_FILE), YAML.stringify(doc, { lineWidth: 120 }));
  return true;
}
export const isBuiltinConnector = (id) => id in BUILTIN_CONNECTORS;
