// Switchboard Fleet API — a UI adapter over the EMBEDDED HARNESS.
//
// The engine (scheduler, matcher, dispatcher/leases, runner, flows, MCP wiring)
// is @switchboard/harness. Routines are *.md files in ROUTINES_DIR (the same
// files `harness up` runs); every wire/run/decision lands in that folder's
// single .harness log, and this server derives all state from it. There is no
// database — the UI is a structured editor + viewer over the harness's world.
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync, chmodSync } from 'node:fs';

import { Daemon } from '@switchboard/harness/src/daemon.js';
import { replay } from '@switchboard/harness/src/log.js';
import { fromGithub, fromManual, makeEnvelope } from '@switchboard/harness/src/events.js';
import { triggerMatches, evalCondition, FILTER_FIELDS } from '@switchboard/harness/src/match.js';
import { buildRunPrompt } from '@switchboard/harness/src/prompt.js';
import { allowedTools, buildMcpConfig, connectorHealth } from '@switchboard/harness/src/mcp.js';
import { runClaude } from '@switchboard/harness/src/runner.js';
import { nextCronFire, validTz } from '@switchboard/harness/src/cron.js';
import { renderTemplate, buildContext } from '@switchboard/harness/src/template.js';
import {
  uiToMeta, routineFileText, writeRoutineFile, deleteRoutineFile, patchRoutineMeta,
  flowToReactions, readConnectorsFile, upsertConnector, removeConnector, isBuiltinConnector,
} from '@switchboard/harness/src/writer.js';
import { rid } from '@switchboard/harness/src/util.js';

import { integrationStatus, listRepos, listOrgs, listChecks, claudeAccount, testConnector, bustStatus, gh } from './integrations.js';
import { SAMPLE_ROUTINES, DEFAULT_REPO } from './samples.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4317;
const ROUTINES_DIR = process.env.SWITCHBOARD_ROUTINES || join(__dirname, '..', 'routines');
mkdirSync(ROUTINES_DIR, { recursive: true });

const now = () => Date.now();

// ── Secrets sidecar: UI-managed tokens live OUTSIDE the reviewable folder log ──
// (.secrets.json is gitignored; the .harness log never contains a secret value.)
const SECRETS_PATH = join(ROUTINES_DIR, '.secrets.json');
function loadSecrets() {
  try { return JSON.parse(readFileSync(SECRETS_PATH, 'utf8')); } catch { return {}; }
}
function saveSecrets(s) {
  writeFileSync(SECRETS_PATH, JSON.stringify(s, null, 2));
  try { chmodSync(SECRETS_PATH, 0o600); } catch { /* best effort */ }
}
const secrets = { tokens: {}, mcpAuth: {}, webhookSecret: '', ...loadSecrets() };
const TOKEN_ENV = { slack: 'SLACK_BOT_TOKEN', atlassian: 'ATLASSIAN_API_TOKEN' };
const ENV_BASE = {};
for (const [code, envKey] of Object.entries(TOKEN_ENV)) {
  ENV_BASE[envKey] = process.env[envKey];
  if (secrets.tokens[code] && !process.env[envKey]) process.env[envKey] = secrets.tokens[code];
}

// ── Policies (org guardrails) — persisted as control.* entries in .harness ──
const DEFAULT_POLICIES = [
  { key: 'deny_merge', title: 'Never merge pull requests', desc: 'Every session is told to never run `gh pr merge` or any merge command.', on: true },
  { key: 'pr_not_push', title: 'Changes via pull request, not direct push', desc: 'Sessions must open a PR for changes instead of pushing to a protected branch.', on: true },
  { key: 'no_destructive', title: 'No destructive git/history ops', desc: 'Sessions must not force-push, delete branches, or rewrite history.', on: true },
];
function policyConstraints() {
  const saved = daemon?.state.policies || {};
  const on = (k) => (k in saved ? !!saved[k] : !!DEFAULT_POLICIES.find((p) => p.key === k)?.on);
  const c = [];
  if (on('deny_merge')) c.push('Never merge a pull request — do not run `gh pr merge` or any merge command.');
  if (on('pr_not_push')) c.push('Do not push directly to a protected or default branch; open a pull request for any change.');
  if (on('no_destructive')) c.push('Do not force-push, delete branches, or rewrite git history.');
  return c;
}

// ── Live plumbing: SSE bus + activity ring + in-memory traces, fed by the log mirror ──
const runBus = new EventEmitter();
runBus.setMaxListeners(0);
const traces = new Map();           // runId → TraceEvent[] (live runs; replay covers the rest)
const activity = [];                // ring of shaped activity rows (newest first)
const ACT_STATE = (e) => {
  if (e.ev === 'run.done') return e.ok ? 'success' : 'failing';
  if (['run.error', 'routine.error', 'event.rejected', 'budget.exhausted', 'barrier.stale', 'surface.error', 'flow.error'].includes(e.ev)) return 'failing';
  if (['run.start', 'retry.scheduled', 'lease.queued', 'group.queued', 'inbox.drain', 'task.added', 'flow.subscribed'].includes(e.ev)) return 'queued';
  if (['approval.granted', 'flow.reaction', 'chain.fired', 'cron.fired'].includes(e.ev)) return 'success';
  return 'idle';
};
const ACT_TEXT = (e) => {
  const bits = { ...e };
  delete bits.t; delete bits.ev;
  switch (e.ev) {
    case 'run.start': return `${e.slug} started · ${e.trigger}`;
    case 'run.done': return `${e.slug} ${e.ok ? 'ran · ' + String(e.summary ?? '').split('\n').pop().slice(0, 60) : 'failed · ' + String(e.summary ?? '').slice(0, 60)}`;
    case 'run.skip': return `${e.slug} skipped · ${e.reason}`;
    case 'run.coalesced': return `${e.slug} coalesced · ${e.reason}`;
    case 'lease.acquired': return `${e.slug} leased ${e.key}`;
    case 'lease.queued': return `${e.slug} waiting · ${e.key} held by ${e.holder}`;
    case 'event.received': return `event ${e.type} · matched [${(e.matched ?? []).join(', ') || '—'}]`;
    case 'event.rejected': return `event rejected · ${e.reason}`;
    case 'cron.fired': return `${e.slug} schedule fired${e.cron ? ' · ' + e.cron : ''}`;
    case 'chain.fired': return `chain ${e.from} → ${e.to}`;
    case 'flow.subscribed': return `${e.slug} following ${e.repo ? `${e.repo}#${e.pr}` : 'timers'}`;
    case 'flow.reaction': return `reaction · ${e.when} → ${e.reaction}`;
    case 'flow.unsubscribed': return `flow closed · ${e.reason}`;
    case 'task.added': return `${e.slug} inbox +1 · ${e.summary}`;
    case 'inbox.drain': return `${e.slug} draining ${e.tasks} inbox task${e.tasks > 1 ? 's' : ''}`;
    case 'retry.scheduled': return `${e.slug} retry ${e.attempt}/${e.max} in ${Math.round(e.in_ms / 1000)}s`;
    case 'control.kill': return `kill switch ${e.engaged ? 'ENGAGED' : 'released'} by ${e.by ?? '—'}`;
    case 'routine.error': return `${e.file}: ${(e.errors ?? []).join('; ').slice(0, 100)}`;
    case 'harness.up': return `harness up · ${e.routines} routine(s)`;
    case 'harness.reload': return `routines reloaded · ${e.routines} active, ${e.failures} failing to parse`;
    default: return `${e.ev} ${Object.entries(bits).slice(0, 4).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v)?.slice(0, 40) : v}`).join(' ')}`;
  }
};
const SILENT_EVS = new Set(['run.event', 'wire.secret', 'template.miss', 'event.fired']);
const fmtOffset = (ms) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;
const shapeTrace = (e) => ({ seq: e.seq, t: fmtOffset(e.ms ?? 0), ms: e.ms ?? 0, type: e.type, tool: e.tool ?? null, ok: e.ok == null ? null : (e.ok ? 1 : 0), text: e.text ?? '', truncated: !!e.truncated });

function onLogEntry(e) {
  if (e.ev === 'run.event') {
    const list = traces.get(e.run) ?? [];
    const shaped = shapeTrace(e);
    list.push(shaped);
    traces.set(e.run, list);
    runBus.emit(e.run, { kind: 'event', event: shaped });
    return;
  }
  if (['run.done', 'run.skip', 'run.coalesced'].includes(e.ev)) {
    const status = e.ev === 'run.done' ? (e.canceled ? 'canceled' : e.ok ? 'succeeded' : 'failed') : e.ev === 'run.skip' ? 'skipped' : 'coalesced';
    runBus.emit(e.run, { kind: 'done', status });
    setTimeout(() => traces.delete(e.run), 60_000).unref?.();   // replay serves it from here on
  }
  if (!SILENT_EVS.has(e.ev)) {
    activity.unshift({ time: String(e.t).slice(11, 19), text: ACT_TEXT(e), state: ACT_STATE(e) });
    if (activity.length > 300) activity.length = 300;
  }
}

// ── Boot the embedded harness ──
const daemon = new Daemon(ROUTINES_DIR, {
  http: false,
  mirror: onLogEntry,
  configOverrides: {
    trace: 'full',
    controlUrl: `http://127.0.0.1:${PORT}`,
    getMcpAuth: () => secrets.mcpAuth,
    getConstraints: () => policyConstraints(),
  },
});

// First boot: an empty folder ships with the runnable example fleet as real files.
function seedSamples(repo) {
  const fill = (s) => String(s || '').split('__REPO__').join(repo || DEFAULT_REPO);
  const created = [], skipped = [];
  for (const rt of SAMPLE_ROUTINES) {
    if (daemon.routines.some((r) => r.slug === rt.slug) || existsSync(join(ROUTINES_DIR, `${rt.slug}.md`))) { skipped.push(rt.slug); continue; }
    writeRoutineFile(ROUTINES_DIR, rt.slug, uiToMeta({ ...rt, repo: fill(rt.repo) }), fill(rt.prompt));
    created.push(rt.slug);
  }
  if (created.length) daemon.reload();
  return { created, skipped };
}
if (!daemon.routines.length && !daemon.failures.length) seedSamples(DEFAULT_REPO);
await daemon.up();
// Seed the activity ring from the recent past so the feed isn't empty on boot.
for (const e of replay(ROUTINES_DIR).slice(-150)) if (!SILENT_EVS.has(e.ev) && e.ev !== 'run.event') activity.unshift({ time: String(e.t).slice(11, 19), text: ACT_TEXT(e), state: ACT_STATE(e) });
activity.splice(300);

const { state, dispatcher } = daemon;
const bySlug = (slug) => dispatcher.bySlug(slug);

// ── Display helpers (the UI renders these strings verbatim) ──
function relTime(ts) {
  if (!ts) return '—';
  const d = now() - ts;
  if (d < 4000) return 'now';
  if (d < 60_000) return `${Math.round(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h ago`;
  return `${Math.round(d / 86_400_000)}d ago`;
}
const relFuture = (ts) => { const d = ts - now(); if (d < 60_000) return 'in <1m'; if (d < 3_600_000) return `in ${Math.round(d / 60_000)}m`; if (d < 86_400_000) return `in ${Math.round(d / 3_600_000)}h`; return `in ${Math.round(d / 86_400_000)}d`; };
const fmtDur = (ms) => (ms == null ? '…' : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);
const ts = (r) => Date.parse(r.finished ?? r.started ?? 0) || 0;
const AV_PALETTE = ['#d98a5c', '#c9a24a', '#6fae9a', '#7f9bd1', '#c98fb0', '#b59ad6', '#5b9ee6', '#5fbf86', '#e6b052'];
const ownerColor = (name) => { let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; };
const initialsOf = (name) => { const p = String(name).trim().split(/\s+/).filter(Boolean); return !p.length ? '??' : (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase(); };
const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const MODELS = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  { id: 'claude-fable-5', label: 'Fable 5' },
];
const MODEL_IDS = MODELS.map((m) => m.id);
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const DEFAULT_MODEL = 'claude-opus-4-8';

// ── Runs, from the harness ledger ──
const allRuns = () => [...state.runs.entries()].map(([id, r]) => ({ id, ...r })).sort((a, b) => ts(a) - ts(b) || a.id.localeCompare(b.id));
const runsFor = (slug) => allRuns().filter((r) => r.slug === slug);
const runStarted = (r) => Date.parse(r.started ?? 0) || 0;
const durOf = (r) => (r.status === 'running' || r.status === 'waiting' ? '…' : r.ms != null ? fmtDur(r.ms) : '—');
function traceFor(runId) {
  const live = traces.get(runId);
  if (live?.length) return live;
  return replay(ROUTINES_DIR).filter((e) => e.ev === 'run.event' && e.run === runId).map(shapeTrace);
}

// ── Routine shaping: harness routine object → the Fleet UI's wire format ──
const CONFLICT_BACK = { queue: 'wait', skip: 'drop', coalesce: 'coalesce' };
function uiConfig(r) {
  const triggers = [...new Set(r.on.map((t) => (t.type === 'github' ? t.config.event : t.type)))];
  const schedTrigger = r.on.find((t) => t.type === 'schedule');
  const ghTrigger = r.on.find((t) => t.type === 'github');
  return {
    triggers,
    schedule: schedTrigger?.config.cron ?? '',
    filters: ghTrigger?.config.filters ?? {},
    connectors: r.tools.mcp,
    chain: r.chain ?? [],
    reactions: flowToReactions(r.flow),
    concurrency: r.concurrency.scope
      ? { scope: r.concurrency.scope, onConflict: CONFLICT_BACK[r.concurrency.scopeConflict] ?? 'wait' }
      : r.concurrency.lease ? { scope: 'pr', onConflict: CONFLICT_BACK[r.concurrency.lease.onConflict] ?? 'wait' } : {},
    model: r.runtime.model || DEFAULT_MODEL,
    effort: r.runtime.effort || '',
    memory: !!r.state.enabled,
    repo: r.runtime.repo.join(', '),
    branch: r.runtime.branch || 'main',
    retries: r.policy.retry?.max ?? 0,
  };
}
function shapeRoutine(r) {
  const runs = runsFor(r.slug);
  const recentRuns = runs.slice(-12);
  const recent = recentRuns.map((x) => x.status);
  const finished = recent.filter((s) => s === 'succeeded' || s === 'failed');
  const successRate = finished.length ? Math.round((100 * finished.filter((s) => s === 'succeeded').length) / finished.length) : null;
  const last = runs[runs.length - 1];
  const live = runs.some((x) => x.status === 'running' || x.status === 'waiting');
  const spend = runs.reduce((a, x) => a + (x.costUsd || 0), 0);
  const withMs = runs.filter((x) => x.ms != null);
  const avg = withMs.length ? fmtDur(withMs.reduce((a, x) => a + x.ms, 0) / withMs.length) : '—';
  const cfg = uiConfig(r);
  const cronT = r.on.find((t) => t.type === 'schedule' && t.config.cron);
  const next = cronT ? (() => { const n = nextCronFire(cronT.config.cron, validTz(cronT.config.tz) ? cronT.config.tz : null); return n ? relFuture(n.getTime()) : cronT.config.cron; })() : (r.on.length ? 'on event' : '—');
  const inbox = [...state.tasks.entries()].reduce((a, [, list]) => a + list.filter((t) => t.slug === r.slug && !t.claimedBy).length, 0);
  return {
    slug: r.slug, name: r.name, summary: r.summary,
    owner: r.owner || 'unassigned', team: r.team || 'general',
    ownerColor: ownerColor(r.owner || 'unassigned'), initials: initialsOf(r.owner || 'unassigned'),
    ...cfg,
    state: !r.enabled ? 'disabled' : live ? 'running' : 'idle',
    enabled: !!r.enabled,
    lastAgo: last ? relTime(ts(last)) : 'never',
    lastStatus: !last ? 'idle' : last.status === 'running' ? 'running' : last.status === 'succeeded' ? 'success' : last.status === 'failed' ? 'failing' : 'idle',
    next,
    recent, successRate, runCount: recent.length,
    spend: `$${spend.toFixed(2)}`, avg, inbox,
  };
}
function detailOf(r) {
  const cfg = uiConfig(r);
  const flt = cfg.filters || {};
  const condVals = (field) => (flt.groups ?? []).flatMap((g) => g.conditions ?? []).filter((c) => c.field === field).flatMap((c) => c.values);
  return {
    breadcrumb: ['Fleet', r.slug],
    file: r.file,
    frontMatter: {
      on: r.on.map((t) => ({ key: `trigger · ${t.type === 'github' ? t.config.event : t.type}`, detail: t.type === 'schedule' ? (t.config.cron ?? t.config.every ?? '') : '' })),
      tools: cfg.connectors.map((c) => ({ sign: '+', name: c, tone: 'ok' })),
      runtime: [cfg.model, `${cfg.effort ? `· ${cfg.effort} effort ` : ''}· repos ${cfg.repo || '*'}`, `· branch ${cfg.branch}`],
      filters: { actions: [...new Set([...(flt.actions ?? []), ...condVals('action')])], branches: [...new Set([...(flt.branches ?? []), ...condVals('branch')])] },
    },
    flowNodes: [
      { title: cfg.triggers[0] || 'trigger', sub: 'on' },
      { title: 'session', sub: r.slug, tone: 'run' },
      ...(cfg.connectors.length ? [{ title: cfg.connectors.join(' + '), sub: 'tools' }] : []),
    ],
    prompt: r.prompt && r.prompt.trim() ? r.prompt : `## Prompt\n${r.summary}`,
  };
}
// Flow subscriptions rendered in the legacy "watches" vocabulary.
function watchRows(filterFn) {
  const rows = [];
  for (const [flowId, f] of state.flows) {
    if (!filterFn(f)) continue;
    const routine = bySlug(f.slug);
    const reactions = routine?.flow?.reactions ?? [];
    reactions.forEach((rx, i) => {
      const ui = flowToReactions({ reactions: [rx] })[0];
      rows.push({
        id: `${flowId}:${i}`, origin: f.slug, target: ui?.run ?? rx.do,
        source: ui?.source ?? 'github', kind: ui?.kind ?? rx.when.event, when: ui?.when ?? '',
        entity: f.pr ? { repo: f.repo, pr: f.pr } : {},
        status: f.status === 'open' ? 'open' : (f.fired?.[rx.do] || f.fired?.[`timeout:${rx.do}`]) ? 'fired' : 'expired',
        detail: f.status === 'open' ? '' : (f.reason ?? ''), attempts: 0, ago: relTime(f.createdAt),
      });
    });
  }
  return rows;
}
const kindOf = (r) => r.kind ?? 'trigger';

// Explain why a run matched: trigger + repo target + each filter condition.
function explainMatch(r, event, typeHint = '') {
  const type = event?.event || typeHint || event?.type || 'manual';
  const env = makeEnvelope(GITHUBISH_TYPES.has(type) ? 'github' : type, type, event ?? {});
  const listens = [...new Set(r.on.map((t) => (t.type === 'github' ? t.config.event : t.type)))];
  const fired = r.on.some((t) => triggerMatches(r, t, env));
  const checks = [{ label: `trigger is "${type}"`, ok: listens.includes(type) || (type === 'manual') || fired, detail: `listens for [${listens.join(', ') || 'none'}]` }];
  if (r.runtime.repo.length) {
    const er = env.repo;
    checks.push({ label: 'repository in target', ok: !er || r.runtime.repo.includes(er), detail: `target [${r.runtime.repo.join(', ')}]` });
  }
  const gh = r.on.find((t) => t.type === 'github' && t.config.filters);
  for (const g of gh?.config.filters.groups ?? []) for (const c of g.conditions ?? []) {
    const vals = (FILTER_FIELDS[c.field]?.(event ?? {}) || []).map(String);
    checks.push({ label: `${c.field} ${c.op} [${(c.values || []).join(', ')}]`, ok: evalCondition(c, event ?? {}), detail: `event ${c.field}: [${vals.join(', ') || '—'}]` });
  }
  return { fired, checks };
}
const GITHUBISH_TYPES = new Set(['pull_request', 'pull_request_target', 'push', 'label', 'issue_comment', 'issues',
  'pull_request_review', 'pull_request_review_comment', 'check_run', 'check_suite', 'release', 'workflow_run',
  'workflow_job', 'deployment_status', 'status', 'create', 'delete']);

// ── Dispatch through the embedded dispatcher (run id known synchronously) ──
function startRun(r, envelope, label) {
  const id = rid('run');
  const trigger = r.on.find((t) => triggerMatches(r, t, envelope)) ?? null;
  dispatcher.dispatch(r, trigger, envelope, { id, label, chainPath: envelope.chainPath ?? [] })
    .catch((e) => daemon.log.append('run.error', { run: id, slug: r.slug, error: e.message }));
  return id;
}

// ── Express ──
const app = express();
app.use(cors({ origin: [/^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/] }));
app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

app.get('/api/health', (_q, res) => res.json({ ok: true }));
app.get('/api/models', (_q, res) => res.json({ models: MODELS, efforts: EFFORTS, defaultModel: DEFAULT_MODEL }));

app.get('/api/stats', (_q, res) => {
  const routines = daemon.routines;
  const shaped = routines.map(shapeRoutine);
  const dayAgo = now() - 86_400_000;
  const finished = allRuns().filter((r) => ['succeeded', 'failed'].includes(r.status)).slice(-100);
  const successRate = finished.length ? Math.round((100 * finished.filter((r) => r.status === 'succeeded').length) / finished.length) : null;
  const spend = allRuns().reduce((a, r) => a + (r.costUsd || 0), 0);
  res.json({
    wordmark: 'Switchboard', killSwitch: !!state.killSwitch,
    total: routines.length, enabled: routines.filter((r) => r.enabled).length,
    teams: new Set(routines.map((r) => r.team || 'general')).size,
    running: shaped.filter((r) => r.enabled && r.state === 'running').length,
    failing: shaped.filter((r) => r.enabled && r.lastStatus === 'failing').length,
    runsToday: allRuns().filter((r) => runStarted(r) > dayAgo).length,
    successRate, spend: `$${spend.toFixed(2)}`,
  });
});

app.get('/api/github/repos', async (req, res) => res.json({ repos: await listRepos({ owner: String(req.query.owner || ''), q: String(req.query.q || '') }) }));
app.get('/api/github/orgs', async (_q, res) => res.json({ orgs: await listOrgs() }));
app.get('/api/github/checks', async (req, res) => res.json({ checks: await listChecks(String(req.query.repo || '')) }));
app.get('/api/github/labels', async (req, res) => {
  const repo = String(req.query.repo || '').trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return res.json({ labels: [] });
  const r = await gh(['api', `repos/${repo}/labels`, '--paginate', '--jq', '.[].name']);
  res.json({ labels: r.code === 0 ? r.out.split('\n').map((s) => s.trim()).filter(Boolean) : [] });
});

app.get('/api/routines', (_q, res) => res.json(daemon.routines.map(shapeRoutine)));

app.get('/api/routines/:slug', (req, res) => {
  const r = bySlug(req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  const runs = runsFor(r.slug);
  const runHistory = runs.slice(-12).reverse().map((x) => ({ id: x.id, status: x.status, ago: relTime(ts(x)), dur: durOf(x), trigger: x.trigger ?? '' }));
  const watches = watchRows((f) => f.slug === r.slug).slice(0, 20);
  const leases = [...dispatcher.leases.entries()].filter(([, l]) => l.slug === r.slug && l.expiresAt > now())
    .map(([key, l]) => ({ key, runId: l.runId, sha: l.sha ? String(l.sha).slice(0, 7) : '', held: relTime(l.acquiredAt), ttl: fmtDur(Math.max(0, l.expiresAt - now())) }));
  const inboxTasks = [...state.tasks.entries()].flatMap(([key, list]) => list.filter((t) => t.slug === r.slug && !t.claimedBy).map((t) => ({ summary: t.summary, key, ago: relTime(Date.parse(t.at)) }))).slice(0, 20);
  const lf = [...runs].reverse().find((x) => x.status === 'failed');
  const lastError = lf ? { runId: lf.id, output: String(lf.output || lf.summary || '').slice(0, 400), ago: relTime(ts(lf)) } : null;
  res.json({ ...shapeRoutine(r), ...detailOf(r), runHistory, watches, leases, inboxTasks, lastError });
});

app.post('/api/routines', (req, res) => {
  const b = req.body || {};
  const name = (b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'A routine name is required.' });
  const slug = slugify(b.slug || name);
  if (!slug) return res.status(400).json({ error: 'A valid slug is required.' });
  if (bySlug(slug) || existsSync(join(ROUTINES_DIR, `${slug}.md`))) return res.status(409).json({ error: `A routine with slug "${slug}" already exists.` });
  writeRoutineFile(ROUTINES_DIR, slug, uiToMeta({ ...b, slug }), b.prompt);
  daemon.reload();
  const r = bySlug(slug);
  if (!r) return res.status(400).json({ error: 'routine failed to load — check the definition' });
  res.status(201).json(shapeRoutine(r));
});

// PUT merges UI-owned keys into the existing front matter so hand-written
// richness (secrets, budgets, outputs, trigger guards on untouched sections…)
// survives an edit from the form. Replacing `on:` wholesale is intentional —
// the trigger list is what the form edits.
app.put('/api/routines/:slug', (req, res) => {
  const r = bySlug(req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  const cur = uiConfig(r);
  const merged = {
    name: b.name ?? r.name, slug: r.slug, summary: b.summary ?? r.summary,
    owner: b.owner ?? r.owner, team: b.team ?? r.team, enabled: r.enabled,
    triggers: b.triggers ?? cur.triggers, schedule: b.schedule ?? cur.schedule,
    filters: b.filters ?? cur.filters, connectors: b.connectors ?? cur.connectors,
    model: b.model ?? cur.model, effort: b.effort ?? cur.effort,
    repo: b.repo ?? cur.repo, branch: b.branch ?? cur.branch,
    memory: b.memory ?? cur.memory, concurrency: b.concurrency ?? cur.concurrency,
    retries: b.retries ?? cur.retries, chain: b.chain ?? cur.chain,
    reactions: b.reactions ?? cur.reactions,
  };
  const uiMeta = uiToMeta(merged);
  patchRoutineMeta(r.path, (meta) => {
    meta.name = uiMeta.name; meta.slug = r.slug; meta.summary = uiMeta.summary;
    meta.owner = uiMeta.owner; meta.team = uiMeta.team;
    if (uiMeta.enabled === false) meta.enabled = false; else delete meta.enabled;
    meta.on = uiMeta.on;
    if (uiMeta.chain) meta.chain = uiMeta.chain; else delete meta.chain;
    // tools: the mcp grant is UI-owned; capabilities/scopes/deny are preserved
    if (uiMeta.tools?.mcp?.length) meta.tools = { ...(meta.tools ?? {}), mcp: uiMeta.tools.mcp };
    else if (meta.tools) { delete meta.tools.mcp; if (!Object.keys(meta.tools).length) delete meta.tools; }
    // runtime: UI fields replaced, the rest (timeout, worktree, network…) kept
    const rt = { ...(meta.runtime ?? {}) };
    for (const k of ['model', 'effort', 'repo', 'branch']) { if (uiMeta.runtime?.[k] !== undefined) rt[k] = uiMeta.runtime[k]; else delete rt[k]; }
    if (uiMeta.runtime?.checkout && !rt.checkout) rt.checkout = uiMeta.runtime.checkout;
    if (Object.keys(rt).length) meta.runtime = rt; else delete meta.runtime;
    // memory toggle
    if (merged.memory) meta.state = { ...(meta.state ?? {}), enabled: true };
    else if (meta.state?.files?.length) meta.state = { ...meta.state, enabled: false };
    else delete meta.state;
    // concurrency shorthand (an explicit lease/budget block is preserved untouched)
    if (uiMeta.concurrency) meta.concurrency = { ...(meta.concurrency ?? {}), scope: uiMeta.concurrency.scope, on_conflict: uiMeta.concurrency.on_conflict };
    else if (meta.concurrency) { delete meta.concurrency.scope; delete meta.concurrency.on_conflict; if (!Object.keys(meta.concurrency).length) delete meta.concurrency; }
    // retry policy (other policy keys kept)
    if (uiMeta.policy?.retry) meta.policy = { ...(meta.policy ?? {}), retry: uiMeta.policy.retry };
    else if (meta.policy) { delete meta.policy.retry; if (!Object.keys(meta.policy).length) delete meta.policy; }
    // flow from UI reactions — only rewritten when the form actually sent them
    if (b.reactions !== undefined) { if (uiMeta.flow) meta.flow = uiMeta.flow; else delete meta.flow; }
    return meta;
  });
  if (b.prompt !== undefined && String(b.prompt).trim() !== r.prompt.trim()) {
    const raw = readFileSync(r.path, 'utf8');
    const m = raw.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)/);
    if (m) writeFileSync(r.path, m[1] + '\n' + (String(b.prompt).trim().startsWith('#') ? String(b.prompt).trim() : `## Prompt\n\n${String(b.prompt).trim()}`) + '\n');
  }
  daemon.reload();
  const fresh = bySlug(r.slug);
  if (!fresh) return res.status(400).json({ error: 'edit produced an invalid routine — check the file' });
  res.json(shapeRoutine(fresh));
});

app.delete('/api/routines/:slug', (req, res) => {
  const r = bySlug(req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  deleteRoutineFile(ROUTINES_DIR, r.file);
  daemon.reload();
  res.json({ ok: true });
});

app.post('/api/routines/:slug/enable', (req, res) => {
  const r = bySlug(req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  const en = !!req.body?.enabled;
  patchRoutineMeta(r.path, (meta) => { if (en) delete meta.enabled; else meta.enabled = false; return meta; });
  daemon.reload();
  res.json({ ok: true, enabled: en });
});

app.post('/api/routines/:slug/dispatch', (req, res) => {
  const r = bySlug(req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  if (state.killSwitch) return res.status(409).json({ error: 'kill switch engaged' });
  const payload = req.body?.event ?? { event: 'manual', routine: r.slug, dispatched_at: new Date().toISOString() };
  const env = makeEnvelope('manual', 'manual', payload);
  res.json({ ok: true, runId: startRun(r, env, 'manual'), status: 'running' });
});

app.post('/api/routines/:slug/preview', (req, res) => {
  const r = bySlug(req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  const payload = req.body?.event && Object.keys(req.body.event).length ? req.body.event : { event: 'manual', routine: r.slug };
  const env = makeEnvelope('manual', payload.event || 'manual', payload);
  const { prompt } = buildRunPrompt(r, env, { extraConstraints: policyConstraints() });
  const { allow } = allowedTools(r, { hasWorkspace: false });
  let leaseKey = null;
  if (r.concurrency.lease) leaseKey = renderTemplate(r.concurrency.lease.resource, buildContext({ event: env, runtime: r.runtime }));
  else if (r.concurrency.scope && r.concurrency.scope !== 'off') {
    const prNum = payload.pull_request?.number ?? payload.number;
    const repo = env.repo ?? r.runtime.repo[0];
    const scope = r.concurrency.scope === 'auto' ? ((repo && prNum) ? 'pr' : 'routine') : r.concurrency.scope;
    leaseKey = scope === 'pr' && repo && prNum ? `${r.slug}@pr:${repo}#${prNum}` : scope === 'repo' && repo ? `${r.slug}@repo:${repo}` : `routine:${r.slug}`;
  }
  const wouldMatch = r.on.some((t) => triggerMatches(r, t, env));
  res.json({ prompt, tools: r.tools.mcp, wouldMatch, leaseKey, allowedTools: allow, promptChars: prompt.length, estTokens: Math.round(prompt.length / 4) });
});

app.post('/api/routines/:slug/validate', async (req, res) => {
  const r = bySlug(req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  const st = await integrationStatus();
  const cfg = uiConfig(r);
  const checks = [
    { label: 'Identity', ok: !!r.name && !!r.slug, detail: `${r.name} · ${r.file}` },
    { label: 'Triggers', ok: r.on.length > 0, detail: cfg.triggers.join(', ') || 'no triggers — manual only' },
    { label: 'Instruction', ok: !!(r.prompt && r.prompt.trim().length > 12), detail: `${(r.prompt || '').length} chars` },
    { label: 'Model', ok: !cfg.model || MODEL_IDS.includes(cfg.model), detail: MODEL_IDS.includes(cfg.model) ? `${MODELS.find((m) => m.id === cfg.model)?.label || cfg.model}${cfg.effort ? ` · ${cfg.effort} effort` : ''}` : `unknown model "${cfg.model}" — pick a valid one` },
  ];
  const registryIds = new Set(Object.keys(daemon.registry));
  for (const c of r.tools.mcp) {
    if (c === 'github') checks.push({ label: 'Tool · gh', ok: st.github.connected, detail: st.github.connected ? `authed as @${st.github.account}` : 'gh not authed — run `gh auth login`' });
    else if (c === 'slack') checks.push({ label: 'Tool · slack-post', ok: st.slack.connected, detail: st.slack.connected ? `${st.slack.team} · @${st.slack.bot}` : 'SLACK_BOT_TOKEN not set' });
    else if (c === 'web' || c === 'webfetch') checks.push({ label: 'Tool · web', ok: true, detail: 'WebFetch / WebSearch' });
    else if (registryIds.has(c)) checks.push({ label: `Tool · ${c}`, ok: true, detail: `MCP · mcp__${c}__*` });
    else checks.push({ label: 'Tools', ok: false, detail: `not wired: ${c} — add it on the Connectors page, or remove it` });
  }
  for (const t of r.on) {
    if (t.type !== 'schedule' || !t.config.cron) continue;
    const parts = String(t.config.cron).trim().split(/\s+/);
    const okCron = parts.length === 5 && parts.every((f) => /^[\d*,/?-]+$/.test(f));
    checks.push({ label: 'Schedule cron', ok: okCron, detail: okCron ? t.config.cron : `"${t.config.cron}" is not a valid 5-field cron` });
  }
  (r.chain ?? []).forEach((c) => checks.push({ label: `Chain → ${c}`, ok: !!bySlug(c), detail: bySlug(c) ? 'resolves' : 'no such routine' }));
  for (const w of r.warnings ?? []) checks.push({ label: 'Lint', ok: false, detail: w });
  res.json({ ok: checks.every((c) => c.ok), checks });
});

app.get('/api/routines/:slug/raw', (req, res) => {
  const r = bySlug(req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json({ file: r.file, md: readFileSync(r.path, 'utf8') });
});

app.get('/api/routines/:slug/memory', (req, res) => {
  const r = bySlug(req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  const dir = join(ROUTINES_DIR, 'state', r.slug);
  const mdPath = join(dir, 'memory.md');
  const exists = existsSync(mdPath);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f !== 'memory.md' && !f.startsWith('.')) : [];
  res.json({ enabled: !!r.state.enabled, exists, md: exists ? readFileSync(mdPath, 'utf8') : '', files });
});

app.get('/api/templates', (_q, res) => res.json({
  templates: [
    { id: 'pr-reviewer', name: 'PR reviewer', desc: 'Review opened/updated PRs and comment', icon: '🔎', body: { triggers: ['pull_request'], connectors: ['github'], model: DEFAULT_MODEL, prompt: 'A pull request was opened or updated. Review the diff for bugs, risky changes, and missing tests, then post a concise review comment with `gh pr comment`.' } },
    { id: 'daily-report', name: 'Daily report', desc: 'Scheduled standup summary to Slack', icon: '📊', body: { triggers: ['schedule'], schedule: '0 9 * * 1-5', connectors: ['github', 'slack'], model: DEFAULT_MODEL, prompt: "Summarize yesterday's merged PRs and open issues for the repo, then post a short digest to the team channel with `slack-post`." } },
    { id: 'ci-watcher', name: 'CI failure watcher', desc: 'Triage failed checks', icon: '🚨', body: { triggers: ['check_run'], connectors: ['github', 'slack'], model: DEFAULT_MODEL, prompt: 'A CI check finished. If it failed, fetch the logs with `gh run view`, summarize the likely cause, and alert the author.' } },
  ],
}));

app.post('/api/samples/load', async (req, res) => {
  try {
    const repos = await listRepos({});
    const repo = String(req.body?.repo || '').trim() || repos[0] || '';
    const { created, skipped } = seedSamples(repo);
    res.json({ repo, routines: created, skipped });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Runs ──
app.get('/api/runs', (_q, res) => {
  const rows = allRuns().slice(-100).reverse().map((x) => ({
    id: x.id, routineSlug: x.slug, routineName: bySlug(x.slug)?.name ?? x.slug,
    status: x.status, ago: relTime(ts(x)), dur: durOf(x), trigger: x.trigger ?? '',
  }));
  res.json(rows);
});

app.get('/api/runs/:id/stream', (req, res) => {
  const id = req.params.id;
  const x = state.runs.get(id);
  if (!x) return res.status(404).json({ error: 'not found' });
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders?.();
  const send = (m) => res.write(`data: ${JSON.stringify(m)}\n\n`);
  for (const e of traceFor(id)) send({ kind: 'event', event: e });
  if (!['running', 'waiting'].includes(x.status)) { send({ kind: 'done', status: x.status }); return res.end(); }
  const ping = setInterval(() => res.write(':\n\n'), 25_000);
  const onMsg = (m) => { send(m); if (m.kind === 'done') { cleanup(); res.end(); } };
  const cleanup = () => { clearInterval(ping); runBus.off(id, onMsg); };
  runBus.on(id, onMsg);
  req.on('close', cleanup);
});

// The running agent's inbox — the `inbox` tool posts here (HARNESS_CONTROL_URL).
app.post('/api/runs/:id/inbox', (req, res) => {
  const id = req.params.id;
  if (!state.runs.get(id)) return res.status(404).json({ error: 'not found' });
  let key = null;
  for (const [k, l] of dispatcher.leases) if (l.runId === id) key = k;
  const pend = key ? dispatcher.pendingTasks(key) : [];
  dispatcher.claimTasks(pend.map((t) => t.id), id);
  res.json({ key, tasks: pend.map((t) => ({ id: t.id, summary: t.summary, event: t.payload })) });
});

app.post('/api/runs/:id/replay', (req, res) => {
  const origId = req.params.id;
  const x = state.runs.get(origId);
  if (!x) return res.status(404).json({ error: 'not found' });
  const r = bySlug(x.slug);
  if (!r) return res.status(404).json({ error: 'routine no longer exists' });
  if (state.killSwitch) return res.status(409).json({ error: 'kill switch engaged' });
  const payload = { ...(x.event ?? {}), _replay: true };
  const type = payload.event ?? x.type ?? 'manual';
  const source = GITHUBISH_TYPES.has(type) ? 'github' : type;
  const env = makeEnvelope(source, type, payload, { upstream: { routine: r.slug, run: origId } });
  res.json({ ok: true, runId: startRun(r, env, `replay · ${origId}`) });
});

app.post('/api/runs/:id/cancel', (req, res) => {
  const id = req.params.id;
  const x = state.runs.get(id);
  if (!x) return res.status(404).json({ error: 'not found' });
  if (!['running', 'waiting'].includes(x.status)) return res.status(409).json({ error: `run is ${x.status}, not running` });
  const killed = dispatcher.cancel(id);
  daemon.log.append('run.cancel', { run: id, slug: x.slug, killed });
  res.json({ ok: true, killed });
});

app.get('/api/runs/:id', (req, res) => {
  const x = state.runs.get(req.params.id);
  if (!x) return res.status(404).json({ error: 'not found' });
  const id = req.params.id;
  const r = bySlug(x.slug);
  const running = x.status === 'running';
  const ok = x.status === 'succeeded';
  const trace = traceFor(id);
  const toolAgg = new Map();
  for (const e of trace) {
    if (!e.tool) continue;
    const a = toolAgg.get(e.tool) ?? { tool: e.tool, calls: 0, errors: 0 };
    if (e.type === 'tool_use') a.calls++;
    if (e.type === 'tool_result' && e.ok === 0) a.errors++;
    toolAgg.set(e.tool, a);
  }
  const downstream = allRuns().filter((d) => d.upstream?.run === id)
    .map((d) => ({ runId: d.id, routine: d.slug, status: d.status, dur: durOf(d), kind: kindOf(d) }));
  const watches = watchRows((f) => f.run === id).map((w) => ({ target: w.target, source: w.source, kind: w.kind, when: w.when, status: w.status, detail: w.detail }));
  let inbox = [];
  for (const [key, list] of state.tasks) {
    inbox = inbox.concat(list.filter((t) => t.claimedBy === id || (!t.claimedBy && [...dispatcher.leases.entries()].some(([k, l]) => k === key && l.runId === id)))
      .map((t) => ({ summary: t.summary, ago: relTime(Date.parse(t.at)), pending: !t.claimedBy })));
  }
  res.json({
    id, routine: x.slug, status: x.status, trigger: x.trigger ?? '', triggerKind: kindOf(x),
    started: new Date(runStarted(x)).toLocaleTimeString(), elapsed: durOf(x),
    model: x.model || r?.runtime.model || DEFAULT_MODEL,
    cost: x.costUsd ?? null, turns: x.turns ?? null, sessionId: x.session ?? '',
    inTokens: x.inTokens ?? null, outTokens: x.outTokens ?? null,
    matchExplain: r && x.event ? explainMatch(r, x.event, x.type?.replace(/^manual$/, '') || '') : null,
    stdout: x.output ?? x.summary ?? '', event: x.event ?? null, trace, inbox,
    toolBreakdown: [...toolAgg.values()].filter((t) => t.calls > 0 || t.errors > 0).sort((a, b) => b.calls - a.calls),
    lineage: { triggeredBy: x.upstream?.run ? { runId: x.upstream.run, routine: x.upstream.routine, kind: kindOf(x) } : null, downstream, watches },
    awaiting: running ? 'auto-mode session running…' : null,
    summary: {
      result: running ? 'Running…' : ok ? (String(x.output ?? '').split('\n').pop()?.slice(0, 80) || 'Completed') : x.status === 'failed' ? 'Failed' : x.summary ?? x.status,
      surface: (r?.tools.mcp ?? []).join(', ') || 'session',
    },
  });
});

// ── Events in ──
function SAMPLE_PUSH() {
  return {
    event: 'push',
    repository: DEFAULT_REPO,
    ref: 'refs/heads/feat/oauth-login',
    pusher: 'fabio',
    head_commit: { id: 'a1b9f3c', message: 'wire up the OAuth callback handler' },
    pull_request: { number: 42, title: 'Add OAuth login flow', state: 'open', base: 'main' },
  };
}
function ingestGithubish(type, payload) {
  const envs = fromGithub(type, payload ?? {});
  const matched = new Set(); const runs = [];
  for (const env of envs) {
    const out = daemon.ingest(env);
    if (out.error) return out;
    out.matched.forEach((s) => matched.add(s));
    runs.push(...out.runs);
  }
  return { matched: [...matched], runs };
}
app.post('/api/events/:type', (req, res) => {
  const type = req.params.type;
  const payload = type === 'push' && (!req.body || !Object.keys(req.body).length) ? SAMPLE_PUSH() : req.body;
  const out = ingestGithubish(type, payload);
  if (out.error) return res.status(409).json(out);
  res.json({ ...out, event: payload });
});

function githubSignatureValid(req) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET || secrets.webhookSecret || '';
  if (!secret) return process.env.NODE_ENV !== 'production';
  const sig = req.get('x-hub-signature-256') || '';
  if (!sig) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody || Buffer.from('')).digest('hex');
  try { return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); }
  catch { return false; }
}
const _recentDeliveries = new Map();
function isDuplicateDelivery(key) {
  if (!key) return false;
  const prev = _recentDeliveries.get(key);
  _recentDeliveries.set(key, now());
  if (_recentDeliveries.size > 1000) for (const [k, v] of _recentDeliveries) if (now() - v > 600_000) _recentDeliveries.delete(k);
  return prev != null && now() - prev < 600_000;
}
app.post('/api/webhooks/github', (req, res) => {
  if (!githubSignatureValid(req)) return res.status(401).json({ error: 'invalid webhook signature' });
  const type = req.get('x-github-event') || 'push';
  if (type === 'ping') return res.json({ ok: true, pong: true });
  const deliveryId = req.get('x-github-delivery') || '';
  if (isDuplicateDelivery(deliveryId)) return res.json({ ok: true, duplicate: true });
  const out = ingestGithubish(type, req.body || {});
  if (out.error) return res.status(409).json(out);
  res.json({ ok: true, ...out });
});

const receiverUrl = () => (state.webhookUrl ? state.webhookUrl.replace(/\/$/, '') + '/api/webhooks/github' : '');
app.get('/api/webhooks/config', (_q, res) => res.json({
  publicUrl: state.webhookUrl || '',
  receiverUrl: receiverUrl(),
  secretSet: !!(process.env.GITHUB_WEBHOOK_SECRET || secrets.webhookSecret),
}));
app.post('/api/webhooks/config', (req, res) => {
  const url = String(req.body?.publicUrl || '').trim().replace(/\/$/, '');
  if (url) { try { new URL(url); } catch { return res.status(400).json({ error: 'invalid URL' }); } }
  state.webhookUrl = url;
  daemon.log.append('control.webhook-url', { url });
  res.json({ ok: true, publicUrl: url, receiverUrl: receiverUrl() });
});
app.post('/api/webhooks/secret', (_q, res) => {
  secrets.webhookSecret = crypto.randomBytes(24).toString('hex');
  saveSecrets(secrets);
  res.json({ ok: true, secretSet: true }); // never returns the secret
});

app.post('/api/kill-switch', (req, res) => {
  state.killSwitch = !!req.body?.engaged;
  daemon.log.append('control.kill', { engaged: state.killSwitch, by: 'ui' });
  res.json({ killSwitch: state.killSwitch });
});

// ── Connectors & MCP (registry = connectors.yaml + builtins; auth = .secrets.json) ──
const customConnectors = () => Object.values(daemon.registry).filter((c) => !isBuiltinConnector(c.id) && (c.kind ?? 'mcp') === 'mcp');
const isMcpRemoteDef = (def) => def?.command === 'npx' && Array.isArray(def?.args) && def.args.includes('mcp-remote');
const mcpRemoteUrl = (def) => (isMcpRemoteDef(def) ? def.args.find((a) => /^https?:\/\//.test(a)) : def?.url) || '';
const mcpRemoteDef = (url) => ({ command: 'npx', args: ['-y', 'mcp-remote', url] });
const maskConfig = (cfg) => {
  const c = JSON.parse(JSON.stringify(cfg || {}));
  if (c.env) for (const k of Object.keys(c.env)) c.env[k] = '••••';
  if (c.headers) for (const k of Object.keys(c.headers)) c.headers[k] = '••••';
  return c;
};

app.get('/api/connectors', async (_q, res) => {
  const st = await integrationStatus();
  const uses = (key) => daemon.routines.filter((r) => r.enabled && r.tools.mcp.includes(key)).length;
  const since7 = now() - 7 * 86_400_000;
  const agg = {};
  for (const x of allRuns()) { if (runStarted(x) > since7) { const e = (agg[x.slug] ||= { runs: 0, cost: 0 }); e.runs++; e.cost += x.costUsd || 0; } }
  const usageFor = (key) => {
    let runs = 0, cost = 0;
    for (const r of daemon.routines) if (r.tools.mcp.includes(key)) { const a = agg[r.slug]; if (a) { runs += a.runs; cost += a.cost; } }
    return { runs7d: runs, cost7d: +cost.toFixed(2) };
  };
  const out = [
    { code: 'GH', name: 'GitHub', kind: 'CLI · gh', health: st.github.connected ? 'ok' : 'off', auth: st.github.connected ? `gh · @${st.github.account}` : 'run `gh auth login`', scopes: 'read/write PRs, issues, checks, gists', routines: uses('github'), ...usageFor('github'), avColor: '#7f9bd1', testable: true, configKey: '' },
    { code: 'SL', name: 'Slack', kind: 'Bot', health: st.slack.connected ? 'ok' : 'off', auth: st.slack.connected ? `${st.slack.team} · @${st.slack.bot}` : 'set a bot token', scopes: 'post messages via slack-post', routines: uses('slack'), ...usageFor('slack'), avColor: '#c9a24a', testable: true, configKey: 'slack' },
    { code: 'WB', name: 'Web fetch', kind: 'Built-in', health: 'ok', auth: 'no auth needed', scopes: 'fetch & read public URLs', routines: uses('web'), ...usageFor('web'), avColor: '#8aa0b8', testable: true, configKey: '' },
  ];
  for (const c of customConnectors()) {
    const def = c.config ?? {};
    const authed = !!secrets.mcpAuth[c.id]?.token;
    const remote = isMcpRemoteDef(def);
    const transport = remote ? `remote · ${mcpRemoteUrl(def)}` : def.command ? `stdio · ${def.command}` : def.url ? `http · ${def.url}` : 'custom MCP';
    out.push({ code: c.id, name: c.id, kind: remote ? 'MCP · remote' : 'MCP', health: 'ok', auth: `${transport}${authed ? ' · 🔑 token' : ''}`, scopes: `mcp__${c.id}__*`, routines: uses(c.id), ...usageFor(c.id), avColor: '#b49ae6', testable: true, configKey: '', mcp: true, authed, remote });
  }
  res.json(out);
});

// Boot a tiny session with just this server's config and read the init event.
async function testMcp(name) {
  const fake = { tools: { mcp: [name], capabilities: [], scopes: {}, deny: [] } };
  const mcp = buildMcpConfig(fake, daemon.registry, { runId: `test-${name}`, auth: secrets.mcpAuth });
  if (!mcp.path) return { ok: false, detail: 'not configured' };
  let init = null;
  const r = await runClaude('Reply with the single word OK.', { mcpConfig: mcp.path, timeoutMs: 60_000, onEvent: (o) => { if (o.type === 'system' && o.subtype === 'init') init = o; } });
  if (init) {
    const srv = (init.mcp_servers || []).find((s) => s.name === name) || (init.mcp_servers || [])[0];
    const tools = (init.tools || []).filter((t) => typeof t === 'string' && t.startsWith(`mcp__${name}__`));
    if (srv) return { ok: srv.status !== 'failed', detail: `${name}: ${srv.status || 'loaded'} · ${tools.length} tool${tools.length === 1 ? '' : 's'}` };
    return { ok: false, detail: 'server did not load into the session' };
  }
  return { ok: false, detail: (r.stderr || `claude exited ${r.code}`).slice(0, 100) };
}
app.post('/api/connectors/:code/test', async (req, res) => {
  const t0 = now();
  const code = req.params.code;
  const isCustom = customConnectors().some((c) => c.id === code);
  const result = isCustom ? await testMcp(code) : await testConnector(code, req.body || {});
  res.json({ ...result, latencyMs: now() - t0 });
});
app.post('/api/connectors/:code/config', (req, res) => {
  const code = String(req.params.code || '').toLowerCase();
  const envKey = TOKEN_ENV[code];
  if (!envKey) return res.status(400).json({ error: 'this connector has no configurable token' });
  const token = String(req.body?.token || '').trim();
  if (token) { secrets.tokens[code] = token; process.env[envKey] = token; }
  else { delete secrets.tokens[code]; if (ENV_BASE[envKey]) process.env[envKey] = ENV_BASE[envKey]; else delete process.env[envKey]; }
  saveSecrets(secrets);
  bustStatus();
  res.json({ ok: true, configured: !!token });
});

app.get('/api/mcp', (_q, res) => res.json(customConnectors().map((c) => {
  const auth = secrets.mcpAuth[c.id] || {};
  return { name: c.id, config: maskConfig(c.config), remote: isMcpRemoteDef(c.config), url: mcpRemoteUrl(c.config), auth: { configured: !!auth.token, scheme: auth.scheme || 'bearer', header: auth.header || '' } };
})));
app.post('/api/mcp/:name/auth', (req, res) => {
  if (!customConnectors().some((c) => c.id === req.params.name)) return res.status(404).json({ error: 'not found' });
  const token = String(req.body?.token || '').trim();
  const scheme = ['bearer', 'raw'].includes(req.body?.scheme) ? req.body.scheme : 'bearer';
  const header = String(req.body?.header || '').trim();
  if (token) secrets.mcpAuth[req.params.name] = { token, scheme, header };
  else delete secrets.mcpAuth[req.params.name];
  saveSecrets(secrets);
  res.json({ ok: true, configured: !!token });
});

const isDef = (o) => o && typeof o === 'object' && (o.command || o.url);
function normalizeMcp(name, cfg) {
  if (typeof cfg === 'string') cfg = JSON.parse(cfg);
  if (cfg && cfg.mcpServers && typeof cfg.mcpServers === 'object') {
    const k = Object.keys(cfg.mcpServers)[0];
    return { name: name || k, def: cfg.mcpServers[k] };
  }
  if (isDef(cfg)) return { name, def: cfg };
  if (cfg && typeof cfg === 'object') {
    const keys = Object.keys(cfg);
    if (keys.length === 1 && isDef(cfg[keys[0]])) return { name: name || keys[0], def: cfg[keys[0]] };
    if (name && isDef(cfg[name])) return { name, def: cfg[name] };
  }
  return { name, def: cfg };
}
app.post('/api/mcp', (req, res) => {
  const b = req.body || {};
  if (b.remote && b.url) {
    let url; try { url = new URL(String(b.url).trim()).toString(); } catch { return res.status(400).json({ error: 'enter a valid https URL' }); }
    const host = new URL(url).hostname.split('.');
    const sld = host.length >= 2 ? host[host.length - 2] : host[0];
    const name = (String(b.name || '').trim() || sld).replace(/[^a-z0-9_-]/gi, '');
    if (!name) return res.status(400).json({ error: 'a server name is required' });
    upsertConnector(ROUTINES_DIR, name, { kind: 'mcp', config: mcpRemoteDef(url), detail: 'remote MCP (added in UI)' });
    daemon.reload();
    return res.json({ ok: true, name, remote: true });
  }
  let parsed;
  try { parsed = normalizeMcp(String(b.name || '').trim(), b.config); } catch { return res.status(400).json({ error: 'config must be valid JSON' }); }
  const name = String(parsed.name || '').trim().replace(/[^a-z0-9_-]/gi, '');
  if (!name) return res.status(400).json({ error: 'a server name is required — type one, or paste a { "name": { … } } config' });
  if (!isDef(parsed.def)) return res.status(400).json({ error: 'config needs a "command" (stdio) or a "url" (http/sse)' });
  upsertConnector(ROUTINES_DIR, name, { kind: 'mcp', config: parsed.def, detail: 'custom MCP (added in UI)' });
  daemon.reload();
  res.json({ ok: true, name });
});
app.delete('/api/mcp/:name', (req, res) => {
  removeConnector(ROUTINES_DIR, req.params.name);
  delete secrets.mcpAuth[req.params.name];
  saveSecrets(secrets);
  daemon.reload();
  res.json({ ok: true });
});

const RUNTIME_CMD = {
  npx: (id) => ({ command: 'npx', args: ['-y', id] }),
  uvx: (id) => ({ command: 'uvx', args: [id] }),
  pipx: (id) => ({ command: 'pipx', args: ['run', id] }),
  dnx: (id) => ({ command: 'dnx', args: [id] }),
  docker: (id) => ({ command: 'docker', args: ['run', '-i', '--rm', id] }),
};
app.get('/api/mcp/registry', async (req, res) => {
  const q = String(req.query.q || '').trim();
  try {
    const u = new URL('https://registry.modelcontextprotocol.io/v0/servers');
    if (q) u.searchParams.set('search', q);
    u.searchParams.set('limit', '40');
    const r = await fetch(u, { signal: AbortSignal.timeout(12_000) });
    if (!r.ok) return res.status(502).json({ error: `registry returned ${r.status}` });
    const data = await r.json();
    const seen = new Set(); const servers = [];
    for (const row of data.servers || []) {
      const s = row.server || {};
      if (!s.name || seen.has(s.name)) continue; seen.add(s.name);
      const remote = (s.remotes || [])[0];
      const pkg = (s.packages || []).find((p) => RUNTIME_CMD[p.runtimeHint]) || (s.packages || [])[0];
      if (!remote && !(pkg && RUNTIME_CMD[pkg.runtimeHint])) continue;
      servers.push({ id: s.name, name: String(s.name).split('/').pop(), description: s.description || '', version: s.version || '',
        remoteUrl: remote?.url || '', transport: remote?.type || pkg?.transport?.type || 'stdio', runtime: pkg?.runtimeHint || '', identifier: pkg?.identifier || '' });
    }
    res.json({ servers });
  } catch (e) { res.status(502).json({ error: `registry unreachable: ${e.message}` }); }
});
app.post('/api/mcp/registry/add', (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().replace(/[^a-z0-9_-]/gi, '');
  if (!name) return res.status(400).json({ error: 'a server name is required' });
  let def;
  if (b.remoteUrl) { try { def = mcpRemoteDef(new URL(String(b.remoteUrl)).toString()); } catch { return res.status(400).json({ error: 'invalid remote URL' }); } }
  else if (b.runtime && RUNTIME_CMD[b.runtime] && b.identifier) def = RUNTIME_CMD[b.runtime](String(b.identifier));
  else return res.status(400).json({ error: 'this server has no remote URL or runnable package' });
  upsertConnector(ROUTINES_DIR, name, { kind: 'mcp', config: def, detail: 'from MCP registry' });
  daemon.reload();
  res.json({ ok: true, name, remote: !!b.remoteUrl });
});

// mcp-remote OAuth bootstrap: run the proxy, surface the authorize URL to the UI.
const authProcs = new Map();
app.post('/api/mcp/:name/oauth', (req, res) => {
  const name = req.params.name;
  const c = customConnectors().find((x) => x.id === name);
  if (!c) return res.status(404).json({ error: 'not found' });
  const url = mcpRemoteUrl(c.config || {});
  if (!url) return res.status(400).json({ error: 'this server has no remote URL — add it in Remote or Registry mode to use OAuth' });
  const prev = authProcs.get(name); if (prev) { try { prev.kill(); } catch { /* ignore */ } authProcs.delete(name); }
  let child;
  try { child = spawn('npx', ['-y', 'mcp-remote', url], { env: process.env }); }
  catch (e) { return res.status(500).json({ error: `couldn't start mcp-remote: ${e.message}` }); }
  authProcs.set(name, child);
  let buf = '', done = false;
  const kill = () => { try { child.kill(); } catch { /* ignore */ } if (authProcs.get(name) === child) authProcs.delete(name); };
  const finish = (payload) => { if (done) return; done = true; clearTimeout(timer); res.json(payload); };
  const scan = (d) => {
    buf += d.toString();
    const m = buf.match(/Please authorize this client by visiting:\s*(https?:\/\/\S+)/i);
    if (m) return finish({ ok: true, authUrl: m[1], detail: 'Open this URL to authorize, then come back — mcp-remote saves the token to ~/.mcp-auth.' });
    if (/connected to remote server|proxy established|already authenticated|auth.*not required|connection established/i.test(buf)) { finish({ ok: true, detail: 'Connected — already authorized (or no OAuth required).' }); kill(); return; }
    if (/(fatal error|connection error|status 404|status 401|status 403|econnrefused)/i.test(buf)) {
      const line = (buf.split('\n').reverse().find((l) => /(fatal|error|40[13]|404|refused)/i.test(l)) || 'mcp-remote failed to connect').replace(/^\[\d+\]\s*/, '').slice(0, 220);
      finish({ ok: false, error: line.trim() }); kill();
    }
  };
  child.stdout.on('data', scan); child.stderr.on('data', scan);
  child.on('error', (e) => finish({ ok: false, error: `couldn't start mcp-remote: ${e.message}` }));
  child.on('exit', () => { if (authProcs.get(name) === child) authProcs.delete(name); if (!done) finish({ ok: false, error: 'mcp-remote exited before producing an auth URL — check the server URL.' }); });
  const timer = setTimeout(() => finish({ ok: true, detail: 'mcp-remote is running; if no browser tab opened, retry.' }), 25_000);
  setTimeout(kill, 5 * 60_000);
});

// ── Activity / settings ──
app.get('/api/activity', (_q, res) => res.json(activity.slice(0, 40)));

app.get('/api/settings', async (_q, res) => {
  const st = await integrationStatus();
  const claude = await claudeAccount();
  const saved = state.policies;
  const policies = DEFAULT_POLICIES.map((p) => ({ ...p, on: saved && p.key in saved ? !!saved[p.key] : p.on }));
  res.json({ identities: { ...st, claude }, policies });
});
app.post('/api/settings', (req, res) => {
  const policies = req.body?.policies || {};
  state.policies = policies;
  daemon.log.append('control.policies', { policies });
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`Switchboard API on http://localhost:${PORT} · engine: @switchboard/harness (embedded) · routines: ${ROUTINES_DIR} · log: ${join(ROUTINES_DIR, '.harness')}`));
