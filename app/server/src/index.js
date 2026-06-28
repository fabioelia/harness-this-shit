import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
// In-process bus so the run trace can stream live over SSE (no DB polling lag).
const runBus = new EventEmitter();
runBus.setMaxListeners(0);
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { getDb, all, one, run } from './db.js';
import { runClaude, buildPrompt, allowedToolsFor } from './runner.js';
import { integrationStatus, listRepos, listOrgs, listChecks, claudeAccount, testConnector, bustStatus, gh } from './integrations.js';
import { SAMPLE_ROUTINES, SAMPLE_AGENTS } from './samples.js';

const app = express();
// Same-machine tool: only allow the local web origin to call the API from a browser.
app.use(cors({ origin: [/^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/] }));
app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
getDb();

// Verify a GitHub webhook HMAC (X-Hub-Signature-256) when a secret is configured.
function githubSignatureValid(req) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET || metaGet('webhook_secret', '');
  if (!secret) return process.env.NODE_ENV !== 'production'; // fail-closed in prod, accept in local/dev
  const sig = req.get('x-hub-signature-256') || '';
  if (!sig) return false; // a secret is set → an unsigned request is rejected
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody || Buffer.from('')).digest('hex');
  try { return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); }
  catch { return false; }
}
if (process.env.NODE_ENV === 'production' && !process.env.GITHUB_WEBHOOK_SECRET)
  console.warn('[switchboard] NODE_ENV=production but GITHUB_WEBHOOK_SECRET is unset — /api/webhooks/github will reject all requests until you set it.');

const PORT = process.env.PORT || 4317;
const j = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } };
const jObj = (s) => { try { return JSON.parse(s); } catch { return null; } };
const meta = (k, d) => one('SELECT value FROM meta WHERE key=?', k)?.value ?? d;
const metaGet = meta; // alias used before `meta` is in scope in hoisted fns
const setMeta = (k, v) => run("INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", k, String(v));
// Automatic cost guardrail: a daily spend cap that pauses dispatch when reached.
const todaySpend = () => { const s = new Date(now()); s.setHours(0, 0, 0, 0); return one('SELECT COALESCE(SUM(cost_usd),0) AS s FROM runs WHERE created_at > ?', s.getTime()).s || 0; };
const budgetCap = () => parseFloat(metaGet('daily_budget', '')) || 0;
const overBudget = () => { const cap = budgetCap(); return cap > 0 && todaySpend() >= cap; };
// UI-configured secrets are stored in meta; load them into the process env so the
// runner's child sessions and the integrations both see them (env wins if already set).
const TOKEN_ENV = { slack: 'SLACK_BOT_TOKEN', atlassian: 'ATLASSIAN_API_TOKEN' };
const ENV_BASE = {}; // the real shell-env tokens, so clearing a UI override restores them
for (const [k, envKey] of Object.entries(TOKEN_ENV)) {
  ENV_BASE[envKey] = process.env[envKey];
  const v = meta(`token_${k}`, ''); if (v && !process.env[envKey]) process.env[envKey] = v;
}
const now = () => Date.now();

// ── Custom MCP servers: user drops in a config + auth; routines grant them ──────
const mcpNameSet = () => new Set(all('SELECT name FROM mcp_servers').map((s) => s.name));
const maskConfig = (cfg) => {
  const c = JSON.parse(JSON.stringify(cfg || {}));
  if (c.env) for (const k of Object.keys(c.env)) c.env[k] = '••••';
  if (c.headers) for (const k of Object.keys(c.headers)) c.headers[k] = '••••';
  return c;
};
// Wrap a remote MCP URL with mcp-remote — the drop-in proxy that handles the OAuth 2.1
// browser flow + token storage (~/.mcp-auth) and --header token auth for Claude.
const mcpRemoteDef = (url) => ({ command: 'npx', args: ['-y', 'mcp-remote', url] });
const isMcpRemote = (def) => def?.command === 'npx' && Array.isArray(def?.args) && def.args.includes('mcp-remote');
const mcpRemoteUrl = (def) => (isMcpRemote(def) ? def.args.find((a) => /^https?:\/\//.test(a)) : def?.url) || '';

// Normalize whatever the user pasted into { name, def }. Accepts a bare def,
// a single-key wrapper { betterstack: {...} }, or a full { mcpServers: { name: def } }.
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
// Write an --mcp-config file for the granted MCP server names; null if none configured.
function writeMcpConfig(grantedNames) {
  const set = mcpNameSet();
  const names = [...new Set((grantedNames || []).filter((n) => set.has(n)))];
  if (!names.length) return null;
  const mcpServers = {};
  for (const n of names) {
    const row = one('SELECT config, auth FROM mcp_servers WHERE name=?', n);
    if (!row) continue;
    const def = jObj(row.config) || {};
    const auth = jObj(row.auth) || {};
    if (auth.token) {
      const value = auth.scheme === 'raw' ? auth.token : `Bearer ${auth.token}`;
      if (isMcpRemote(def)) def.args = [...def.args, '--header', `${auth.header || 'Authorization'}: ${value}`];
      else if (def.url) def.headers = { ...(def.headers || {}), [auth.header || 'Authorization']: value };
      else def.env = { ...(def.env || {}), [auth.header || 'API_KEY']: auth.token };
    }
    mcpServers[n] = def;
  }
  const path = join(tmpdir(), `sb-mcp-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(path, JSON.stringify({ mcpServers }));
  return path;
}
// Test a server by booting a tiny session with just its config and reading the init event.
async function testMcp(name) {
  const path = writeMcpConfig([name]);
  if (!path) return { ok: false, detail: 'not configured' };
  let init = null;
  const res = await runClaude('Reply with the single word OK.', { mcpConfig: path, timeoutMs: 60_000, onEvent: (o) => { if (o.type === 'system' && o.subtype === 'init') init = o; } });
  try { unlinkSync(path); } catch { /* ignore */ }
  if (init) {
    const srv = (init.mcp_servers || []).find((s) => s.name === name) || (init.mcp_servers || [])[0];
    const tools = (init.tools || []).filter((t) => typeof t === 'string' && t.startsWith(`mcp__${name}__`));
    if (srv) return { ok: srv.status !== 'failed', detail: `${name}: ${srv.status || 'loaded'} · ${tools.length} tool${tools.length === 1 ? '' : 's'}` };
    return { ok: false, detail: 'server did not load into the session' };
  }
  return { ok: false, detail: (res.stderr || `claude exited ${res.code}`).slice(0, 100) };
}

// Per-routine persistent memory: a memory.md index + any supporting files.
const __dirname = dirname(fileURLToPath(import.meta.url));
const MEM_ROOT = process.env.SWITCHBOARD_MEMORY || join(__dirname, '..', 'memory');
const memDirFor = (slug) => join(MEM_ROOT, String(slug).replace(/[^a-z0-9_-]/gi, '_'));
function ensureMemory(slug) {
  const dir = memDirFor(slug);
  mkdirSync(dir, { recursive: true });
  const md = join(dir, 'memory.md');
  if (!existsSync(md)) writeFileSync(md, `# Memory — ${slug}\n\nThe index of what this routine has learned across runs. Add durable facts below; link supporting files like [decisions](decisions.md).\n\n## Facts\n\n`);
  return dir;
}
const cleanFilters = (f) => {
  const o = f && typeof f === 'object' ? f : {};
  const arr = (x) => (Array.isArray(x) ? x.map((s) => String(s).trim()).filter(Boolean) : []);
  if (Array.isArray(o.groups)) {
    const FIELDS = ['action', 'check', 'branch', 'base', 'label', 'author', 'title', 'draft'];
    const OPS = ['is', 'is_not', 'contains', 'matches'];
    const groups = o.groups.map((g) => ({
      match: g && g.match === 'any' ? 'any' : 'all',
      conditions: (Array.isArray(g?.conditions) ? g.conditions : []).map((c) => ({
        field: FIELDS.includes(c?.field) ? c.field : 'action',
        op: OPS.includes(c?.op) ? c.op : 'is',
        values: arr(c?.values),
      })).filter((c) => c.values.length || c.op === 'is_not'),
    })).filter((g) => g.conditions.length);
    return { match: o.match === 'any' ? 'any' : 'all', groups };
  }
  return { actions: arr(o.actions), branches: arr(o.branches), labels: arr(o.labels), mode: o.mode === 'or' ? 'or' : 'and' };
};
const normRetries = (n) => Math.max(0, Math.min(3, parseInt(n, 10) || 0));
const cleanEnv = (e) => { const o = e && typeof e === 'object' ? e : {}; const out = {}; for (const [k, v] of Object.entries(o)) { const K = String(k).trim().replace(/[^A-Z0-9_]/gi, '_').toUpperCase(); if (K && !K.startsWith('SB_')) out[K] = String(v); } return out; };
// Output assertions: checked harness-side over the run result + trace (not self-reported).
const ASSERT_TYPES = ['contains', 'not_contains', 'matches', 'max_cost', 'max_turns', 'min_length', 'no_tool_errors'];
const cleanAssertions = (a) => (Array.isArray(a) ? a : [])
  .map((x) => ({ type: ASSERT_TYPES.includes(x?.type) ? x.type : 'contains', value: String(x?.value ?? '').trim() }))
  .filter((x) => x.type === 'no_tool_errors' || x.value);
function evalAssertions(routine, ctx) {
  let list; try { list = JSON.parse(routine.assertions || '[]'); } catch { list = []; }
  if (!Array.isArray(list) || !list.length) return null;
  const out = String(ctx.output || '');
  const lc = out.toLowerCase();
  const results = list.map((a) => {
    const v = a.value; let ok = true; let detail = '';
    switch (a.type) {
      case 'contains': ok = lc.includes(String(v).toLowerCase()); detail = ok ? `contains "${v}"` : `"${v}" not in output`; break;
      case 'not_contains': ok = !lc.includes(String(v).toLowerCase()); detail = ok ? `no "${v}"` : `"${v}" present`; break;
      case 'matches': try { ok = new RegExp(v).test(out); } catch { ok = false; } detail = ok ? `matches /${v}/` : `/${v}/ no match`; break;
      case 'max_cost': ok = (ctx.costUsd || 0) <= Number(v); detail = `$${(ctx.costUsd || 0).toFixed(4)} ${ok ? '≤' : '>'} $${v}`; break;
      case 'max_turns': ok = (ctx.numTurns || 0) <= Number(v); detail = `${ctx.numTurns || 0} ${ok ? '≤' : '>'} ${v} turns`; break;
      case 'min_length': ok = out.length >= Number(v); detail = `${out.length} ${ok ? '≥' : '<'} ${v} chars`; break;
      case 'no_tool_errors': ok = (ctx.toolErrors || 0) === 0; detail = ctx.toolErrors ? `${ctx.toolErrors} tool error(s)` : 'no tool errors'; break;
      default: ok = true;
    }
    return { type: a.type, value: v, ok, detail };
  });
  return { passed: results.every((r) => r.ok), results };
}
const cleanConcurrency = (c) => {
  const o = c && typeof c === 'object' ? c : {};
  return { scope: ['auto', 'pr', 'repo', 'routine', 'off'].includes(o.scope) ? o.scope : 'auto', onConflict: ['wait', 'drop', 'coalesce'].includes(o.onConflict) ? o.onConflict : 'wait' };
};

function relTime(ts) {
  if (!ts) return '—';
  const d = now() - ts;
  if (d < 4000) return 'now';
  if (d < 60_000) return `${Math.round(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h ago`;
  return `${Math.round(d / 86_400_000)}d ago`;
}
const fmtDur = (ms) => (ms == null ? '…' : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);
const fmtOffset = (ms) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;

// ── Concurrency leases: no two routines act on the same entity at once ──────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LEASE_TTL = 15 * 60_000; // a crashed run's lease frees itself after this
const eventSha = (e) => e?.pull_request?.head?.sha || e?.after || e?.check_suite?.head_sha || e?.workflow_run?.head_sha || e?.head_commit?.id || '';
const lightPrRef = (e, routine) => { const repo = eventRepo(e) || repoTargets(routine)[0]; const num = e?.pull_request?.number ?? e?.number; return repo && num ? { repo, pr: num } : null; };
function leaseFor(routine, event) {
  let conc; try { conc = JSON.parse(routine.concurrency || '{}'); } catch { conc = {}; }
  let scope = conc.scope || 'auto';
  const pr = lightPrRef(event, routine);
  if (scope === 'auto') scope = pr ? 'pr' : 'routine';
  const onConflict = ['drop', 'coalesce'].includes(conc.onConflict) ? conc.onConflict : 'wait';
  const sha = eventSha(event);
  // Keys are per-routine so a routine never overlaps itself on an entity, but distinct
  // routines act on the same PR independently (and coalesce hands off to its OWN agent).
  if (scope === 'off') return { key: null, onConflict, sha: '' };
  if (scope === 'pr' && pr) return { key: `${routine.slug}@pr:${pr.repo}#${pr.pr}`, onConflict, sha };
  if (scope === 'repo') { const repo = pr?.repo || repoTargets(routine)[0] || eventRepo(event); return { key: repo ? `${routine.slug}@repo:${repo}` : `routine:${routine.slug}`, onConflict, sha }; }
  return { key: `routine:${routine.slug}`, onConflict, sha };
}
// Atomic (node:sqlite is synchronous): steals an expired lease, else reports the holder.
function acquireLease(key, runId, slug, sha) {
  const cur = one('SELECT * FROM leases WHERE key=?', key);
  if (cur && cur.run_id !== runId && cur.expires_at > now()) return { ok: false, holder: cur.run_id };
  run('INSERT INTO leases (key,run_id,routine_slug,head_sha,acquired_at,expires_at) VALUES (?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET run_id=excluded.run_id, routine_slug=excluded.routine_slug, head_sha=excluded.head_sha, acquired_at=excluded.acquired_at, expires_at=excluded.expires_at',
    key, runId, slug, sha || '', now(), now() + LEASE_TTL);
  return { ok: true };
}
const releaseLease = (key, runId) => { if (key) run('DELETE FROM leases WHERE key=? AND run_id=?', key, runId); };
// SHA barrier: the PR's live head, so a run whose PR moved (e.g. while it waited on the
// lease) stands down instead of acting on an outdated diff. Best-effort — '' = skip the check.
async function livePrHeadSha(repo, pr) {
  try { const r = await gh(['pr', 'view', String(pr), '--repo', repo, '--json', 'headRefOid', '--jq', '.headRefOid']); return r.code === 0 ? r.out.trim() : ''; }
  catch { return ''; }
}

// ── Task inbox: when concurrency=coalesce, a new event that would overlap a running
//    agent is handed off as a TASK onto that agent's plate (keyed by the lease) instead
//    of spawning a second agent. The running agent drains its inbox before wrapping up. ──
const handoffSummary = (event, triggerLabel) => {
  const e = event || {};
  const pr = e.pull_request?.number ?? e.number;
  const sha = (eventSha(e) || '').slice(0, 7);
  const who = e.sender?.login || e.pull_request?.user?.login;
  const parts = [String(triggerLabel || e.event || 'event').replace(/ · .*/, '')];
  if (e.action) parts.push(e.action);
  if (pr) parts.push(`PR #${pr}`);
  if (sha) parts.push(`@${sha}`);
  if (who) parts.push(`by ${who}`);
  return parts.join(' ');
};
const addTask = (slug, key, event, originRun, triggerLabel) =>
  run('INSERT INTO run_tasks (routine_slug,lease_key,summary,payload,origin_run,created_at) VALUES (?,?,?,?,?,?)',
    slug, key, handoffSummary(event, triggerLabel), JSON.stringify(event || {}), originRun || '', now());
const pendingTasks = (slug, key) => all("SELECT * FROM run_tasks WHERE routine_slug=? AND lease_key=? AND handled_by='' ORDER BY created_at", slug, key);
const claimTasks = (ids, runId) => { if (ids.length) run(`UPDATE run_tasks SET handled_by=? WHERE id IN (${ids.map(() => '?').join(',')})`, runId, ...ids); };

// Redact obvious secrets before a trace event is ever written to disk.
// Runtime options the CLI actually accepts (verified against `claude --model/--effort`).
const MODELS = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  { id: 'claude-fable-5', label: 'Fable 5' },
];
const MODEL_IDS = MODELS.map((m) => m.id);
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const DEFAULT_MODEL = 'claude-opus-4-8';
const normModel = (m) => (MODEL_IDS.includes((m || '').trim()) ? m.trim() : DEFAULT_MODEL);
const normEffort = (e) => (EFFORTS.includes((e || '').trim()) ? e.trim() : '');

const MAX_PAYLOAD = 16_000;
const redact = (s) => String(s)
  .replace(/xox[baprs]-[A-Za-z0-9-]+/g, 'xoxb-***')
  .replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, 'gh***')
  .replace(/-----BEGIN[\s\S]*?PRIVATE KEY-----/g, '***private-key***');

const shapeRoutine = (r) => {
  const recent = all('SELECT status FROM runs WHERE routine_slug=? ORDER BY created_at DESC LIMIT 12', r.slug).map((x) => x.status).reverse();
  const finished = recent.filter((s) => s === 'succeeded' || s === 'failed');
  const successRate = finished.length ? Math.round((100 * finished.filter((s) => s === 'succeeded').length) / finished.length) : null;
  return {
    slug: r.slug, name: r.name, summary: r.summary,
    owner: r.owner, team: r.team, ownerColor: r.av_color, initials: r.initials,
    triggers: j(r.triggers), connectors: j(r.connectors), chain: j(r.chain),
    schedule: r.schedule || '', filters: jObj(r.filters) || {}, reactions: j(r.reactions),
    concurrency: jObj(r.concurrency) || {},
    model: r.model, effort: r.effort || '', memory: !!r.memory, repo: r.repo, branch: r.branch,
    state: r.enabled ? r.state : 'disabled', enabled: !!r.enabled,
    lastAgo: r.last_ago, lastStatus: r.last_status, next: r.next,
    recent, successRate, spend: r.spend, avg: r.avg, runCount: recent.length,
    inbox: one("SELECT COUNT(*) AS n FROM run_tasks WHERE routine_slug=? AND handled_by=''", r.slug).n,
    scriptMode: !!r.script_mode, scriptLang: r.script_lang || 'bash', compiled: !!(r.script && r.script.trim()), scriptStale: !!r.script_stale,
    retries: r.retries || 0, assertions: j(r.assertions), tags: j(r.tags), rateLimit: r.rate_limit || 0, maxFails: r.max_fails || 0, failStreak: r.fail_streak || 0, notes: r.notes || '', pinned: !!r.pinned, activeWindow: jObj(r.active_window) || null,
    lastSuccessAgo: (() => { const t = one("SELECT MAX(created_at) AS t FROM runs WHERE routine_slug=? AND status='succeeded'", r.slug)?.t || 0; return t ? relTime(t) : ''; })(),
    staleSuccess: (() => { const t = one("SELECT MAX(created_at) AS t FROM runs WHERE routine_slug=? AND status='succeeded'", r.slug)?.t || 0; return !!r.enabled && t > 0 && (now() - t) > 7 * 86_400_000; })(),
    alertOnFail: !!r.alert_on_fail, alertTarget: r.alert_target || '', timeout: r.timeout_s || 0, env: jObj(r.env) || {}, snoozedUntil: r.snooze_until && r.snooze_until > now() ? r.snooze_until : 0,
  };
};

function detailOf(r) {
  const repos = (r.repo || '').split(',').map((s) => s.trim()).filter(Boolean);
  const flt = jObj(r.filters) || {};
  const conns = j(r.connectors);
  return {
    breadcrumb: ['Fleet', r.slug],
    file: `${r.slug}.routine.md`,
    frontMatter: {
      on: j(r.triggers).map((t) => ({ key: `trigger · ${t}`, detail: t === 'schedule' && r.schedule ? r.schedule : '' })),
      tools: conns.map((c) => ({ sign: '+', name: c, tone: 'ok' })),
      runtime: [r.model || 'claude-opus-4-8', `${r.effort ? `· ${r.effort} effort ` : ''}· repos ${repos.join(', ') || '*'}`, `· branch ${r.branch || 'main'}`],
      filters: { actions: flt.actions || [], branches: flt.branches || [] },
    },
    // trigger → session → (tools), reflecting the real shape only.
    flowNodes: [
      { title: j(r.triggers)[0] || 'trigger', sub: 'on' },
      { title: 'session', sub: r.slug, tone: 'run' },
      ...(conns.length ? [{ title: conns.join(' + '), sub: 'tools' }] : []),
    ],
    prompt: r.prompt && r.prompt.trim() ? r.prompt : `## Prompt\n${r.summary}`,
  };
}

const AV_PALETTE = ['#d98a5c', '#c9a24a', '#6fae9a', '#7f9bd1', '#c98fb0', '#b59ad6', '#5b9ee6', '#5fbf86', '#e6b052'];
const ownerColor = (name) => { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; };
const initialsOf = (name) => { const p = name.trim().split(/\s+/).filter(Boolean); return !p.length ? '??' : (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase(); };
const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const runId = () => 'run_' + Math.random().toString(36).slice(2, 9);

function logActivity(text, state) {
  run('INSERT INTO activity (time,text,state,ord) VALUES (?,?,?,?)',
    new Date().toISOString().slice(11, 19), text, state, (one('SELECT MAX(ord) AS m FROM activity').m ?? -1) + 1);
}

// ── Deterministic script routines: the FIRST run is an agent that builds a reusable
//    extractor script; every run after just executes that script ($0, fast, identical). ─
const SCRIPT_TOOLS_DIR = join(__dirname, '..', 'tools');
function execCapture(cmd, args, { env, cwd, timeoutMs = 90_000 } = {}) {
  return new Promise((resolve) => {
    let out = '', err = '', done = false, child;
    const finish = (code) => { if (done) return; done = true; clearTimeout(t); resolve({ code, out, err }); };
    try { child = spawn(cmd, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { return resolve({ code: -1, out: '', err: e.message }); }
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* */ } err += '\n(timed out)'; finish(124); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; if (out.length > 200_000) out = out.slice(-200_000); });
    child.stderr.on('data', (d) => { err += d; if (err.length > 50_000) err = err.slice(-50_000); });
    child.on('error', (e) => { err += e.message; finish(-1); });
    child.on('close', (code) => finish(code));
  });
}
async function runCompiledScript(r, event, id, t0) {
  run("UPDATE runs SET status='running' WHERE id=?", id);
  run('UPDATE routines SET state=?, last_ago=?, last_status=? WHERE slug=?', 'running', 'now', 'running', r.slug);
  const lang = r.script_lang === 'node' ? 'node' : 'bash';
  const file = join(tmpdir(), `sb-run-${id}.${lang === 'node' ? 'mjs' : 'sh'}`);
  writeFileSync(file, r.script);
  const env = { ...process.env, ...(jObj(r.env) || {}), PATH: `${SCRIPT_TOOLS_DIR}:${process.env.PATH}`, SB_REPO: repoTargets(r)[0] || eventRepo(event) || '', SB_EVENT: JSON.stringify(event || {}), SB_RUN_ID: id };
  const res = await execCapture(lang, [file], { env, cwd: tmpdir(), timeoutMs: 90_000 });
  try { unlinkSync(file); } catch { /* */ }
  const ms = now() - t0;
  const ok = res.code === 0;
  const output = redact((res.out.trim() || res.err.trim() || `script exited ${res.code}`)).slice(0, 8000);
  run('UPDATE runs SET status=?, dur=?, dur_ms=?, output=?, cost_usd=0, num_turns=0 WHERE id=?', ok ? 'succeeded' : 'failed', fmtDur(ms), ms, output, id);
  run('INSERT INTO run_events (run_id,seq,t_offset,type,tool,ok,payload) VALUES (?,?,?,?,?,?,?)',
    id, 0, 0, 'tool_result', `${lang} extractor`, ok ? 1 : 0, JSON.stringify({ d: output.slice(0, 3000), truncated: output.length > 3000 }));
  runBus.emit(id, { kind: 'done', status: ok ? 'succeeded' : 'failed' });
  const agg = one('SELECT COALESCE(SUM(cost_usd),0) AS spend, AVG(dur_ms) AS avgms FROM runs WHERE routine_slug=?', r.slug);
  run('UPDATE routines SET state=?, last_ago=?, last_status=?, success=?, spend=?, avg=? WHERE slug=?',
    'idle', 'just now', ok ? 'success' : 'failing', ok ? 100 : 0, `$${Number(agg.spend || 0).toFixed(2)}`, agg.avgms ? fmtDur(agg.avgms) : '—', r.slug);
  logActivity(`${r.slug} ran extractor · ${ok ? (output.split('\n').pop() || '').slice(0, 50) : 'failed — recompile?'}`, ok ? 'success' : 'failing');
  if (ok) recordOutcome(r, true);
  else if (!maybeRetry(r, event, `script · ${r.slug}`, event?._attempt || 0)) { alertFailure(r, output, `script · ${r.slug}`); recordOutcome(r, false); }
  if (ok) for (const slug of j(r.chain)) { const dr = one('SELECT * FROM routines WHERE slug=? AND enabled=1', slug); if (dr) executeRoutine(dr, { ...(event ?? {}), upstream: { routine: r.slug, run: id, output } }, `after · ${r.slug}`); }
}

// Live session processes by run id — so a run can be cancelled mid-flight.
const liveChildren = new Map();
const canceledRuns = new Set(); // run ids the user canceled — finalize skips retry/alert
// Active window: restrict event/schedule triggers to allowed hours + weekdays.
function inWindow(r) {
  let w; try { w = JSON.parse(r.active_window || 'null'); } catch { w = null; }
  if (!w || (w.start == null && w.end == null && !(w.days && w.days.length))) return true;
  const d = new Date();
  if (w.days && w.days.length && !w.days.includes(d.getDay())) return false;
  if (w.start != null && w.end != null && w.start !== w.end) {
    const h = d.getHours();
    return w.start <= w.end ? (h >= w.start && h < w.end) : (h >= w.start || h < w.end);
  }
  return true;
}
const cleanWindow = (w) => {
  if (!w || typeof w !== 'object') return '';
  const start = w.start == null || w.start === '' ? null : Math.max(0, Math.min(23, parseInt(w.start, 10)));
  const end = w.end == null || w.end === '' ? null : Math.max(0, Math.min(24, parseInt(w.end, 10)));
  const days = Array.isArray(w.days) ? [...new Set(w.days.map(Number).filter((n) => n >= 0 && n <= 6))] : [];
  if (start == null && end == null && !days.length) return '';
  return JSON.stringify({ start, end, days });
};
// Circuit breaker: track consecutive failures; auto-disable a routine that won't stop failing.
function recordOutcome(r, ok) {
  if (ok) { run('UPDATE routines SET fail_streak=0 WHERE slug=?', r.slug); return; }
  const streak = (one('SELECT fail_streak FROM routines WHERE slug=?', r.slug)?.fail_streak || 0) + 1;
  run('UPDATE routines SET fail_streak=? WHERE slug=?', streak, r.slug);
  const max = r.max_fails || 0;
  if (max > 0 && streak >= max && one('SELECT enabled FROM routines WHERE slug=?', r.slug)?.enabled) {
    run('UPDATE routines SET enabled=0 WHERE slug=?', r.slug);
    logActivity(`${r.slug} auto-disabled · circuit breaker tripped (${streak} consecutive failures)`, 'failing');
    alertFailure(r, `auto-disabled after ${streak} consecutive failures — circuit breaker`, 'circuit breaker');
  }
}
// Notify Slack when a run finally fails (after retries are exhausted) — no human polling.
function alertFailure(r, output, label) {
  if (!r.alert_on_fail) return;
  const target = (r.alert_target || '').trim() || (r.owner && r.owner !== 'unassigned' ? `@${r.owner}` : '');
  if (!target) return;
  const tail = String(output || '').split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 220);
  const text = `:warning: *${r.name}* failed (${label || 'run'})\n${tail || 'no output'}`;
  execCapture('slack-post', [target, text], { env: { ...process.env, PATH: `${SCRIPT_TOOLS_DIR}:${process.env.PATH}` }, timeoutMs: 15_000 })
    .then((res) => logActivity(`${r.slug} fail-alert ${res.code === 0 ? `sent → ${target}` : `error: ${(res.err || '').slice(0, 50)}`}`, 'idle'))
    .catch(() => {});
}

// Auto-retry a failed run (transient: claude/gh/timeout) with backoff, up to r.retries.
const RETRY_DELAYS = [5_000, 20_000, 60_000];
function maybeRetry(r, rawEvent, triggerLabel, attempt) {
  const max = r.retries || 0;
  if (attempt >= max) return false;
  const next = attempt + 1;
  const delay = RETRY_DELAYS[attempt] || 60_000;
  const base = String(triggerLabel || '').replace(/^retry \d+\/\d+ · /, '');
  logActivity(`${r.slug} failed — auto-retry ${next}/${max} in ${Math.round(delay / 1000)}s`, 'queued');
  setTimeout(() => executeRoutine(r, { ...(rawEvent || {}), _attempt: next }, `retry ${next}/${max} · ${base}`), delay).unref?.();
  return true;
}

// ── Execution: build prompt → run an auto-mode session → capture trace → chain ─
function executeRoutine(r, rawEvent, triggerLabel) {
  const id = runId();
  const created = now();
  const ord = (one('SELECT MAX(ord) AS m FROM runs').m ?? -1) + 1;
  run(`INSERT INTO runs (id,routine_slug,status,ago,dur,trigger,ord,output,event,created_at,sinks_result)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id, r.slug, 'running', 'now', '…', triggerLabel, ord, '', JSON.stringify(rawEvent ?? {}), created, '[]');
  run('UPDATE routines SET state=?, last_ago=?, last_status=? WHERE slug=?', 'running', 'now', 'running', r.slug);

  // Active window: skip event/schedule-driven runs fired outside allowed hours/days.
  const manualish = ['manual', 'agent-message'].includes(rawEvent?.event) || rawEvent?._replay || rawEvent?._rerun || rawEvent?._recompile;
  if (!manualish && !inWindow(r)) {
    run("UPDATE runs SET status='skipped', dur='—', output=? WHERE id=?", 'outside active window — skipped', id);
    run("UPDATE routines SET state='idle', last_ago='just now', last_status='idle' WHERE slug=?", r.slug);
    logActivity(`${r.slug} skipped · outside active window`, 'idle');
    return id;
  }
  // Auto-pause: if a required connector is offline, skip (don't burn a session that'll fail).
  if (metaGet('skip_on_connector_down', '1') === '1') {
    const need = j(r.connectors); const down = [];
    if (need.includes('github') && _intCache.github && _intCache.github.connected === false) down.push('github');
    if (need.includes('slack') && _intCache.slack && _intCache.slack.connected === false) down.push('slack');
    if (down.length) {
      run("UPDATE runs SET status='skipped', dur='—', output=? WHERE id=?", `connector offline: ${down.join(', ')} — skipped (not failed)`, id);
      run("UPDATE routines SET state='idle', last_ago='just now', last_status='idle' WHERE slug=?", r.slug);
      logActivity(`${r.slug} skipped · ${down.join(', ')} offline`, 'idle');
      return id;
    }
  }
  // Rate limit: drop if this routine already ran rate_limit times in the past hour.
  if ((r.rate_limit || 0) > 0) {
    const n = one("SELECT COUNT(*) AS n FROM runs WHERE routine_slug=? AND created_at > ? AND status NOT IN ('skipped','coalesced','waiting')", r.slug, created - 3_600_000).n;
    if (n >= r.rate_limit) {
      run("UPDATE runs SET status='skipped', dur='—', output=? WHERE id=?", `rate limited — ${n}/${r.rate_limit} runs in the last hour`, id);
      run("UPDATE routines SET state='idle', last_ago='just now', last_status='idle' WHERE slug=?", r.slug);
      logActivity(`${r.slug} rate limited · ${n}/${r.rate_limit} this hour`, 'idle');
      return id;
    }
  }
  // Script routine that's already compiled (and not stale) → just run the extractor.
  const scriptMode = !!r.script_mode;
  const compiled = scriptMode && r.script && r.script.trim() && !r.script_stale;
  const recompile = !!rawEvent?._recompile;
  if (compiled && !recompile) {
    runCompiledScript(r, rawEvent ?? {}, id, created).catch((e) => run("UPDATE runs SET status='failed', output=? WHERE id=?", `script error: ${e.message}`, id));
    return id;
  }

  (async () => {
    // Concurrency guard: acquire the routine's lease before doing any work so two
    // routines never act on the same entity (PR / repo / routine) at once.
    const { key: leaseK, onConflict, sha } = leaseFor(r, rawEvent ?? {});
    if (leaseK) {
      let lease = acquireLease(leaseK, id, r.slug, sha);
      if (!lease.ok) {
        if (onConflict === 'coalesce') {
          // Hand off to the running agent: drop this run, add the event to its inbox.
          addTask(r.slug, leaseK, rawEvent ?? {}, id, triggerLabel);
          run("UPDATE runs SET status='coalesced', dur='—', output=? WHERE id=?", `handed off to ${lease.holder} — added to its task inbox for ${leaseK}`, id);
          run("UPDATE routines SET state='idle', last_ago='just now', last_status='idle' WHERE slug=?", r.slug);
          logActivity(`${r.slug} coalesced → ${lease.holder} · ${leaseK} (handoff)`, 'idle');
          return;
        }
        if (onConflict === 'drop') {
          run("UPDATE runs SET status='skipped', dur=?, output=? WHERE id=?", '—', `stood down — ${leaseK} is held by ${lease.holder}`, id);
          run("UPDATE routines SET state='idle', last_ago='just now', last_status='idle' WHERE slug=?", r.slug);
          logActivity(`${r.slug} stood down · ${leaseK} held by ${lease.holder}`, 'idle');
          return;
        }
        run("UPDATE runs SET status='waiting', dur=? WHERE id=?", `waiting · ${leaseK}`, id);
        logActivity(`${r.slug} waiting · ${leaseK} held by ${lease.holder}`, 'queued');
        const deadline = now() + LEASE_TTL;
        while (now() < deadline) { await sleep(3000); lease = acquireLease(leaseK, id, r.slug, sha); if (lease.ok) break; }
        if (!lease.ok) {
          run("UPDATE runs SET status='failed', dur='—', output=? WHERE id=?", `gave up waiting for ${leaseK}`, id);
          run("UPDATE routines SET state='idle', last_status='failing' WHERE slug=?", r.slug);
          return;
        }
      }
      // SHA barrier: once we hold the lease, if the PR's head moved past the SHA this
      // event was for (someone pushed, e.g. while we waited), stand down as stale.
      const prm = sha && leaseK.startsWith('pr:') && leaseK.slice(3).match(/^(.+)#(\d+)$/);
      if (prm) {
        const live = await livePrHeadSha(prm[1], prm[2]);
        if (live && live !== sha) {
          releaseLease(leaseK, id);
          run("UPDATE runs SET status='skipped', dur='—', output=? WHERE id=?", `stood down — ${prm[1]}#${prm[2]} head moved to ${live.slice(0, 7)} (this run was for ${sha.slice(0, 7)})`, id);
          run("UPDATE routines SET state='idle', last_ago='just now', last_status='idle' WHERE slug=?", r.slug);
          logActivity(`${r.slug} stood down · ${leaseK} head ${sha.slice(0, 7)}→${live.slice(0, 7)} (stale)`, 'idle');
          return;
        }
      }
      run("UPDATE runs SET status='running' WHERE id=?", id);
    }

    try {
    // The session is autonomous: it gets the natural instruction + the raw event +
    // its granted tools, and does the work itself (gh, slack-post, web…) — the harness
    // only routes, captures the trace, and enforces guardrails.
    const tools = j(r.connectors);
    const memoryDir = r.memory ? ensureMemory(r.slug) : null;
    const mcpGranted = tools.filter((c) => !['github', 'slack', 'web', 'webfetch', 'team'].includes(c));
    const mcpConfig = mcpGranted.length ? writeMcpConfig(mcpGranted) : null;
    const agents = tools.includes('team') ? all('SELECT name, role, summary FROM agents ORDER BY name') : [];
    const coalesce = onConflict === 'coalesce' && !!leaseK;
    const seedTasks = Array.isArray(rawEvent?.tasks) ? rawEvent.tasks : [];
    // Compile mode: this agent run must BUILD a reusable extractor and write it to scriptPath.
    const compile = scriptMode;
    const scriptLang = r.script_lang === 'node' ? 'node' : 'bash';
    const scriptPath = compile ? join(tmpdir(), `sb-build-${id}.${scriptLang === 'node' ? 'mjs' : 'sh'}`) : null;
    const priorScript = compile ? (r.script || '') : ''; // current extractor to revise (if any)
    const prompt = buildPrompt({ ...r, connectors: tools }, rawEvent ?? {}, policyConstraints(), { memoryDir, agents, coalesce, seedTasks, compile, scriptLang, scriptPath, priorScript, env: jObj(r.env) || {} });
    run('UPDATE runs SET prompt=? WHERE id=?', prompt, id);

    // Step-level trace: normalize each stream-json event into a run_events row,
    // persisted as the session runs so the UI fills in near-live via polling.
    let seq = 0;
    const t0 = now();
    const toolById = new Map();
    const putEvt = (type, tool, ok, payload) => {
      let p = redact(typeof payload === 'string' ? payload : JSON.stringify(payload));
      const truncated = p.length > MAX_PAYLOAD;
      if (truncated) p = p.slice(0, MAX_PAYLOAD);
      const s = seq++;
      run('INSERT INTO run_events (run_id,seq,t_offset,type,tool,ok,payload) VALUES (?,?,?,?,?,?,?)',
        id, s, now() - t0, type, tool ?? null, ok == null ? null : (ok ? 1 : 0), JSON.stringify({ d: p, truncated }));
      runBus.emit(id, { kind: 'event', event: { seq: s, t: fmtOffset(now() - t0), ms: now() - t0, type, tool: tool ?? null, ok: ok == null ? null : (ok ? 1 : 0), text: p, truncated } });
    };
    const onEvent = (o) => {
      try {
        if (o.type === 'system' && o.subtype === 'init') {
          putEvt('system', null, null, { model: o.model, tools: o.tools, cwd: o.cwd, permissionMode: o.permissionMode });
        } else if (o.type === 'assistant') {
          for (const b of o.message?.content ?? []) {
            if (b.type === 'text' && b.text?.trim()) putEvt('text', null, null, b.text);
            else if (b.type === 'tool_use') { toolById.set(b.id, b.name); putEvt('tool_use', b.name, null, b.input ?? {}); }
          }
        } else if (o.type === 'user') {
          for (const b of o.message?.content ?? []) {
            if (b.type === 'tool_result') {
              const tool = toolById.get(b.tool_use_id) ?? null;
              const content = Array.isArray(b.content) ? b.content.map((c) => c.text ?? '').join('') : b.content;
              putEvt('tool_result', tool, !b.is_error, content ?? '');
            }
          }
        } else if (o.type === 'result') {
          putEvt('result', null, !o.is_error, { subtype: o.subtype, is_error: o.is_error, num_turns: o.num_turns, total_cost_usd: o.total_cost_usd, duration_ms: o.duration_ms });
        }
      } catch { /* one malformed event must not kill the run */ }
    };

    const res = await runClaude(prompt, { tools, onEvent, onChild: (c) => liveChildren.set(id, c), model: normModel(r.model), effort: normEffort(r.effort), memoryDir, mcpConfig, runId: id, coalesce, scriptPath, compile, timeoutMs: (r.timeout_s || 0) > 0 ? r.timeout_s * 1000 : undefined, extraEnv: jObj(r.env) || {} });
    liveChildren.delete(id);
    if (mcpConfig) try { unlinkSync(mcpConfig); } catch { /* ignore */ }
    // Compile: capture the extractor the agent just wrote so future runs are deterministic.
    if (compile && scriptPath) {
      let built = ''; try { built = readFileSync(scriptPath, 'utf8'); } catch { /* not written */ }
      try { unlinkSync(scriptPath); } catch { /* */ }
      if (built.trim()) { run("UPDATE routines SET script=?, script_stale=0 WHERE slug=?", built, r.slug); logActivity(`${r.slug} ${priorScript ? 'revised' : 'compiled'} its ${scriptLang} extractor (${built.length} chars) — future runs are deterministic`, 'success'); }
      else logActivity(`${r.slug} compile run produced no script — keeping the previous one`, 'idle');
    }
    const canceled = canceledRuns.delete(id);
    const ok = !canceled && !res.isError && !!res.finalText;
    const rawOut = canceled ? 'canceled by user'
      : ok ? res.finalText
      : (res.finalText || (res.code === 124 ? `timed out after ${Math.round(res.ms / 1000)}s` : res.stderr || `claude exited ${res.code}`));
    const output = redact(rawOut); // never persist/log unredacted session output

    const inTok = res.usage ? (res.usage.input_tokens || 0) + (res.usage.cache_read_input_tokens || 0) + (res.usage.cache_creation_input_tokens || 0) : null;
    const outTok = res.usage ? (res.usage.output_tokens || 0) : null;
    run('UPDATE runs SET status=?, dur=?, dur_ms=?, output=?, cost_usd=?, num_turns=?, session_id=?, in_tokens=?, out_tokens=? WHERE id=?',
      ok ? 'succeeded' : 'failed', fmtDur(res.ms), res.ms, output, res.costUsd, res.numTurns, res.sessionId, inTok, outTok, id);
    runBus.emit(id, { kind: 'done', status: ok ? 'succeeded' : 'failed' });
    // Roll up real spend + avg duration onto the routine.
    const agg = one('SELECT COALESCE(SUM(cost_usd),0) AS spend, AVG(dur_ms) AS avgms FROM runs WHERE routine_slug=?', r.slug);
    run('UPDATE routines SET state=?, last_ago=?, last_status=?, success=?, spend=?, avg=? WHERE slug=?',
      'idle', 'just now', ok ? 'success' : 'failing', ok ? 100 : 0,
      `$${Number(agg.spend || 0).toFixed(2)}`, agg.avgms ? fmtDur(agg.avgms) : '—', r.slug);
    logActivity(`${r.slug} ${ok ? 'ran · ' + output.split('\n').pop().slice(0, 60) : 'failed'} · ${triggerLabel}`, ok ? 'success' : 'failing');
    if (ok) recordOutcome(r, true);
    else if (!canceled && !maybeRetry(r, rawEvent, triggerLabel, rawEvent?._attempt || 0)) { alertFailure(r, output, triggerLabel); recordOutcome(r, false); }

    // Output assertions: checked over the result + trace, gate the downstream if they fail.
    const toolErrors = one("SELECT COUNT(*) AS n FROM run_events WHERE run_id=? AND type='tool_result' AND ok=0", id).n;
    const assertResult = ok ? evalAssertions(r, { output, costUsd: res.costUsd, numTurns: res.numTurns, toolErrors }) : null;
    if (assertResult) {
      run('UPDATE runs SET assert_result=? WHERE id=?', JSON.stringify(assertResult), id);
      if (!assertResult.passed) logActivity(`${r.slug} assertions FAILED (${assertResult.results.filter((x) => !x.ok).length}/${assertResult.results.length}) — chain & reactions gated`, 'failing');
    }
    const gatePass = !assertResult || assertResult.passed;

    // reactions: arm watches on the entity this run touched (PR checks/review/merge, timeout…)
    if (gatePass) try { await armReactions(r, rawEvent ?? {}, id); } catch (e) { logActivity(`reactions error · ${r.slug}: ${e.message}`, 'failing'); }

    // chain: kick off downstream routines, guarding against cycles + runaway depth.
    if (ok && gatePass) {
      const path = Array.isArray(rawEvent?._chainPath) ? rawEvent._chainPath : [];
      const nextPath = [...path, r.slug];
      if (nextPath.length > 8) {
        logActivity(`chain stopped · max depth (8) reached at ${r.slug}`, 'idle');
      } else {
        for (const slug of j(r.chain)) {
          if (nextPath.includes(slug)) { logActivity(`chain stopped · cycle back to ${slug}`, 'idle'); continue; }
          const dr = one('SELECT * FROM routines WHERE slug=? AND enabled=1', slug);
          if (dr) executeRoutine(dr, { ...(rawEvent ?? {}), _chainPath: nextPath, upstream: { routine: r.slug, run: id, output } }, `after · ${r.slug}`);
        }
      }
    }
    } finally {
      if (leaseK) {
        releaseLease(leaseK, id);
        // Drain: tasks that landed but the agent never fetched → spawn a fresh run to
        // handle them (and bound the loop by claiming them for that run up front).
        const pend = pendingTasks(r.slug, leaseK);
        if (pend.length) {
          const last = jObj(pend[pend.length - 1].payload) || {};
          const drainEv = { ...last, event: 'inbox-drain', tasks: pend.map((t) => t.summary), _chainPath: rawEvent?._chainPath };
          const drainId = executeRoutine(r, drainEv, `inbox · ${pend.length} task${pend.length > 1 ? 's' : ''}`);
          claimTasks(pend.map((t) => t.id), drainId);
          logActivity(`${r.slug} draining ${pend.length} inbox task${pend.length > 1 ? 's' : ''} → ${drainId}`, 'queued');
        }
      }
    }
  })().catch((e) => {
    run('UPDATE runs SET status=?, output=? WHERE id=?', 'failed', `harness error: ${e.message}`, id);
  });

  return id;
}

const eventRepo = (e) => (typeof e?.repository === 'object' ? e.repository?.full_name : e?.repository) || null;
// A routine targets repos via its `repo` field (comma-separated owner/repo).
// Empty = any repo. If the event carries a repo, it must be in the target set.
const repoTargets = (r) => String(r.repo || '').split(',').map((s) => s.trim()).filter(Boolean);
function repoMatches(r, event) {
  const targets = repoTargets(r);
  if (!targets.length) return true;
  const er = eventRepo(event);
  return !er || targets.includes(er);
}

// Optional event sub-filters (opt-in): only enforce when configured.
const branchOf = (e) => (e?.ref ? String(e.ref).replace('refs/heads/', '') : null) || e?.pull_request?.head?.ref || e?.branch || null;
const eventStates = (e) => [
  e?.action, e?.conclusion, e?.state,
  e?.check_run?.conclusion, e?.check_suite?.conclusion, e?.workflow_run?.conclusion,
  e?.deployment_status?.state, e?.review?.state,
].filter(Boolean);
// Label names on an event: the just-added/removed one (e.label.name) + all current labels.
const labelsOf = (e) => [...new Set([
  e?.label?.name,
  ...((e?.pull_request?.labels || e?.issue?.labels || e?.labels || []).map((l) => (typeof l === 'string' ? l : l?.name))),
].filter(Boolean))];
// A "labeled"/"unlabeled" pull_request/issues delivery also satisfies the `label` trigger.
const LABEL_TYPES = new Set(['pull_request', 'pull_request_target', 'issues']);
const isLabelEvent = (type, e) => LABEL_TYPES.has(type) && (e?.action === 'labeled' || e?.action === 'unlabeled');
// A condition's field → the event's value(s) for it (always an array).
const FILTER_FIELDS = {
  action: (e) => eventStates(e),
  check: (e) => [e?.check_run?.name, e?.check_suite?.app?.slug, e?.workflow_run?.name, e?.workflow_job?.name, e?.context, e?.deployment?.task].filter(Boolean),
  branch: (e) => [branchOf(e)].filter(Boolean),
  base: (e) => [e?.pull_request?.base?.ref].filter(Boolean),
  label: (e) => labelsOf(e),
  author: (e) => [e?.pull_request?.user?.login || e?.issue?.user?.login || e?.sender?.login].filter(Boolean),
  title: (e) => [e?.pull_request?.title || e?.issue?.title].filter(Boolean),
  draft: (e) => (e?.pull_request ? [String(!!e.pull_request.draft)] : []),
};
function evalCondition(c, e) {
  const vals = (FILTER_FIELDS[c.field]?.(e) || []).map(String);
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
function filtersMatch(r, event) {
  let f; try { f = JSON.parse(r.filters || '{}'); } catch { f = {}; }
  // New shape: groups of conditions, combined AND/OR at two levels.
  if (Array.isArray(f.groups)) {
    if (!f.groups.length) return true;
    const groupOk = (g) => {
      const conds = Array.isArray(g.conditions) ? g.conditions : [];
      if (!conds.length) return true;
      const res = conds.map((c) => evalCondition(c, event));
      return g.match === 'any' ? res.some(Boolean) : res.every(Boolean);
    };
    const gr = f.groups.map(groupOk);
    return f.match === 'any' ? gr.some(Boolean) : gr.every(Boolean);
  }
  // Legacy shape: { actions, branches, labels, mode }.
  const actions = Array.isArray(f.actions) ? f.actions : [];
  const branches = Array.isArray(f.branches) ? f.branches : [];
  const labels = Array.isArray(f.labels) ? f.labels : [];
  const mode = f.mode === 'or' ? 'or' : 'and';
  const checks = [];
  if (actions.length) { const vals = eventStates(event); checks.push(!vals.length || vals.some((v) => actions.includes(v))); }
  if (branches.length) { const br = branchOf(event); checks.push(!br || branches.includes(br)); }
  if (labels.length) { const labs = labelsOf(event); checks.push(!labs.length || labs.some((l) => labels.includes(l))); }
  if (!checks.length) return true;
  return mode === 'or' ? checks.some(Boolean) : checks.every(Boolean);
}

// Explain why a run matched (or would match): trigger + repo + each filter condition.
function explainMatch(r, event) {
  const checks = [];
  const type = event?.event || event?.type || 'manual';
  const triggers = j(r.triggers);
  checks.push({ label: `trigger is "${type}"`, ok: triggers.includes(type), detail: `listens for [${triggers.join(', ') || 'none'}]` });
  const targets = repoTargets(r);
  if (targets.length) checks.push({ label: 'repository in target', ok: repoMatches(r, event), detail: `target [${targets.join(', ')}]` });
  let f; try { f = JSON.parse(r.filters || '{}'); } catch { f = {}; }
  if (Array.isArray(f.groups)) {
    for (const g of f.groups) for (const c of (g.conditions || [])) {
      const vals = (FILTER_FIELDS[c.field]?.(event) || []).map(String);
      checks.push({ label: `${c.field} ${c.op} [${(c.values || []).join(', ')}]`, ok: evalCondition(c, event), detail: `event ${c.field}: [${vals.join(', ') || '—'}]` });
    }
  }
  return { fired: triggers.includes(type) && repoMatches(r, event) && filtersMatch(r, event), checks };
}

function dispatchEvent(type, payload) {
  if (meta('kill_switch', 'false') === 'true') {
    logActivity(`event ${type} dropped · kill switch engaged`, 'failing');
    return { error: 'kill switch engaged' };
  }
  if (overBudget()) {
    logActivity(`event ${type} dropped · daily budget $${budgetCap()} reached ($${todaySpend().toFixed(2)} spent)`, 'failing');
    return { error: `daily budget $${budgetCap()} reached — dispatch paused` };
  }
  const event = payload && Object.keys(payload).length ? payload : { event: type };
  const labelEvt = isLabelEvent(type, event);
  const candidates = all('SELECT * FROM routines WHERE enabled=1')
    .filter((r) => { if (r.snooze_until > now()) return false; const t = j(r.triggers); return t.includes(type) || (labelEvt && t.includes('label')); });
  const matched = candidates.filter((r) => repoMatches(r, event) && filtersMatch(r, event));
  // Audit: record why subscribed routines stood down (the "logs of if/how" devs want).
  candidates.filter((r) => !matched.includes(r)).forEach((r) => {
    const why = !repoMatches(r, event) ? `repo not in target [${repoTargets(r).join(', ')}]` : 'event filter mismatch';
    logActivity(`${r.slug} skipped · ${type} — ${why}`, 'idle');
  });
  const runs = matched.map((r) => ({ slug: r.slug, runId: executeRoutine(r, event, `${type} · ${event.ref || eventRepo(event) || 'event'}`) }));
  return { matched: matched.map((r) => r.slug), runs, event };
}

// ── Scheduler: makes the `schedule` trigger real (dependency-free 5-field cron) ──
function cronFieldMatch(field, val, min, max) {
  if (field === '*' || field === '?') return true;
  for (const part of String(field).split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? parseInt(stepPart, 10) || 1 : 1;
    let lo, hi;
    if (rangePart === '*') { lo = min; hi = max; }
    else if (rangePart.includes('-')) { const [a, b] = rangePart.split('-').map(Number); lo = a; hi = b; }
    else { lo = hi = Number(rangePart); }
    if (Number.isNaN(lo) || Number.isNaN(hi)) continue;
    for (let v = lo; v <= hi; v += step) if (v === val) return true;
  }
  return false;
}
export function cronMatches(expr, d) {
  const p = String(expr).trim().split(/\s+/);
  if (p.length !== 5) return false;
  return cronFieldMatch(p[0], d.getMinutes(), 0, 59)
    && cronFieldMatch(p[1], d.getHours(), 0, 23)
    && cronFieldMatch(p[2], d.getDate(), 1, 31)
    && cronFieldMatch(p[3], d.getMonth() + 1, 1, 12)
    && cronFieldMatch(p[4], d.getDay(), 0, 6);
}
const _lastFired = new Map();
function tickScheduler() {
  // Daily digest: fire once when the local hour matches digest_hour and it hasn't run today.
  const dh = parseInt(metaGet('digest_hour', '-1'), 10);
  if (dh >= 0 && metaGet('digest_channel', '').trim()) {
    const nd = new Date(); const today = nd.toISOString().slice(0, 10);
    if (nd.getHours() === dh && metaGet('last_digest', '') !== today) { setMeta('last_digest', today); sendDigest(); }
  }
  if (meta('kill_switch', 'false') === 'true' || overBudget()) return;
  const d = new Date();
  const stamp = `${d.getFullYear()}/${d.getMonth()}/${d.getDate()} ${d.getHours()}:${d.getMinutes()}`;
  for (const r of all('SELECT * FROM routines WHERE enabled=1')) {
    if (!j(r.triggers).includes('schedule') || !r.schedule) continue;
    if (r.snooze_until > now()) continue;
    if (!cronMatches(r.schedule, d)) continue;
    if (_lastFired.get(r.slug) === stamp) continue; // fire at most once per matching minute
    _lastFired.set(r.slug, stamp);
    executeRoutine(r, { event: 'schedule', cron: r.schedule, fired_at: d.toISOString() }, `schedule · ${r.schedule}`);
  }
}
if (process.env.SWITCHBOARD_NO_SCHEDULER !== '1') setInterval(tickScheduler, 30_000).unref?.();

// Watchdog: reap runs stuck in running/waiting (server crash mid-run, hung session) so
// the run list stays honest and routine state / leases don't wedge. Runs on boot + 5-min.
function reapStaleRuns() {
  const cutoff = now() - 20 * 60_000; // > the 4-min session timeout + 15-min lease TTL
  const stale = all("SELECT id, routine_slug FROM runs WHERE status IN ('running','waiting') AND created_at < ?", cutoff);
  for (const s of stale) {
    run("UPDATE runs SET status='failed', output=?, dur='—' WHERE id=?", 'reaped — no result within 20m (server restart or stuck session)', s.id);
    run('DELETE FROM leases WHERE run_id=?', s.id);
    run("UPDATE routines SET state='idle', last_status='failing' WHERE slug=? AND state='running'", s.routine_slug);
    logActivity(`${s.routine_slug} run ${s.id} reaped · stuck > 20m`, 'failing');
  }
  if (stale.length) logActivity(`watchdog reaped ${stale.length} stuck run${stale.length > 1 ? 's' : ''}`, 'idle');
  return stale.length;
}
reapStaleRuns();
if (process.env.SWITCHBOARD_NO_SCHEDULER !== '1') setInterval(reapStaleRuns, 5 * 60_000).unref?.();

// Background-refreshed connector health (so the sync dispatch path can auto-pause cheaply).
let _intCache = { github: { connected: true }, slack: { connected: true } };
async function refreshIntCache() { try { _intCache = await integrationStatus(); } catch { /* keep last */ } }
refreshIntCache();
setInterval(refreshIntCache, 30_000).unref?.();

// ── Reactions: watch a routine's downstream entity, fire a follow-up routine ────
const wid = () => 'w_' + Math.random().toString(36).slice(2, 9);
const cleanReactions = (arr) => (Array.isArray(arr) ? arr : [])
  .map((x) => ({ source: String(x.source || '').trim(), kind: String(x.kind || '').trim(), when: String(x.when || '').trim(), check: String(x.check || '').trim(), run: String(x.run || '').trim() }))
  .filter((x) => x.source && x.kind && x.run);
function durationToMs(s) {
  const m = String(s).trim().match(/^(\d+)\s*(s|sec|m|min|h|hr|d)?$/i);
  if (!m) return null;
  const n = +m[1], u = (m[2] || 'm').toLowerCase();
  return n * (u.startsWith('s') ? 1000 : u.startsWith('h') ? 3_600_000 : u.startsWith('d') ? 86_400_000 : 60_000);
}
async function resolvePrRef(event, routine) {
  const repo = eventRepo(event) || repoTargets(routine)[0];
  if (!repo) return null;
  let num = event?.pull_request?.number ?? event?.number ?? null;
  if (!num) {
    const branch = branchOf(event);
    if (branch) {
      const r = await gh(['pr', 'list', '--repo', repo, '--head', branch, '--state', 'all', '--json', 'number', '--jq', '.[0].number']);
      if (r.code === 0 && r.out.trim()) num = +r.out.trim();
    }
  }
  return num ? { repo, pr: Number(num) } : null;
}
// Arm one watch per declared reaction once the originating run resolves its entity.
async function armReactions(routine, event, runId) {
  const reactions = j(routine.reactions);
  let prRef = null;
  for (const rx of cleanReactions(reactions)) {
    if (!one('SELECT 1 FROM routines WHERE slug=? AND enabled=1', rx.run)) { logActivity(`reaction skipped · target ${rx.run} missing/disabled`, 'idle'); continue; }
    let entity = {}, fireAt = 0;
    if (rx.source === 'timeout') {
      const ms = durationToMs(rx.when);
      if (!ms) { logActivity(`reaction skipped · invalid duration "${rx.when}"`, 'idle'); continue; }
      entity = { duration_ms: ms }; fireAt = now() + ms;
    } else if (rx.source === 'github') {
      if (!prRef) prRef = await resolvePrRef(event, routine);
      if (!prRef) { logActivity(`reaction skipped · no PR resolved for ${routine.slug} → ${rx.run}`, 'idle'); continue; }
      entity = { ...prRef, check: rx.check || '' }; // optional specific check to watch
    } else { logActivity(`reaction skipped · source "${rx.source}" not yet supported`, 'idle'); continue; }
    run('INSERT INTO watches (id,origin_run,origin_routine,target_slug,source,kind,when_cond,entity,status,detail,attempts,created_at,fire_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      wid(), runId, routine.slug, rx.run, rx.source, rx.kind, rx.when, JSON.stringify(entity), 'open', '', 0, now(), fireAt);
    logActivity(`watching ${rx.source}:${rx.kind}${rx.when ? ':' + rx.when : ''} on ${entity.repo ? `${entity.repo}#${entity.pr}` : rx.when} → ${rx.run}`, 'queued');
  }
}
// Source adapter: poll the entity, decide fire | keep | drop.
async function pollWatch(w) {
  const entity = jObj(w.entity) || {};
  if (w.source === 'timeout') {
    return now() >= w.fire_at ? { action: 'fire', context: { event: 'reaction', source: 'timeout', kind: 'after', when: w.when_cond }, detail: `after ${w.when_cond}` } : { action: 'keep' };
  }
  if (w.source === 'github') {
    const view = async (fields) => { const r = await gh(['pr', 'view', String(entity.pr), '--repo', entity.repo, '--json', fields]); if (r.code !== 0) return { err: r.err }; try { return { pr: JSON.parse(r.out) }; } catch { return { err: 'parse' }; } };
    if (w.kind === 'checks') {
      const { pr, err } = await view('statusCheckRollup,state,title,url');
      if (err) return { action: /no pull requests|not found/i.test(err) ? 'drop' : 'keep', detail: err.slice(0, 60) };
      const checkName = entity.check || '';
      let rollup = pr.statusCheckRollup || [];
      const label = checkName ? `"${checkName}"` : 'checks';
      if (checkName) {
        rollup = rollup.filter((c) => (c.name || c.context) === checkName);
        if (!rollup.length) return { action: 'keep', detail: `waiting for ${label}` };
      }
      if (!rollup.length) return { action: 'keep', detail: 'no checks yet' };
      const pending = rollup.some((c) => (c.status && c.status !== 'COMPLETED') || ['PENDING', 'IN_PROGRESS', 'QUEUED', 'EXPECTED'].includes(c.state));
      if (pending) return { action: 'keep', detail: `${label} running` };
      const failed = rollup.some((c) => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(c.conclusion) || ['FAILURE', 'ERROR'].includes(c.state));
      const conclusion = failed ? 'failure' : 'success';
      if (w.when_cond === 'any' || w.when_cond === conclusion) {
        return { action: 'fire', detail: `${label} ${conclusion}`, context: { event: 'reaction', source: 'github', kind: 'checks', when: conclusion, check: checkName || null, pull_request: { number: entity.pr, title: pr.title, url: pr.url }, checks: rollup.map((c) => ({ name: c.name || c.context, conclusion: c.conclusion || c.state })) } };
      }
      return { action: 'drop', detail: `${label} ${conclusion} ≠ ${w.when_cond}` };
    }
    if (w.kind === 'merge') {
      const { pr, err } = await view('state,title,url');
      if (err) return { action: 'keep', detail: err.slice(0, 60) };
      if (pr.state === 'MERGED') return { action: 'fire', detail: 'merged', context: { event: 'reaction', source: 'github', kind: 'merge', when: 'merged', pull_request: { number: entity.pr, title: pr.title, url: pr.url } } };
      if (pr.state === 'CLOSED') return { action: 'drop', detail: 'closed without merge' };
      return { action: 'keep' };
    }
    if (w.kind === 'review') {
      const { pr, err } = await view('reviews,title,url');
      if (err) return { action: 'keep', detail: err.slice(0, 60) };
      const last = (pr.reviews || []).filter((x) => ['APPROVED', 'CHANGES_REQUESTED'].includes(x.state)).slice(-1)[0];
      if (!last) return { action: 'keep', detail: 'no decisive review yet' };
      const state = last.state === 'APPROVED' ? 'approved' : 'changes_requested';
      if (w.when_cond === 'any' || w.when_cond === state) return { action: 'fire', detail: `review ${state}`, context: { event: 'reaction', source: 'github', kind: 'review', when: state, pull_request: { number: entity.pr, title: pr.title, url: pr.url } } };
      return { action: 'keep', detail: `last review ${state}` };
    }
  }
  return { action: 'keep' };
}
const WATCH_MAX_ATTEMPTS = 60; // ~45 min at the 45s cadence (timeout watches are exempt)
async function tickWatches() {
  if (meta('kill_switch', 'false') === 'true') return;
  for (const w of all("SELECT * FROM watches WHERE status='open' ORDER BY created_at LIMIT 50")) {
    let res; try { res = await pollWatch(w); } catch (e) { res = { action: 'keep', detail: String(e.message).slice(0, 60) }; }
    const attempts = w.attempts + 1;
    if (res.action === 'fire') {
      run("UPDATE watches SET status='fired', detail=?, attempts=? WHERE id=?", res.detail || '', attempts, w.id);
      const tr = one('SELECT * FROM routines WHERE slug=? AND enabled=1', w.target_slug);
      if (tr) {
        executeRoutine(tr, { ...(res.context || {}), upstream: { routine: w.origin_routine, run: w.origin_run }, _chainPath: [w.origin_routine] }, `reaction · ${w.source}:${w.kind}${w.when_cond ? ':' + w.when_cond : ''}`);
        logActivity(`reaction fired · ${w.source}:${w.kind} ${res.detail || ''} → ${w.target_slug}`, 'success');
      }
    } else if (res.action === 'drop') {
      run("UPDATE watches SET status='dropped', detail=?, attempts=? WHERE id=?", res.detail || '', attempts, w.id);
      logActivity(`reaction dropped · ${w.source}:${w.kind} — ${res.detail || ''}`, 'idle');
    } else if (attempts >= WATCH_MAX_ATTEMPTS && w.source !== 'timeout') {
      run("UPDATE watches SET status='expired', detail=?, attempts=? WHERE id=?", 'gave up waiting', attempts, w.id);
      logActivity(`reaction expired · ${w.source}:${w.kind} → ${w.target_slug}`, 'idle');
    } else {
      run('UPDATE watches SET attempts=?, detail=? WHERE id=?', attempts, res.detail || '', w.id);
    }
  }
}
if (process.env.SWITCHBOARD_NO_SCHEDULER !== '1') setInterval(tickWatches, 45_000).unref?.();

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/api/health', (_q, res) => res.json({ ok: true }));
app.get('/api/models', (_q, res) => res.json({ models: MODELS, efforts: EFFORTS, defaultModel: DEFAULT_MODEL }));
// Live concurrency leases — who's holding what, on which entity/SHA.
// Manually release a stuck lease.
app.delete('/api/leases', (req, res) => {
  const key = String(req.query.key || '');
  if (!key) return res.status(400).json({ error: 'key required' });
  run('DELETE FROM leases WHERE key=?', key);
  logActivity(`lease ${key} released manually`, 'idle');
  res.json({ ok: true });
});
// Live concurrency: leases currently held + inbox tasks waiting to be picked up.
app.get('/api/leases', (_q, res) => {
  const leases = all('SELECT * FROM leases WHERE expires_at > ? ORDER BY acquired_at DESC', now())
    .map((l) => ({ key: l.key, runId: l.run_id, slug: l.routine_slug, sha: l.head_sha ? l.head_sha.slice(0, 7) : '', held: relTime(l.acquired_at), ttl: fmtDur(Math.max(0, l.expires_at - now())) }));
  const pending = all("SELECT * FROM run_tasks WHERE handled_by='' ORDER BY created_at DESC LIMIT 40")
    .map((t) => ({ slug: t.routine_slug, key: t.lease_key, summary: t.summary, ago: relTime(t.created_at) }));
  res.json({ leases, pending });
});

// The user's real GitHub repos — so the UI can see & target repositories.
// ?owner=<org|*> & ?q=<search> for cross-org browse / GitHub-wide search.
app.get('/api/github/repos', async (req, res) => res.json({ repos: await listRepos({ owner: String(req.query.owner || ''), q: String(req.query.q || '') }) }));
app.get('/api/github/orgs', async (_q, res) => res.json({ orgs: await listOrgs() }));
// Possible check names for a repo — so a reaction can target a specific check.
app.get('/api/github/checks', async (req, res) => res.json({ checks: await listChecks(String(req.query.repo || '')) }));
// A repo's labels — so the label filter is a pick-list, not free typing.
app.get('/api/github/labels', async (req, res) => {
  const repo = String(req.query.repo || '').trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return res.json({ labels: [] });
  const r = await gh(['api', `repos/${repo}/labels`, '--paginate', '--jq', '.[].name']);
  res.json({ labels: r.code === 0 ? r.out.split('\n').map((s) => s.trim()).filter(Boolean) : [] });
});

// Daily digest: a self-posting Slack rollup of the day's runs/spend/failures.
function buildDigest() {
  const since = (() => { const s = new Date(now()); s.setHours(0, 0, 0, 0); return s.getTime(); })();
  const t = one('SELECT COUNT(*) AS runs, COALESCE(SUM(cost_usd),0) AS cost, SUM(CASE WHEN status=\'failed\' THEN 1 ELSE 0 END) AS fails FROM runs WHERE created_at > ?', since);
  const top = all("SELECT routine_slug, COUNT(*) AS n, COALESCE(SUM(cost_usd),0) AS c FROM runs WHERE created_at > ? GROUP BY routine_slug ORDER BY c DESC LIMIT 3", since);
  const topStr = top.map((x) => `${x.routine_slug} (${x.n}, $${x.c.toFixed(2)})`).join(', ') || 'none';
  return `:bar_chart: *Switchboard daily digest* — ${t.runs} runs, $${t.cost.toFixed(2)} spent, ${t.fails || 0} failed today.\nBusiest: ${topStr}.`;
}
function sendDigest() {
  const target = metaGet('digest_channel', '').trim();
  if (!target) return false;
  execCapture('slack-post', [target, buildDigest()], { env: { ...process.env, PATH: `${SCRIPT_TOOLS_DIR}:${process.env.PATH}` }, timeoutMs: 15_000 })
    .then((res) => logActivity(`daily digest ${res.code === 0 ? `sent → ${target}` : `error: ${(res.err || '').slice(0, 50)}`}`, 'idle')).catch(() => {});
  return true;
}
app.post('/api/digest', (req, res) => {
  const b = req.body || {};
  if (b.channel != null) setMeta('digest_channel', String(b.channel).trim());
  if (b.hour != null) setMeta('digest_hour', String(Math.max(-1, Math.min(23, parseInt(b.hour, 10)))));
  res.json({ channel: metaGet('digest_channel', ''), hour: parseInt(metaGet('digest_hour', '-1'), 10) });
});
app.post('/api/digest/send', (_q, res) => res.json({ sent: sendDigest(), preview: buildDigest() }));
// Auto-generated ops report (markdown) — spend, top routines, failures, warnings.
app.get('/api/report.md', (req, res) => {
  const days = Math.min(60, Math.max(1, parseInt(req.query.days, 10) || 7));
  const since = now() - days * 86_400_000;
  const rows = all("SELECT routine_slug, status, cost_usd, num_turns FROM runs WHERE created_at > ? AND status IN ('succeeded','failed')", since);
  const totalCost = rows.reduce((a, r) => a + (r.cost_usd || 0), 0);
  const fails = rows.filter((r) => r.status === 'failed').length;
  const perR = {};
  for (const r of rows) { const p = (perR[r.routine_slug] ||= { runs: 0, cost: 0, fails: 0 }); p.runs++; p.cost += r.cost_usd || 0; if (r.status === 'failed') p.fails++; }
  const top = Object.entries(perR).sort((a, b) => b[1].cost - a[1].cost).slice(0, 5);
  const slugSet = new Set(all('SELECT slug FROM routines').map((x) => x.slug));
  const warnings = all('SELECT * FROM routines').flatMap((r) => lintRoutine(r, slugSet).map((w) => `${r.slug}: ${w}`));
  const stats = one('SELECT COUNT(*) AS total, SUM(enabled) AS enabledN FROM routines');
  const lines = [
    `# Switchboard report — last ${days}d`,
    `_generated ${new Date(now()).toISOString()}_`, '',
    `- **Routines**: ${stats.total} (${stats.enabledN || 0} enabled)`,
    `- **Runs**: ${rows.length} · **Spend**: $${totalCost.toFixed(2)} · **Failures**: ${fails} (${rows.length ? Math.round((100 * fails) / rows.length) : 0}%)`,
    '', '## Top routines by spend',
    ...(top.length ? top.map(([slug, p]) => `- **${slug}** — ${p.runs} runs, $${p.cost.toFixed(2)}${p.fails ? `, ${p.fails} failed` : ''}`) : ['- _no runs in window_']),
    '', `## Config warnings (${warnings.length})`,
    ...(warnings.length ? warnings.map((w) => `- ⚠ ${w}`) : ['- none 🎉']),
  ];
  res.setHeader('Content-Type', 'text/markdown');
  res.setHeader('Content-Disposition', 'attachment; filename="switchboard-report.md"');
  res.send(lines.join('\n'));
});
// Config lint: flag routines that are misconfigured in ways that fail silently.
function lintRoutine(r, slugSet) {
  const w = [];
  const trig = j(r.triggers);
  if (r.enabled && trig.length === 0) w.push('enabled but has no triggers — it can never fire');
  if (trig.includes('schedule') && !String(r.schedule || '').trim()) w.push('schedule trigger but no cron set');
  for (const t of j(r.chain)) if (t && !slugSet.has(t)) w.push(`chains to "${t}" which no longer exists`);
  for (const rx of j(r.reactions)) if (rx.run && !slugSet.has(rx.run)) w.push(`reacts to "${rx.run}" which no longer exists`);
  if (r.script_mode && !(r.script && r.script.trim())) w.push('script mode but the extractor is not compiled yet');
  if (r.alert_on_fail && !String(r.alert_target || '').trim() && (!r.owner || r.owner === 'unassigned')) w.push('alert-on-fail set but no target and no owner to notify');
  if ((r.max_fails || 0) > 0 && (r.retries || 0) >= r.max_fails) w.push('auto-disable threshold ≤ retries — it may never trip');
  return w;
}
app.get('/api/lint', (_q, res) => {
  const rows = all('SELECT * FROM routines');
  const slugSet = new Set(rows.map((r) => r.slug));
  const issues = rows.map((r) => ({ slug: r.slug, name: r.name, warnings: lintRoutine(r, slugSet) })).filter((x) => x.warnings.length);
  res.json({ count: issues.reduce((a, x) => a + x.warnings.length, 0), issues });
});
// Routine flow: the chain + reaction edges between routines (the fleet's topology).
app.get('/api/graph', (_q, res) => {
  const rows = all('SELECT slug,name,chain,reactions FROM routines WHERE enabled=1');
  const names = Object.fromEntries(rows.map((r) => [r.slug, r.name]));
  const exists = (s) => s in names || !!one('SELECT 1 FROM routines WHERE slug=?', s);
  const edges = [];
  for (const r of rows) {
    j(r.chain).forEach((t) => { if (t) edges.push({ from: r.slug, to: t, kind: 'chain', label: 'on success' }); });
    j(r.reactions).forEach((rx) => { if (rx.run) edges.push({ from: r.slug, to: rx.run, kind: 'reaction', label: `${rx.source}:${rx.kind}${rx.when ? ':' + rx.when : ''}${rx.check ? ` [${rx.check}]` : ''}` }); });
  }
  res.json({ edges: edges.map((e) => ({ ...e, fromName: names[e.from] || e.from, toName: names[e.to] || e.to, toExists: exists(e.to) })) });
});
// Upcoming scheduled runs — project the next fire times of cron routines forward.
const relFuture = (ts) => { const d = ts - now(); if (d < 60_000) return 'in <1m'; if (d < 3_600_000) return `in ${Math.round(d / 60_000)}m`; if (d < 86_400_000) return `in ${Math.round(d / 3_600_000)}h`; return `in ${Math.round(d / 86_400_000)}d`; };
app.get('/api/schedule', (req, res) => {
  const hours = Math.min(168, Math.max(1, parseInt(req.query.hours, 10) || 48));
  const rows = all("SELECT slug,name,schedule FROM routines WHERE enabled=1 AND triggers LIKE '%schedule%' AND schedule != ''");
  const start = new Date(now()); start.setSeconds(0, 0);
  const upcoming = [];
  for (const r of rows) {
    let count = 0;
    for (let m = 1; m <= hours * 60 && count < 3; m++) {
      const d = new Date(start.getTime() + m * 60_000);
      if (cronMatches(r.schedule, d)) {
        upcoming.push({ slug: r.slug, name: r.name, cron: r.schedule, at: d.getTime(), when: d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }), in: relFuture(d.getTime()) });
        count++;
      }
    }
  }
  upcoming.sort((a, b) => a.at - b.at);
  // Missed: a schedule whose most recent expected fire (last 26h) produced no run.
  const missed = [];
  for (const r of rows) {
    let lastExp = null;
    for (let m = 2; m <= 26 * 60; m++) { const d = new Date(start.getTime() - m * 60_000); if (cronMatches(r.schedule, d)) { lastExp = d.getTime(); break; } }
    if (!lastExp) continue;
    const lastRun = one("SELECT MAX(created_at) AS t FROM runs WHERE routine_slug=? AND trigger LIKE 'schedule%'", r.slug)?.t || 0;
    if (lastRun < lastExp - 60_000) missed.push({ slug: r.slug, name: r.name, cron: r.schedule, expected: lastExp, ago: relTime(lastExp) });
  }
  res.json({ hours, count: upcoming.length, upcoming, missed });
});
// Failure clustering: group recent failed runs by a normalized error signature.
app.get('/api/failures', (req, res) => {
  const days = Math.min(30, Math.max(1, parseInt(req.query.days, 10) || 7));
  const rows = all("SELECT id, routine_slug, output, created_at FROM runs WHERE created_at > ? AND status='failed'", now() - days * 86_400_000);
  const sig = (out) => {
    let s = String(out || '').split('\n').map((l) => l.trim()).filter(Boolean).pop() || 'no output';
    s = s.replace(/\b[0-9a-f]{7,}\b/gi, '#').replace(/\d+/g, 'N').replace(/(['"`]).*?\1/g, '…').replace(/\s+/g, ' ').trim().slice(0, 90);
    return s || 'no output';
  };
  const groups = {};
  for (const r of rows) {
    const k = sig(r.output);
    const g = (groups[k] ||= { signature: k, count: 0, routines: new Set(), latest: 0, sampleRun: r.id });
    g.count++; g.routines.add(r.routine_slug); if (r.created_at > g.latest) { g.latest = r.created_at; g.sampleRun = r.id; }
  }
  const clusters = Object.values(groups).map((g) => ({ signature: g.signature, count: g.count, routines: [...g.routines], sampleRun: g.sampleRun, ago: relTime(g.latest) })).sort((a, b) => b.count - a.count).slice(0, 12);
  res.json({ total: rows.length, clusters });
});
// Run activity heatmap: counts by day-of-week × hour-of-day (local time).
app.get('/api/heatmap', (req, res) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 30));
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const r of all('SELECT created_at FROM runs WHERE created_at > ?', now() - days * 86_400_000)) {
    const d = new Date(r.created_at); grid[d.getDay()][d.getHours()]++;
  }
  res.json({ grid, max: Math.max(1, ...grid.flat()), days });
});
// Cost anomalies: successful runs that cost far more than their routine's average.
app.get('/api/anomalies', (req, res) => {
  const days = Math.min(60, Math.max(1, parseInt(req.query.days, 10) || 14));
  const since = now() - days * 86_400_000;
  const runs = all("SELECT id, routine_slug, cost_usd, num_turns, created_at FROM runs WHERE created_at > ? AND status='succeeded' AND cost_usd > 0", since);
  const byR = {};
  for (const r of runs) (byR[r.routine_slug] ||= []).push(r.cost_usd);
  const avg = {};
  for (const k in byR) avg[k] = byR[k].reduce((a, b) => a + b, 0) / byR[k].length;
  const anomalies = runs
    .filter((r) => byR[r.routine_slug].length >= 4 && r.cost_usd > 3 * avg[r.routine_slug])
    .map((r) => ({ id: r.id, slug: r.routine_slug, cost: +r.cost_usd.toFixed(4), avg: +avg[r.routine_slug].toFixed(4), x: +(r.cost_usd / avg[r.routine_slug]).toFixed(1), turns: r.num_turns, ago: relTime(r.created_at) }))
    .sort((a, b) => b.x - a.x).slice(0, 20);
  res.json({ anomalies });
});
// Observability: cost / runs / turns / latency over time and per routine.
app.get('/api/insights', (req, res) => {
  const days = Math.min(60, Math.max(1, parseInt(req.query.days, 10) || 14));
  const since = now() - days * 86_400_000;
  const rows = all("SELECT routine_slug, status, cost_usd, num_turns, dur_ms, in_tokens, out_tokens, created_at FROM runs WHERE created_at > ? AND status IN ('succeeded','failed')", since);
  const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);
  const daily = {};
  for (let i = days - 1; i >= 0; i--) { const k = dayKey(now() - i * 86_400_000); daily[k] = { date: k, runs: 0, cost: 0, fails: 0 }; }
  const perR = {};
  const T = { runs: 0, cost: 0, turns: 0, ms: 0, nMs: 0, fails: 0, inTok: 0, outTok: 0 };
  for (const r of rows) {
    const k = dayKey(r.created_at);
    if (daily[k]) { daily[k].runs++; daily[k].cost += r.cost_usd || 0; if (r.status === 'failed') daily[k].fails++; }
    const p = (perR[r.routine_slug] ||= { slug: r.routine_slug, runs: 0, cost: 0, turns: 0, ms: 0, nMs: 0, fails: 0 });
    p.runs++; p.cost += r.cost_usd || 0; p.turns += r.num_turns || 0; if (r.dur_ms) { p.ms += r.dur_ms; p.nMs++; } if (r.status === 'failed') p.fails++;
    T.runs++; T.cost += r.cost_usd || 0; T.turns += r.num_turns || 0; if (r.dur_ms) { T.ms += r.dur_ms; T.nMs++; } if (r.status === 'failed') T.fails++; T.inTok += r.in_tokens || 0; T.outTok += r.out_tokens || 0;
  }
  const dispatch = {};
  for (const d of all('SELECT status, COUNT(*) AS n FROM runs WHERE created_at > ? GROUP BY status', since)) dispatch[d.status] = d.n;
  const tagsOf = Object.fromEntries(all('SELECT slug,tags FROM routines').map((x) => [x.slug, j(x.tags)]));
  const byT = {};
  for (const r of rows) for (const t of (tagsOf[r.routine_slug] || [])) { const e = (byT[t] ||= { tag: t, runs: 0, cost: 0 }); e.runs++; e.cost += r.cost_usd || 0; }
  const byTag = Object.values(byT).map((t) => ({ ...t, cost: +t.cost.toFixed(4) })).sort((a, b) => b.cost - a.cost);
  const modelOf = Object.fromEntries(all('SELECT slug,model FROM routines').map((x) => [x.slug, x.model]));
  const byM = {};
  for (const r of rows) { const m = modelOf[r.routine_slug] || 'unknown'; const e = (byM[m] ||= { model: m, runs: 0, cost: 0 }); e.runs++; e.cost += r.cost_usd || 0; }
  const byModel = Object.values(byM).map((m) => ({ ...m, cost: +m.cost.toFixed(4) })).sort((a, b) => b.cost - a.cost);
  const names = Object.fromEntries(all('SELECT slug,name FROM routines').map((x) => [x.slug, x.name]));
  const perRoutine = Object.values(perR).map((p) => ({
    slug: p.slug, name: names[p.slug] || p.slug, runs: p.runs, cost: +p.cost.toFixed(4), turns: p.turns,
    avgMs: p.nMs ? Math.round(p.ms / p.nMs) : 0, fails: p.fails, failRate: p.runs ? Math.round((100 * p.fails) / p.runs) : 0,
  })).sort((a, b) => b.cost - a.cost || b.runs - a.runs);
  res.json({
    days,
    daily: Object.values(daily).map((d) => ({ ...d, cost: +d.cost.toFixed(4) })),
    perRoutine, byModel, byTag, dispatch,
    totals: { runs: T.runs, cost: +T.cost.toFixed(2), turns: T.turns, avgMs: T.nMs ? Math.round(T.ms / T.nMs) : 0, fails: T.fails, failRate: T.runs ? Math.round((100 * T.fails) / T.runs) : 0, inTok: T.inTok, outTok: T.outTok },
    projection: { perDay: +(T.cost / days).toFixed(2), monthly: +((T.cost / days) * 30).toFixed(2), runsPerDay: +(T.runs / days).toFixed(1) },
    budget: { cap: budgetCap(), today: +todaySpend().toFixed(2), over: overBudget() },
    digest: { channel: metaGet('digest_channel', ''), hour: parseInt(metaGet('digest_hour', '-1'), 10) },
  });
});
app.post('/api/budget', (req, res) => {
  const cap = Math.max(0, parseFloat(req.body?.cap) || 0);
  setMeta('daily_budget', cap > 0 ? String(cap) : '');
  res.json({ ok: true, cap, today: +todaySpend().toFixed(2) });
});
app.get('/api/stats', (_q, res) => {
  const rows = all('SELECT * FROM routines');
  const enabled = rows.filter((r) => r.enabled);
  const st = (s) => rows.filter((r) => r.enabled && r.state === s).length;
  const teams = new Set(rows.map((r) => r.team)).size;
  // Real success rate from the last 100 finished runs; real spend from captured cost.
  const recent = all("SELECT status FROM runs WHERE status IN ('succeeded','failed') ORDER BY created_at DESC LIMIT 100");
  const successRate = recent.length ? Math.round((100 * recent.filter((r) => r.status === 'succeeded').length) / recent.length) : null;
  const spendNum = one('SELECT COALESCE(SUM(cost_usd),0) AS s FROM runs').s || 0;
  const dayAgo = now() - 86_400_000;
  res.json({
    wordmark: meta('wordmark', 'Switchboard'), killSwitch: meta('kill_switch', 'false') === 'true',
    total: rows.length, enabled: enabled.length, teams,
    running: st('running'), failing: st('failing'),
    runsToday: one('SELECT COUNT(*) AS n FROM runs WHERE created_at > ?', dayAgo).n,
    successRate, spend: `$${Number(spendNum).toFixed(2)}`,
  });
});

app.get('/api/routines', (_q, res) => res.json(all('SELECT * FROM routines ORDER BY ord').map(shapeRoutine)));

app.get('/api/routines/:slug', (req, res) => {
  const r = one('SELECT * FROM routines WHERE slug=?', req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  const runHistory = all('SELECT * FROM runs WHERE routine_slug=? ORDER BY created_at DESC, ord DESC LIMIT 12', r.slug)
    .map((x) => ({ id: x.id, status: x.status, ago: relTime(x.created_at), dur: x.dur, trigger: x.trigger }));
  const watches = all('SELECT * FROM watches WHERE origin_routine=? ORDER BY created_at DESC LIMIT 20', r.slug).map(shapeWatch);
  const leases = all('SELECT * FROM leases WHERE routine_slug=? AND expires_at > ? ORDER BY acquired_at DESC', r.slug, now())
    .map((l) => ({ key: l.key, runId: l.run_id, sha: l.head_sha ? l.head_sha.slice(0, 7) : '', held: relTime(l.acquired_at), ttl: fmtDur(Math.max(0, l.expires_at - now())) }));
  const inboxTasks = all("SELECT * FROM run_tasks WHERE routine_slug=? AND handled_by='' ORDER BY created_at DESC LIMIT 20", r.slug)
    .map((t) => ({ summary: t.summary, key: t.lease_key, ago: relTime(t.created_at) }));
  const lf = one("SELECT id, output, created_at FROM runs WHERE routine_slug=? AND status='failed' ORDER BY created_at DESC, ord DESC LIMIT 1", r.slug);
  const lastError = lf ? { runId: lf.id, output: String(lf.output || '').slice(0, 400), ago: relTime(lf.created_at) } : null;
  res.json({ ...shapeRoutine(r), ...detailOf(r), runHistory, watches, leases, inboxTasks, script: r.script || '', lastError });
});

function insertRoutine(b) {
  const slug = (b.slug || slugify(b.name)).trim();
  const owner = (b.owner || '').trim() || 'unassigned';
  const team = (b.team || '').trim() || 'general';
  const triggers = Array.isArray(b.triggers) ? b.triggers.filter(Boolean) : [];
  const connectors = Array.isArray(b.connectors) ? b.connectors.filter(Boolean) : [];
  const chain = Array.isArray(b.chain) ? b.chain.filter(Boolean) : [];
  const schedule = (b.schedule || '').trim();
  const filters = cleanFilters(b.filters);
  const reactions = cleanReactions(b.reactions);
  const enabled = b.enabled === false ? 0 : 1;
  const ord = (one('SELECT MAX(ord) AS m FROM routines').m ?? -1) + 1;
  const next = triggers.includes('schedule') ? (schedule || 'scheduled') : triggers.length ? 'on event' : '—';
  run(
    `INSERT INTO routines
      (slug,name,summary,owner,team,triggers,connectors,state,last_ago,last_status,next,success,spend,enabled,meta_short,lease_ref,avg,av_color,initials,ord,prompt,model,repo,branch,chain,schedule,filters,reactions,effort,memory,concurrency,script_mode,script_lang,retries,assertions,alert_on_fail,alert_target,timeout_s,env,tags,rate_limit,max_fails,notes,active_window)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    slug, (b.name || '').trim(), (b.summary || '').trim(), owner, team,
    JSON.stringify(triggers), JSON.stringify(connectors),
    'idle', 'never', 'idle', next, null, '$0.00', enabled, '', '', '—',
    ownerColor(owner), initialsOf(owner), ord,
    (b.prompt || '').trim(), normModel(b.model), (b.repo || '').trim(), (b.branch || 'main').trim(),
    JSON.stringify(chain), schedule, JSON.stringify(filters), JSON.stringify(reactions), normEffort(b.effort), b.memory ? 1 : 0, JSON.stringify(cleanConcurrency(b.concurrency)),
    b.scriptMode ? 1 : 0, b.scriptLang === 'node' ? 'node' : 'bash', normRetries(b.retries), JSON.stringify(cleanAssertions(b.assertions)),
    b.alertOnFail ? 1 : 0, (b.alertTarget || '').trim(), Math.max(0, Math.min(1800, parseInt(b.timeout, 10) || 0)), JSON.stringify(cleanEnv(b.env)), JSON.stringify(Array.isArray(b.tags) ? b.tags.map((t) => String(t).trim()).filter(Boolean) : []), Math.max(0, Math.min(1000, parseInt(b.rateLimit, 10) || 0)), Math.max(0, Math.min(50, parseInt(b.maxFails, 10) || 0)), String(b.notes || '').slice(0, 4000), cleanWindow(b.activeWindow)
  );
  return slug;
}
// One-click: seed three real developer flows (routines + agents). Idempotent.
app.get('/api/samples', (_q, res) => res.json({
  scenarios: [...new Set(SAMPLE_ROUTINES.map((r) => r.scenario))].map((s) => ({
    scenario: s, routines: SAMPLE_ROUTINES.filter((r) => r.scenario === s).map((r) => ({ slug: r.slug, name: r.name, summary: r.summary, exists: !!one('SELECT 1 FROM routines WHERE slug=?', r.slug) })),
  })),
  agents: SAMPLE_AGENTS.map((a) => ({ name: a.name, summary: a.summary, exists: !!one('SELECT 1 FROM agents WHERE name=?', a.name) })),
}));
app.post('/api/samples/load', async (req, res) => {
  const repos = await listRepos({});
  const repo = String(req.body?.repo || '').trim() || repos[0] || '';
  const fill = (s) => String(s).split('__REPO__').join(repo || 'OWNER/REPO');
  const routines = [], agents = [], skipped = [];
  for (const a of SAMPLE_AGENTS) {
    if (one('SELECT 1 FROM agents WHERE name=?', a.name)) { skipped.push(`@${a.name}`); continue; }
    run('INSERT INTO agents (name,role,summary,connectors,model,effort,memory,av_color,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      a.name, fill(a.role), a.summary, JSON.stringify(a.connectors || []), normModel(a.model), normEffort(a.effort), a.memory ? 1 : 0, ownerColor(a.name), now());
    agents.push(a.name);
  }
  for (const rt of SAMPLE_ROUTINES) {
    if (one('SELECT 1 FROM routines WHERE slug=?', rt.slug)) { skipped.push(rt.slug); continue; }
    insertRoutine({ ...rt, repo: rt.repo === '__REPO__' ? repo : rt.repo, prompt: fill(rt.prompt) });
    routines.push(rt.slug);
  }
  if (routines.length || agents.length) logActivity(`loaded ${routines.length} example routines + ${agents.length} agents${repo ? ` for ${repo}` : ''}`, 'success');
  res.json({ repo, routines, agents, skipped });
});
app.post('/api/routines', (req, res) => {
  const b = req.body || {};
  const name = (b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'A routine name is required.' });
  const slug = (b.slug || slugify(name)).trim();
  if (!slug) return res.status(400).json({ error: 'A valid slug is required.' });
  if (one('SELECT 1 FROM routines WHERE slug=?', slug)) return res.status(409).json({ error: `A routine with slug "${slug}" already exists.` });
  insertRoutine(b);
  res.status(201).json(shapeRoutine(one('SELECT * FROM routines WHERE slug=?', slug)));
});

function buildRoutineMd(r) {
  const L = ['---', `name: ${r.name}`, `slug: ${r.slug}`, 'summary: >-', `  ${r.summary}`, `owner: ${r.owner}`, `team: ${r.team}`, 'on:'];
  const flt = jObj(r.filters) || {};
  j(r.triggers).forEach((t) => {
    if (t === 'schedule' && r.schedule) L.push(`  - schedule: { cron: "${r.schedule}" }`);
    else if ((t === 'push') && Array.isArray(flt.branches) && flt.branches.length) L.push(`  - ${t}: { branches: [${flt.branches.join(', ')}] }`);
    else if (Array.isArray(flt.actions) && flt.actions.length) L.push(`  - ${t}: { actions: [${flt.actions.join(', ')}] }`);
    else L.push(`  - ${t}: {}`);
  });
  if (j(r.connectors).length) { L.push('tools:', `  grant: [${j(r.connectors).join(', ')}]`); }
  L.push('runtime:', `  model: ${r.model}`);
  if (r.effort) L.push(`  effort: ${r.effort}`);
  L.push(`  repos: [${(r.repo || '').split(',').map((s) => s.trim()).filter(Boolean).join(', ') || '*'}]`);
  if (r.memory) L.push('  memory: enabled');
  { const c = jObj(r.concurrency) || {}; if (c.scope && c.scope !== 'off') L.push(`  concurrency: { scope: ${c.scope || 'auto'}, on_conflict: ${c.onConflict || 'wait'} }`); }
  const chain = j(r.chain);
  if (chain.length) L.push(`chain: [${chain.join(', ')}]`);
  const reactions = cleanReactions(j(r.reactions));
  if (reactions.length) {
    L.push('react:');
    reactions.forEach((rx) => L.push(`  - on: ${rx.source}:${rx.kind}${rx.when ? ':' + rx.when : ''}${rx.check ? ` [${rx.check}]` : ''}  →  run: ${rx.run}`));
  }
  L.push('---', '', r.prompt && r.prompt.trim() ? r.prompt : `## Prompt\n${r.summary}`);
  return L.join('\n');
}

app.get('/api/routines/:slug/raw', (req, res) => {
  const r = one('SELECT * FROM routines WHERE slug=?', req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json({ file: `${r.slug}.routine.md`, md: buildRoutineMd(r) });
});

// The routine's persistent memory (memory.md + supporting files).
app.get('/api/routines/:slug/memory', (req, res) => {
  const r = one('SELECT slug, memory FROM routines WHERE slug=?', req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  const dir = memDirFor(r.slug);
  const mdPath = join(dir, 'memory.md');
  const exists = existsSync(mdPath);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f !== 'memory.md' && !f.startsWith('.')) : [];
  res.json({ enabled: !!r.memory, exists, md: exists ? readFileSync(mdPath, 'utf8') : '', files });
});

app.put('/api/routines/:slug', (req, res) => {
  const r = one('SELECT * FROM routines WHERE slug=?', req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  const owner = (b.owner ?? r.owner).trim() || 'unassigned';
  const triggers = Array.isArray(b.triggers) ? b.triggers.filter(Boolean) : j(r.triggers);
  const schedule = b.schedule != null ? String(b.schedule).trim() : (r.schedule || '');
  const filters = b.filters != null ? cleanFilters(b.filters) : (jObj(r.filters) || {});
  const reactions = b.reactions != null ? cleanReactions(b.reactions) : j(r.reactions);
  const next = triggers.includes('schedule') ? (schedule || 'scheduled') : triggers.length ? 'on event' : '—';
  const scriptModeAfter = b.scriptMode != null ? !!b.scriptMode : !!r.script_mode;
  const promptChanged = b.prompt != null && b.prompt.trim() !== r.prompt;
  // Editing what to extract on a script routine doesn't throw the script away — it keeps it
  // as the basis and marks it stale so the LLM regenerates from the current script next.
  const staleAfter = (scriptModeAfter && promptChanged) ? 1 : r.script_stale;
  // Snapshot the prior prompt before overwriting it, so edits are reversible + auditable.
  if (promptChanged && r.prompt && r.prompt.trim()) run('INSERT INTO prompt_history (slug, prompt, created_at) VALUES (?,?,?)', r.slug, r.prompt, now());
  run(
    `UPDATE routines SET name=?,summary=?,owner=?,team=?,triggers=?,connectors=?,chain=?,model=?,repo=?,branch=?,prompt=?,av_color=?,initials=?,next=?,schedule=?,filters=?,reactions=?,effort=?,memory=?,concurrency=?,script_mode=?,script_lang=?,script_stale=?,retries=?,assertions=?,alert_on_fail=?,alert_target=?,timeout_s=?,env=?,tags=?,rate_limit=?,max_fails=?,notes=?,active_window=? WHERE slug=?`,
    (b.name ?? r.name).trim() || r.name, (b.summary ?? r.summary).trim(), owner, (b.team ?? r.team).trim() || 'general',
    JSON.stringify(triggers), JSON.stringify(Array.isArray(b.connectors) ? b.connectors.filter(Boolean) : j(r.connectors)),
    JSON.stringify(Array.isArray(b.chain) ? b.chain.filter(Boolean) : j(r.chain)),
    normModel(b.model ?? r.model), (b.repo ?? r.repo).trim(), (b.branch ?? r.branch).trim() || 'main',
    (b.prompt ?? r.prompt).trim(), ownerColor(owner), initialsOf(owner), next, schedule, JSON.stringify(filters), JSON.stringify(reactions),
    b.effort != null ? normEffort(b.effort) : (r.effort || ''),
    b.memory != null ? (b.memory ? 1 : 0) : r.memory,
    JSON.stringify(b.concurrency != null ? cleanConcurrency(b.concurrency) : (jObj(r.concurrency) || {})),
    b.scriptMode != null ? (b.scriptMode ? 1 : 0) : r.script_mode,
    b.scriptLang ? (b.scriptLang === 'node' ? 'node' : 'bash') : r.script_lang,
    staleAfter,
    b.retries != null ? normRetries(b.retries) : r.retries,
    JSON.stringify(b.assertions != null ? cleanAssertions(b.assertions) : j(r.assertions)),
    b.alertOnFail != null ? (b.alertOnFail ? 1 : 0) : r.alert_on_fail,
    b.alertTarget != null ? String(b.alertTarget).trim() : r.alert_target,
    b.timeout != null ? Math.max(0, Math.min(1800, parseInt(b.timeout, 10) || 0)) : r.timeout_s,
    JSON.stringify(b.env != null ? cleanEnv(b.env) : (jObj(r.env) || {})),
    JSON.stringify(Array.isArray(b.tags) ? b.tags.map((t) => String(t).trim()).filter(Boolean) : j(r.tags)),
    b.rateLimit != null ? Math.max(0, Math.min(1000, parseInt(b.rateLimit, 10) || 0)) : r.rate_limit,
    b.maxFails != null ? Math.max(0, Math.min(50, parseInt(b.maxFails, 10) || 0)) : r.max_fails,
    b.notes != null ? String(b.notes).slice(0, 4000) : r.notes,
    b.activeWindow !== undefined ? cleanWindow(b.activeWindow) : r.active_window,
    r.slug
  );
  const updated = one('SELECT * FROM routines WHERE slug=?', r.slug);
  // Fire the LLM to regenerate the extractor when the instruction changed (keeping the
  // current script as the starting point, passed in via the compile prompt).
  if (scriptModeAfter && promptChanged) executeRoutine({ ...updated, script_stale: 1 }, { event: 'recompile', _recompile: true, routine: r.slug }, 'recompile · prompt edited');
  res.json(shapeRoutine(updated));
});

app.delete('/api/routines/:slug', (req, res) => {
  const r = one('SELECT * FROM routines WHERE slug=?', req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  run('DELETE FROM routines WHERE slug=?', r.slug);
  run('DELETE FROM runs WHERE routine_slug=?', r.slug);
  res.json({ ok: true });
});

// Portability: export a routine's full definition as a JSON bundle, and import one.
const exportBody = (r) => ({
  name: r.name, summary: r.summary, owner: r.owner, team: r.team,
  triggers: j(r.triggers), connectors: j(r.connectors), chain: j(r.chain),
  schedule: r.schedule, filters: jObj(r.filters) || {}, reactions: j(r.reactions),
  concurrency: jObj(r.concurrency) || {}, model: r.model, effort: r.effort, memory: !!r.memory,
  repo: r.repo, prompt: r.prompt, scriptMode: !!r.script_mode, scriptLang: r.script_lang,
  retries: r.retries, assertions: j(r.assertions), alertOnFail: !!r.alert_on_fail, alertTarget: r.alert_target, tags: j(r.tags), env: jObj(r.env) || {},
});
// Snooze: pause a routine's triggers + schedule until a time, then auto-resume.
app.post('/api/routines/:slug/snooze', (req, res) => {
  const r = one('SELECT slug FROM routines WHERE slug=?', req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  const hours = Math.max(0, Math.min(720, parseFloat(req.body?.hours) || 0));
  const until = hours > 0 ? now() + hours * 3_600_000 : 0;
  run('UPDATE routines SET snooze_until=? WHERE slug=?', until, req.params.slug);
  logActivity(`${req.params.slug} ${until ? `snoozed for ${hours}h` : 'snooze cleared'}`, 'idle');
  res.json({ ok: true, snoozedUntil: until });
});
// Dry-run preview: the exact prompt the agent would get + whether an event matches — $0.
app.post('/api/routines/:slug/preview', (req, res) => {
  const r = one('SELECT * FROM routines WHERE slug=?', req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  const event = req.body?.event && Object.keys(req.body.event).length ? req.body.event : { event: 'manual', routine: r.slug };
  const tools = j(r.connectors);
  const agents = tools.includes('team') ? all('SELECT name, role, summary FROM agents ORDER BY name') : [];
  const willCompile = !!r.script_mode && !(r.script && r.script.trim());
  const prompt = buildPrompt({ ...r, connectors: tools }, event, policyConstraints(), { agents, compile: willCompile, scriptLang: r.script_lang });
  const triggerType = event.event || event.type || 'manual';
  const wouldMatch = j(r.triggers).includes(triggerType) && repoMatches(r, event) && filtersMatch(r, event);
  const { key } = leaseFor(r, event);
  res.json({ prompt, tools, agents: agents.map((a) => a.name), wouldMatch, leaseKey: key, scriptMode: !!r.script_mode, willCompile, allowedTools: allowedToolsFor(tools) });
});
app.get('/api/routines/:slug/export', (req, res) => {
  const r = one('SELECT * FROM routines WHERE slug=?', req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json({ switchboard: 'routine', version: 1, slug: r.slug, routine: exportBody(r) });
});
// Full single-run bundle (event + output + trace + metrics) as JSON.
app.get('/api/runs/:id/bundle', (req, res) => {
  const x = one('SELECT * FROM runs WHERE id=?', req.params.id);
  if (!x) return res.status(404).json({ error: 'not found' });
  const trace = all('SELECT seq,t_offset,type,tool,ok,payload FROM run_events WHERE run_id=? ORDER BY seq', x.id).map((e) => {
    let p; try { p = JSON.parse(e.payload); } catch { p = { d: e.payload }; }
    return { seq: e.seq, ms: e.t_offset, type: e.type, tool: e.tool, ok: e.ok, text: p.d };
  });
  const bundle = {
    id: x.id, routine: x.routine_slug, status: x.status, trigger: x.trigger,
    created_at: new Date(x.created_at).toISOString(), cost_usd: x.cost_usd, num_turns: x.num_turns,
    dur: x.dur, session_id: x.session_id, event: jObj(x.event) || null, output: x.output, trace,
  };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${x.id}.json"`);
  res.send(JSON.stringify(bundle, null, 2));
});
// Export runs as CSV (all, or one routine) for offline analysis.
app.get('/api/runs.csv', (req, res) => {
  const slug = req.query.routine ? String(req.query.routine) : '';
  const rows = slug
    ? all('SELECT * FROM runs WHERE routine_slug=? ORDER BY created_at DESC LIMIT 5000', slug)
    : all('SELECT * FROM runs ORDER BY created_at DESC LIMIT 5000');
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [['id', 'routine', 'status', 'trigger', 'cost_usd', 'num_turns', 'dur', 'created_at'].join(',')];
  for (const x of rows) lines.push([x.id, x.routine_slug, x.status, x.trigger, x.cost_usd ?? '', x.num_turns ?? '', x.dur, new Date(x.created_at).toISOString()].map(esc).join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="switchboard-runs${slug ? '-' + slug : ''}.csv"`);
  res.send(lines.join('\n'));
});
// Full-text search across all run outputs (and routine slug).
app.get('/api/runs/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ results: [], q });
  const like = `%${q}%`;
  const rows = all('SELECT id, routine_slug, status, output, created_at FROM runs WHERE output LIKE ? OR routine_slug LIKE ? ORDER BY created_at DESC LIMIT 40', like, like);
  const snip = (out) => {
    const s = String(out || ''); const i = s.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return s.slice(0, 120).replace(/\s+/g, ' ');
    return `${i > 30 ? '…' : ''}${s.slice(Math.max(0, i - 30), i + q.length + 70).replace(/\s+/g, ' ')}…`;
  };
  res.json({ q, results: rows.map((x) => ({ id: x.id, slug: x.routine_slug, status: x.status, ago: relTime(x.created_at), snippet: snip(x.output) })) });
});
// Diff a run against the previous run of the same routine (output + metric deltas).
app.get('/api/runs/:id/diff', (req, res) => {
  const cur = one('SELECT * FROM runs WHERE id=?', req.params.id);
  if (!cur) return res.status(404).json({ error: 'not found' });
  const prev = one("SELECT * FROM runs WHERE routine_slug=? AND created_at < ? AND status IN ('succeeded','failed') ORDER BY created_at DESC, ord DESC LIMIT 1", cur.routine_slug, cur.created_at);
  const brief = (x) => x ? { id: x.id, output: x.output || '', cost: x.cost_usd, turns: x.num_turns, status: x.status, ago: relTime(x.created_at) } : null;
  res.json({ current: brief(cur), previous: brief(prev) });
});
// Prompt history — past versions of a routine's prompt, with restore.
app.get('/api/routines/:slug/history', (req, res) => {
  const r = one('SELECT prompt FROM routines WHERE slug=?', req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  const rows = all('SELECT id, prompt, created_at FROM prompt_history WHERE slug=? ORDER BY id DESC LIMIT 30', req.params.slug);
  res.json({ current: r.prompt || '', versions: rows.map((x) => ({ id: x.id, ago: relTime(x.created_at), chars: (x.prompt || '').length, prompt: x.prompt || '' })) });
});
app.post('/api/routines/:slug/restore/:id', (req, res) => {
  const r = one('SELECT * FROM routines WHERE slug=?', req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  const v = one('SELECT prompt FROM prompt_history WHERE id=? AND slug=?', req.params.id, req.params.slug);
  if (!v) return res.status(404).json({ error: 'version not found' });
  if (r.prompt && r.prompt.trim() && r.prompt !== v.prompt) run('INSERT INTO prompt_history (slug, prompt, created_at) VALUES (?,?,?)', r.slug, r.prompt, now());
  const stale = r.script_mode ? 1 : r.script_stale;
  run('UPDATE routines SET prompt=?, script_stale=? WHERE slug=?', v.prompt, stale, r.slug);
  logActivity(`${r.slug} prompt restored from a prior version`, 'idle');
  res.json({ ok: true });
});
// Saved Fleet views — named filter presets persisted in meta.
const readViews = () => { try { return JSON.parse(metaGet('fleet_views', '[]')); } catch { return []; } };
app.get('/api/views', (_q, res) => res.json({ views: readViews() }));
app.post('/api/views', (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'a view name is required' });
  const params = req.body?.params && typeof req.body.params === 'object' ? req.body.params : {};
  const next = [...readViews().filter((v) => v.name !== name), { name, params }].slice(-20);
  setMeta('fleet_views', JSON.stringify(next));
  res.json({ views: next });
});
app.delete('/api/views', (req, res) => {
  const next = readViews().filter((v) => v.name !== String(req.query.name || ''));
  setMeta('fleet_views', JSON.stringify(next));
  res.json({ views: next });
});
// Bulk operations across many routines at once.
app.post('/api/routines/bulk', (req, res) => {
  const { slugs = [], action, hours, tag } = req.body || {};
  const list = (Array.isArray(slugs) ? slugs : []).filter((s) => typeof s === 'string');
  let n = 0;
  for (const slug of list) {
    if (!one('SELECT 1 FROM routines WHERE slug=?', slug)) continue;
    if (action === 'enable') run('UPDATE routines SET enabled=1, fail_streak=0 WHERE slug=?', slug);
    else if (action === 'disable') run('UPDATE routines SET enabled=0 WHERE slug=?', slug);
    else if (action === 'snooze') run('UPDATE routines SET snooze_until=? WHERE slug=?', now() + (Number(hours) || 4) * 3_600_000, slug);
    else if (action === 'unsnooze') run('UPDATE routines SET snooze_until=0 WHERE slug=?', slug);
    else if (action === 'tag' && tag) { const cur = j(one('SELECT tags FROM routines WHERE slug=?', slug).tags); if (!cur.includes(tag)) run('UPDATE routines SET tags=? WHERE slug=?', JSON.stringify([...cur, String(tag).trim()]), slug); }
    else if (action === 'delete') run('DELETE FROM routines WHERE slug=?', slug);
    else continue;
    n++;
  }
  logActivity(`bulk ${action}${tag ? ` #${tag}` : ''} · ${n} routine${n === 1 ? '' : 's'}`, 'idle');
  res.json({ ok: true, affected: n });
});
app.post('/api/routines/:slug/pin', (req, res) => {
  const r = one('SELECT pinned FROM routines WHERE slug=?', req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  const pinned = r.pinned ? 0 : 1;
  run('UPDATE routines SET pinned=? WHERE slug=?', pinned, req.params.slug);
  res.json({ ok: true, pinned: !!pinned });
});
app.post('/api/routines/:slug/clone', (req, res) => {
  const r = one('SELECT * FROM routines WHERE slug=?', req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  const body = exportBody(r);
  let slug = `${r.slug}-copy`; let n = 1;
  while (one('SELECT 1 FROM routines WHERE slug=?', slug)) { n++; slug = `${r.slug}-copy-${n}`; }
  insertRoutine({ ...body, name: `${body.name} (copy)`, slug });
  res.status(201).json(shapeRoutine(one('SELECT * FROM routines WHERE slug=?', slug)));
});
app.post('/api/routines/import', (req, res) => {
  const b = req.body || {};
  const body = b.routine && typeof b.routine === 'object' ? b.routine : b;
  const name = String(body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'bundle has no routine name' });
  let slug = String(b.slug || body.slug || slugify(name)).trim().replace(/[^a-z0-9_-]/gi, '');
  if (!slug) return res.status(400).json({ error: 'could not derive a slug' });
  if (one('SELECT 1 FROM routines WHERE slug=?', slug)) { let n = 2; while (one('SELECT 1 FROM routines WHERE slug=?', `${slug}-${n}`)) n++; slug = `${slug}-${n}`; }
  insertRoutine({ ...body, slug });
  res.status(201).json(shapeRoutine(one('SELECT * FROM routines WHERE slug=?', slug)));
});
app.post('/api/routines/:slug/validate', async (req, res) => {
  const r = one('SELECT * FROM routines WHERE slug=?', req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  const st = await integrationStatus();
  const tools = j(r.connectors);
  const checks = [
    { label: 'Identity', ok: !!r.name && !!r.slug, detail: `${r.name} · ${r.slug}.routine.md` },
    { label: 'Triggers', ok: j(r.triggers).length > 0, detail: j(r.triggers).join(', ') || 'no triggers — manual only' },
    { label: 'Instruction', ok: !!(r.prompt && r.prompt.trim().length > 12), detail: `${(r.prompt || '').length} chars` },
    { label: 'Model', ok: MODEL_IDS.includes(r.model), detail: MODEL_IDS.includes(r.model) ? `${MODELS.find((m) => m.id === r.model)?.label || r.model}${r.effort ? ` · ${r.effort} effort` : ''}` : `unknown model "${r.model}" — pick a valid one` },
  ];
  if (tools.includes('github')) checks.push({ label: 'Tool · gh', ok: st.github.connected, detail: st.github.connected ? `authed as @${st.github.account}` : 'gh not authed — run `gh auth login`' });
  if (tools.includes('slack')) checks.push({ label: 'Tool · slack-post', ok: st.slack.connected, detail: st.slack.connected ? `${st.slack.team} · @${st.slack.bot}` : 'SLACK_BOT_TOKEN not set' });
  if (tools.includes('web') || tools.includes('webfetch')) checks.push({ label: 'Tool · web', ok: true, detail: 'WebFetch / WebSearch' });
  if (tools.includes('team')) {
    const n = one('SELECT COUNT(*) AS n FROM agents').n;
    checks.push({ label: 'Tool · team', ok: n > 0, detail: n > 0 ? `delegate to ${n} agent${n > 1 ? 's' : ''} via agent-message` : 'no agents yet — add some on the Team page' });
  }
  // Custom MCP servers are real grants too (loaded via --mcp-config).
  const mcpSet = mcpNameSet();
  tools.filter((c) => mcpSet.has(c)).forEach((c) => checks.push({ label: `Tool · ${c}`, ok: true, detail: `custom MCP · mcp__${c}__*` }));
  // Flag only grants the runner truly can't provide.
  const known = new Set(['github', 'slack', 'web', 'webfetch', 'team']);
  const phantom = tools.filter((c) => !known.has(c) && !mcpSet.has(c));
  if (phantom.length) checks.push({ label: 'Tools', ok: false, detail: `not wired: ${phantom.join(', ')} — add it on the Connectors page, or remove it` });
  // Schedule cron must be present and parseable, else the routine silently never fires.
  if (j(r.triggers).includes('schedule')) {
    const parts = String(r.schedule || '').trim().split(/\s+/);
    const okCron = parts.length === 5 && parts.every((f) => /^[\d*,/?-]+$/.test(f));
    checks.push({ label: 'Schedule cron', ok: okCron, detail: r.schedule ? (okCron ? r.schedule : `"${r.schedule}" is not a valid 5-field cron`) : 'no cron set — will never fire' });
  }
  (j(r.chain)).forEach((c) => checks.push({ label: `Chain → ${c}`, ok: !!one('SELECT 1 FROM routines WHERE slug=?', c), detail: one('SELECT 1 FROM routines WHERE slug=?', c) ? 'resolves' : 'no such routine' }));
  res.json({ ok: checks.every((c) => c.ok), checks });
});

// Guardrails injected into EVERY session prompt as hard constraints (when on).
const DEFAULT_POLICIES = [
  { key: 'deny_merge', title: 'Never merge pull requests', desc: 'Every session is told to never run `gh pr merge` or any merge command.', on: true },
  { key: 'pr_not_push', title: 'Changes via pull request, not direct push', desc: 'Sessions must open a PR for changes instead of pushing to a protected branch.', on: true },
  { key: 'no_destructive', title: 'No destructive git/history ops', desc: 'Sessions must not force-push, delete branches, or rewrite history.', on: true },
];
function policyConstraints() {
  const saved = jObj(meta('policies', 'null')) || {};
  const on = (k) => (k in saved ? !!saved[k] : !!DEFAULT_POLICIES.find((p) => p.key === k)?.on);
  const c = [];
  if (on('deny_merge')) c.push('Never merge a pull request — do not run `gh pr merge` or any merge command.');
  if (on('pr_not_push')) c.push('Do not push directly to a protected or default branch; open a pull request for any change.');
  if (on('no_destructive')) c.push('Do not force-push, delete branches, or rewrite git history.');
  return c;
}
app.get('/api/settings', async (_q, res) => {
  const st = await integrationStatus();
  const claude = await claudeAccount();
  const saved = jObj(meta('policies', 'null'));
  const policies = DEFAULT_POLICIES.map((p) => ({ ...p, on: saved && p.key in saved ? !!saved[p.key] : p.on }));
  res.json({ identities: { ...st, claude }, policies });
});
app.post('/api/settings', (req, res) => {
  const policies = req.body?.policies || {};
  run("INSERT INTO meta (key,value) VALUES ('policies',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify(policies));
  res.json({ ok: true });
});

app.get('/api/runs', (_q, res) =>
  res.json(all('SELECT * FROM runs ORDER BY created_at DESC, ord DESC LIMIT 100').map((x) => {
    const r = one('SELECT name FROM routines WHERE slug=?', x.routine_slug);
    return { id: x.id, routineSlug: x.routine_slug, routineName: r?.name ?? x.routine_slug, status: x.status, ago: relTime(x.created_at), dur: x.dur, trigger: x.trigger };
  }))
);

// ── Agent teams: named agents that routines (and you) can hand tasks to ─────────
const agentSlug = (name) => `@${name}`;
function shapeAgent(a) {
  const last = one("SELECT status, trigger, created_at FROM runs WHERE routine_slug=? ORDER BY created_at DESC, ord DESC LIMIT 1", agentSlug(a.name));
  const working = last?.status === 'running';
  return {
    name: a.name, role: a.role, summary: a.summary, connectors: j(a.connectors), model: a.model, effort: a.effort || '', memory: !!a.memory, avColor: a.av_color,
    status: working ? 'working' : 'idle', currentTask: working ? last.trigger : null,
    lastActive: last ? relTime(last.created_at) : 'never',
    taskCount: one('SELECT COUNT(*) AS n FROM runs WHERE routine_slug=?', agentSlug(a.name)).n,
  };
}
// Give an agent a task — runs a real session (its role + recent history + the task),
// captured as a run under @name so the full trace works. Returns the run id.
function runAgentTask(a, text) {
  const history = all("SELECT trigger, output FROM runs WHERE routine_slug=? AND status!='running' ORDER BY created_at DESC, ord DESC LIMIT 4", agentSlug(a.name)).reverse();
  const hist = history.map((h) => `Earlier you were asked: "${h.trigger}"\n→ you reported: ${(h.output || '').slice(0, 400)}`).join('\n\n');
  const instruction = `You are ${a.name}, an agent on this team.\n${a.role || a.summary || ''}\n\n${hist ? `## Your recent work (for continuity)\n${hist}\n\n` : ''}## Request\n${text}`;
  const synthetic = {
    slug: agentSlug(a.name), name: a.name, summary: a.summary || a.role, owner: a.name, team: 'agents',
    prompt: instruction, connectors: a.connectors, model: a.model, memory: a.memory,
    repo: '', branch: 'main', chain: '[]', reactions: '[]', effort: a.effort || '', filters: '{}', concurrency: '{}',
    av_color: a.av_color, initials: (a.name[0] || 'A').toUpperCase(),
  };
  return executeRoutine(synthetic, { event: 'agent-message', from: 'user', task: text }, text.replace(/\s+/g, ' ').slice(0, 70) || 'task');
}
app.get('/api/agents', (_q, res) => res.json(all('SELECT * FROM agents ORDER BY created_at').map(shapeAgent)));
app.post('/api/agents', (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().replace(/[^a-z0-9_-]/gi, '');
  if (!name) return res.status(400).json({ error: 'an agent name (letters, digits, - or _) is required' });
  if (one('SELECT 1 FROM agents WHERE name=?', name)) return res.status(409).json({ error: `agent "${name}" already exists` });
  run('INSERT INTO agents (name,role,summary,connectors,model,effort,memory,av_color,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    name, (b.role || '').trim(), (b.summary || '').trim(),
    JSON.stringify(Array.isArray(b.connectors) ? b.connectors.filter(Boolean) : []),
    normModel(b.model), normEffort(b.effort), b.memory ? 1 : 0, ownerColor(name), now());
  res.status(201).json(shapeAgent(one('SELECT * FROM agents WHERE name=?', name)));
});
app.get('/api/agents/:name', (req, res) => {
  const a = one('SELECT * FROM agents WHERE name=?', req.params.name);
  if (!a) return res.status(404).json({ error: 'not found' });
  const tasks = all('SELECT * FROM runs WHERE routine_slug=? ORDER BY created_at DESC, ord DESC LIMIT 30', agentSlug(a.name))
    .map((x) => ({ id: x.id, task: x.trigger, status: x.status, ago: relTime(x.created_at), dur: x.dur, result: (x.output || '').split('\n').pop()?.slice(0, 160) || '' }));
  res.json({ ...shapeAgent(a), tasks });
});
app.post('/api/agents/:name/message', (req, res) => {
  if (meta('kill_switch', 'false') === 'true') return res.status(409).json({ error: 'kill switch engaged' });
  if (overBudget()) return res.status(409).json({ error: `daily budget $${budgetCap()} reached — dispatch paused` });
  const a = one('SELECT * FROM agents WHERE name=?', req.params.name);
  if (!a) return res.status(404).json({ error: 'not found' });
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'a message/task is required' });
  res.json({ ok: true, runId: runAgentTask(a, text) });
});
app.delete('/api/agents/:name', (req, res) => {
  run('DELETE FROM agents WHERE name=?', req.params.name);
  run('DELETE FROM runs WHERE routine_slug=?', agentSlug(req.params.name));
  res.json({ ok: true });
});

// Live trace stream (SSE): replays the captured steps, then pushes each new one as it
// happens and a final `done` — so the run page fills in with no polling lag.
app.get('/api/runs/:id/stream', (req, res) => {
  const id = req.params.id;
  const x = one('SELECT status FROM runs WHERE id=?', id);
  if (!x) return res.status(404).json({ error: 'not found' });
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders?.();
  const send = (m) => res.write(`data: ${JSON.stringify(m)}\n\n`);
  for (const e of all('SELECT * FROM run_events WHERE run_id=? ORDER BY seq', id)) {
    let pl; try { pl = JSON.parse(e.payload); } catch { pl = { d: e.payload }; }
    send({ kind: 'event', event: { seq: e.seq, t: fmtOffset(e.t_offset), ms: e.t_offset, type: e.type, tool: e.tool, ok: e.ok, text: pl.d, truncated: !!pl.truncated } });
  }
  if (['succeeded', 'failed', 'skipped', 'canceled'].includes(x.status)) { send({ kind: 'done', status: x.status }); return res.end(); }
  const ping = setInterval(() => res.write(':\n\n'), 25_000);
  const onMsg = (m) => { send(m); if (m.kind === 'done') { cleanup(); res.end(); } };
  const cleanup = () => { clearInterval(ping); runBus.off(id, onMsg); };
  runBus.on(id, onMsg);
  req.on('close', cleanup);
});
// The running agent's inbox — events coalesced onto this run's lease. POST claims them
// (the `inbox` tool), so the agent fetches new work before wrapping up.
const runLeaseKey = (x) => { const r = one('SELECT * FROM routines WHERE slug=?', x.routine_slug); return r ? leaseFor(r, jObj(x.event) || {}).key : null; };
// Reproducibility: re-execute a run with its EXACT original event payload.
app.post('/api/runs/:id/replay', (req, res) => {
  const x = one('SELECT * FROM runs WHERE id=?', req.params.id);
  if (!x) return res.status(404).json({ error: 'not found' });
  const r = one('SELECT * FROM routines WHERE slug=?', x.routine_slug);
  if (!r) return res.status(404).json({ error: 'routine no longer exists' });
  if (meta('kill_switch', 'false') === 'true') return res.status(409).json({ error: 'kill switch engaged' });
  if (overBudget()) return res.status(409).json({ error: `daily budget $${budgetCap()} reached — dispatch paused` });
  const ev = jObj(x.event) || {};
  delete ev._attempt; delete ev._recompile;
  const runId = executeRoutine(r, { ...ev, _replay: true, upstream: { routine: r.slug, run: x.id } }, `replay · ${x.id}`);
  res.json({ ok: true, runId });
});
// Re-run with an EDITED event payload — reproduce with tweaks (vs replay's verbatim).
app.post('/api/runs/:id/rerun', (req, res) => {
  const x = one('SELECT * FROM runs WHERE id=?', req.params.id);
  if (!x) return res.status(404).json({ error: 'not found' });
  const r = one('SELECT * FROM routines WHERE slug=?', x.routine_slug);
  if (!r) return res.status(404).json({ error: 'routine no longer exists' });
  if (meta('kill_switch', 'false') === 'true') return res.status(409).json({ error: 'kill switch engaged' });
  if (overBudget()) return res.status(409).json({ error: `daily budget $${budgetCap()} reached — dispatch paused` });
  let ev;
  try { ev = req.body?.event && typeof req.body.event === 'object' ? req.body.event : JSON.parse(req.body?.event || '{}'); }
  catch { return res.status(400).json({ error: 'event is not valid JSON' }); }
  delete ev._attempt; delete ev._recompile; delete ev._replay;
  const runId = executeRoutine(r, { ...ev, _rerun: true, upstream: { routine: r.slug, run: x.id } }, `edited rerun · ${x.id}`);
  res.json({ ok: true, runId });
});
// Cancel a running run: kill its live session, mark it failed, free its lease.
app.post('/api/runs/:id/cancel', (req, res) => {
  const x = one('SELECT * FROM runs WHERE id=?', req.params.id);
  if (!x) return res.status(404).json({ error: 'not found' });
  if (!['running', 'waiting'].includes(x.status)) return res.status(409).json({ error: `run is ${x.status}, not running` });
  canceledRuns.add(x.id);
  const child = liveChildren.get(x.id);
  if (child) { try { child.kill('SIGKILL'); } catch { /* already gone */ } liveChildren.delete(x.id); }
  run("UPDATE runs SET status='failed', dur='—', output=? WHERE id=?", 'canceled by user', x.id);
  run('DELETE FROM leases WHERE run_id=?', x.id);
  run("UPDATE routines SET state='idle', last_status='failing' WHERE slug=? AND state='running'", x.routine_slug);
  logActivity(`${x.routine_slug} run ${x.id} canceled`, 'failing');
  res.json({ ok: true, killed: !!child });
});
app.post('/api/runs/:id/inbox', (req, res) => {
  const x = one('SELECT * FROM runs WHERE id=?', req.params.id);
  if (!x) return res.status(404).json({ error: 'not found' });
  const key = runLeaseKey(x);
  const pend = key ? pendingTasks(x.routine_slug, key) : [];
  claimTasks(pend.map((t) => t.id), x.id);
  res.json({ key, tasks: pend.map((t) => ({ id: t.id, summary: t.summary, event: jObj(t.payload) })) });
});
app.get('/api/runs/:id', (req, res) => {
  const x = one('SELECT * FROM runs WHERE id=?', req.params.id);
  if (!x) return res.status(404).json({ error: 'not found' });
  const r = one('SELECT * FROM routines WHERE slug=?', x.routine_slug);
  const running = x.status === 'running';
  const ok = x.status === 'succeeded';
  const tools = j(r?.connectors);

  // Real step-level trace, straight from the captured stream-json events.
  const evts = all('SELECT * FROM run_events WHERE run_id=? ORDER BY seq', x.id);
  const trace = evts.map((e) => {
    let pl; try { pl = JSON.parse(e.payload); } catch { pl = { d: e.payload, truncated: false }; }
    return { seq: e.seq, t: fmtOffset(e.t_offset), ms: e.t_offset, type: e.type, tool: e.tool, ok: e.ok, text: pl.d, truncated: !!pl.truncated };
  });

  // Lineage: who kicked this run off, and what it kicked off (chains + reactions).
  const ev = jObj(x.event) || {};
  const kindOf = (trig) => (String(trig).startsWith('reaction') ? 'reaction' : String(trig).startsWith('after') ? 'chain' : String(trig).startsWith('replay') ? 'replay' : String(trig).startsWith('edited rerun') ? 'replay' : 'trigger');
  const triggeredBy = ev.upstream?.run ? { runId: ev.upstream.run, routine: ev.upstream.routine, kind: kindOf(x.trigger) } : null;
  const downstream = all('SELECT id, routine_slug, trigger, status, dur, event FROM runs WHERE id != ? AND event LIKE ? ORDER BY created_at', x.id, `%${x.id}%`)
    .filter((d) => (jObj(d.event)?.upstream?.run) === x.id)
    .map((d) => ({ runId: d.id, routine: d.routine_slug, status: d.status, dur: d.dur, kind: kindOf(d.trigger) }));
  const watches = all("SELECT * FROM watches WHERE origin_run=? ORDER BY created_at", x.id)
    .map((w) => ({ target: w.target_slug, source: w.source, kind: w.kind, when: w.when_cond, status: w.status, detail: w.detail }));
  // Inbox: tasks coalesced onto this run's lease (claimed by it, or still pending on its key).
  const lkey = runLeaseKey(x);
  const inbox = lkey
    ? all("SELECT * FROM run_tasks WHERE routine_slug=? AND lease_key=? AND (handled_by=? OR handled_by='') ORDER BY created_at", x.routine_slug, lkey, x.id)
        .map((t) => ({ summary: t.summary, ago: relTime(t.created_at), pending: !t.handled_by }))
    : [];

  const toolBreakdown = all("SELECT tool, SUM(CASE WHEN type='tool_use' THEN 1 ELSE 0 END) AS calls, SUM(CASE WHEN type='tool_result' AND ok=0 THEN 1 ELSE 0 END) AS errors FROM run_events WHERE run_id=? AND tool IS NOT NULL AND tool != '' GROUP BY tool ORDER BY calls DESC", x.id)
    .map((t) => ({ tool: t.tool, calls: t.calls, errors: t.errors })).filter((t) => t.calls > 0 || t.errors > 0);
  res.json({
    id: x.id, routine: x.routine_slug, status: x.status, trigger: x.trigger, triggerKind: kindOf(x.trigger),
    started: new Date(x.created_at).toLocaleTimeString(), elapsed: x.dur, model: r?.model || 'claude',
    cost: x.cost_usd, turns: x.num_turns, sessionId: x.session_id,
    inTokens: x.in_tokens ?? null, outTokens: x.out_tokens ?? null,
    matchExplain: r && ev ? explainMatch(r, ev) : null,
    stdout: x.output, event: ev, trace, inbox, toolBreakdown,
    assertResult: jObj(x.assert_result) || null,
    lineage: { triggeredBy, downstream, watches },
    awaiting: running ? 'auto-mode session running…' : null,
    summary: {
      result: running ? 'Running…' : ok ? (x.output.split('\n').pop()?.slice(0, 80) || 'Completed') : 'Failed',
      surface: tools.join(', ') || 'session',
    },
  });
});

// Connectors reflect REAL integration status (gh + Slack), live.
app.get('/api/connectors', async (_q, res) => {
  const st = await integrationStatus();
  const rows = all('SELECT connectors FROM routines WHERE enabled=1');
  const uses = (key) => rows.filter((r) => j(r.connectors).includes(key)).length;
  // 7-day usage attributed to a connector via the routines that grant it.
  const since7 = now() - 7 * 86_400_000;
  const runAgg = {};
  for (const x of all('SELECT routine_slug, cost_usd FROM runs WHERE created_at > ?', since7)) { const e = (runAgg[x.routine_slug] ||= { runs: 0, cost: 0 }); e.runs++; e.cost += x.cost_usd || 0; }
  const allR = all('SELECT slug, connectors FROM routines');
  const usageFor = (key) => { let runs = 0, cost = 0; for (const r of allR) { if (j(r.connectors).includes(key)) { const a = runAgg[r.slug]; if (a) { runs += a.runs; cost += a.cost; } } } return { runs7d: runs, cost7d: +cost.toFixed(2) }; };
  const out = [
    { code: 'GH', name: 'GitHub', kind: 'CLI · gh', health: st.github.connected ? 'ok' : 'off', auth: st.github.connected ? `gh · @${st.github.account}` : 'run `gh auth login`', scopes: 'read/write PRs, issues, checks, gists', routines: uses('github'), ...usageFor('github'), avColor: '#7f9bd1', testable: true, configKey: '' },
    { code: 'SL', name: 'Slack', kind: 'Bot', health: st.slack.connected ? 'ok' : 'off', auth: st.slack.connected ? `${st.slack.team} · @${st.slack.bot}` : 'set a bot token', scopes: 'post messages via slack-post', routines: uses('slack'), ...usageFor('slack'), avColor: '#c9a24a', testable: true, configKey: 'slack' },
    { code: 'WB', name: 'Web fetch', kind: 'Built-in', health: 'ok', auth: 'no auth needed', scopes: 'fetch & read public URLs', routines: uses('web'), ...usageFor('web'), avColor: '#8aa0b8', testable: true, configKey: '' },
    { code: 'AT', name: 'Atlassian / Confluence', kind: 'API · planned', health: process.env.ATLASSIAN_API_TOKEN ? 'ok' : 'off', auth: process.env.ATLASSIAN_API_TOKEN ? 'token set' : 'set an API token', scopes: 'publish to Confluence (not yet a granted tool)', routines: uses('confluence'), ...usageFor('confluence'), avColor: '#6fae9a', testable: true, configKey: 'atlassian' },
  ];
  for (const s of all('SELECT name, config, auth FROM mcp_servers ORDER BY name')) {
    const cfg = jObj(s.config) || {};
    const authed = !!(jObj(s.auth) || {}).token;
    const remote = isMcpRemote(cfg);
    const transport = remote ? `remote · ${mcpRemoteUrl(cfg)}` : cfg.command ? `stdio · ${cfg.command}` : cfg.url ? `http · ${cfg.url}` : 'custom MCP';
    out.push({ code: s.name, name: s.name, kind: remote ? 'MCP · remote' : 'MCP', health: 'ok', auth: `${transport}${authed ? ' · 🔑 token' : ''}`, scopes: `mcp__${s.name}__*`, routines: uses(s.name), ...usageFor(s.name), avColor: '#b49ae6', testable: true, configKey: '', mcp: true, authed, remote });
  }
  res.json(out);
});

// Live connectivity test for a connector (gh user / slack / web / atlassian / MCP server).
app.post('/api/connectors/:code/test', async (req, res) => {
  if (mcpNameSet().has(req.params.code)) return res.json(await testMcp(req.params.code));
  res.json(await testConnector(req.params.code, req.body || {}));
});
// Custom MCP servers — drop in a config + auth (env/headers); routines grant them by name.
app.get('/api/mcp', (_q, res) => res.json(all('SELECT * FROM mcp_servers ORDER BY name').map((s) => {
  const auth = jObj(s.auth) || {};
  const cfg = jObj(s.config) || {};
  return { name: s.name, config: maskConfig(cfg), remote: isMcpRemote(cfg), url: mcpRemoteUrl(cfg), auth: { configured: !!auth.token, scheme: auth.scheme || 'bearer', header: auth.header || '' } };
})));
// Authenticate an MCP server — store a bearer token / API key, injected at runtime
// into the server's headers (http) or env (stdio). Masked in all responses.
app.post('/api/mcp/:name/auth', (req, res) => {
  if (!one('SELECT 1 FROM mcp_servers WHERE name=?', req.params.name)) return res.status(404).json({ error: 'not found' });
  const token = String(req.body?.token || '').trim();
  const scheme = ['bearer', 'raw'].includes(req.body?.scheme) ? req.body.scheme : 'bearer';
  const header = String(req.body?.header || '').trim();
  run('UPDATE mcp_servers SET auth=? WHERE name=?', JSON.stringify(token ? { scheme, header, token } : {}), req.params.name);
  res.json({ ok: true, configured: !!token });
});
app.post('/api/mcp', (req, res) => {
  const b = req.body || {};
  // Remote mode: just a URL → wrapped with mcp-remote (handles OAuth + token auth).
  if (b.remote && b.url) {
    let url; try { url = new URL(String(b.url).trim()).toString(); } catch { return res.status(400).json({ error: 'enter a valid https URL' }); }
    const host = new URL(url).hostname.split('.');
    const sld = host.length >= 2 ? host[host.length - 2] : host[0]; // mcp.betterstack.com → betterstack
    const name = (String(b.name || '').trim() || sld).replace(/[^a-z0-9_-]/gi, '');
    if (!name) return res.status(400).json({ error: 'a server name is required' });
    run("INSERT INTO mcp_servers (name,config,created_at) VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET config=excluded.config", name, JSON.stringify(mcpRemoteDef(url)), now());
    return res.json({ ok: true, name, remote: true });
  }
  let parsed;
  try { parsed = normalizeMcp(String(b.name || '').trim(), b.config); } catch { return res.status(400).json({ error: 'config must be valid JSON' }); }
  const name = String(parsed.name || '').trim().replace(/[^a-z0-9_-]/gi, '');
  if (!name) return res.status(400).json({ error: 'a server name is required — type one, or paste a { "name": { … } } config' });
  if (!isDef(parsed.def)) return res.status(400).json({ error: 'config needs a "command" (stdio) or a "url" (http/sse)' });
  run("INSERT INTO mcp_servers (name,config,created_at) VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET config=excluded.config", name, JSON.stringify(parsed.def), now());
  res.json({ ok: true, name });
});
// MCP Registry (registry.modelcontextprotocol.io) — search & add servers without
// hand-pasting JSON. Adding uses the registry's canonical URL/package (no typo-spoof
// surface); remote OAuth issuer is validated downstream by mcp-remote per RFC 9207.
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
      if (!s.name || seen.has(s.name)) continue; seen.add(s.name); // one entry per server (newest first)
      const remote = (s.remotes || [])[0];
      const pkg = (s.packages || []).find((p) => RUNTIME_CMD[p.runtimeHint]) || (s.packages || [])[0];
      if (!remote && !(pkg && RUNTIME_CMD[pkg.runtimeHint])) continue; // skip un-runnable here
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
  run("INSERT INTO mcp_servers (name,config,created_at) VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET config=excluded.config", name, JSON.stringify(def), now());
  res.json({ ok: true, name, remote: !!b.remoteUrl });
});
// Kick off the mcp-remote OAuth flow. We run it with piped output, watch for the
// "Please authorize…" URL (or a connect/error), and hand the URL back to the UI so the
// user can click it — far more reliable than auto-opening a browser from a headless
// server. mcp-remote keeps running to catch the callback and saves the token to ~/.mcp-auth.
const authProcs = new Map();
app.post('/api/mcp/:name/oauth', (req, res) => {
  const name = req.params.name;
  const row = one('SELECT config FROM mcp_servers WHERE name=?', name);
  if (!row) return res.status(404).json({ error: 'not found' });
  const url = mcpRemoteUrl(jObj(row.config) || {});
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
  setTimeout(kill, 5 * 60_000); // don't leave the auth proxy running forever
});
app.delete('/api/mcp/:name', (req, res) => { run('DELETE FROM mcp_servers WHERE name=?', req.params.name); res.json({ ok: true }); });
// Configure a connector's token (slack/atlassian) — stored in meta, loaded into env now.
app.post('/api/connectors/:code/config', (req, res) => {
  const code = String(req.params.code || '').toLowerCase();
  const envKey = TOKEN_ENV[code];
  if (!envKey) return res.status(400).json({ error: 'this connector has no configurable token' });
  const token = String(req.body?.token || '').trim();
  if (token) { run("INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", `token_${code}`, token); process.env[envKey] = token; }
  else { run('DELETE FROM meta WHERE key=?', `token_${code}`); if (ENV_BASE[envKey]) process.env[envKey] = ENV_BASE[envKey]; else delete process.env[envKey]; }
  bustStatus();
  res.json({ ok: true, configured: !!token });
});

app.get('/api/activity', (_q, res) =>
  res.json(all('SELECT * FROM activity ORDER BY ord DESC LIMIT 40').map((a) => ({ time: a.time, text: a.text, state: a.state })))
);

const shapeWatch = (w) => ({
  id: w.id, origin: w.origin_routine, target: w.target_slug, source: w.source, kind: w.kind, when: w.when_cond,
  entity: jObj(w.entity) || {}, status: w.status, detail: w.detail, attempts: w.attempts, ago: relTime(w.created_at),
});
app.get('/api/watches', (_q, res) =>
  res.json(all('SELECT * FROM watches ORDER BY created_at DESC LIMIT 100').map(shapeWatch))
);

app.post('/api/routines/:slug/enable', (req, res) => {
  const r = one('SELECT * FROM routines WHERE slug=?', req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  const en = req.body?.enabled ? 1 : 0;
  run('UPDATE routines SET enabled=?, state=? WHERE slug=?', en, en ? (r.state === 'disabled' ? 'idle' : r.state) : 'disabled', r.slug);
  res.json({ ok: true, enabled: !!en });
});

app.post('/api/routines/:slug/dispatch', (req, res) => {
  const r = one('SELECT * FROM routines WHERE slug=?', req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  if (meta('kill_switch', 'false') === 'true') return res.status(409).json({ error: 'kill switch engaged' });
  if (overBudget()) return res.status(409).json({ error: `daily budget $${budgetCap()} reached — dispatch paused` });
  const event = req.body?.event ?? { event: 'manual', routine: r.slug, dispatched_at: new Date().toISOString() };
  res.json({ ok: true, runId: executeRoutine(r, event, 'manual'), status: 'running' });
});
// Metric history: the (numeric) value each successful run produced, over time.
app.get('/api/routines/:slug/metric', (req, res) => {
  if (!one('SELECT 1 FROM routines WHERE slug=?', req.params.slug)) return res.status(404).json({ error: 'not found' });
  const n = Math.min(120, Math.max(2, parseInt(req.query.n, 10) || 30));
  const rows = all("SELECT id, output, cost_usd, created_at FROM runs WHERE routine_slug=? AND status='succeeded' ORDER BY created_at DESC LIMIT ?", req.params.slug, n).reverse();
  const points = rows.map((x) => {
    const m = String(x.output || '').match(/-?\d[\d,]*\.?\d*/);
    return { runId: x.id, at: x.created_at, ago: relTime(x.created_at), value: m ? Number(m[0].replace(/,/g, '')) : null, raw: String(x.output || '').replace(/\s+/g, ' ').slice(0, 80) };
  });
  const nums = points.filter((p) => p.value != null);
  res.json({ points, numeric: nums.length >= 2, latest: points.length ? points[points.length - 1] : null });
});
// Rebuild a script routine's extractor: an agent run that recompiles the script.
app.post('/api/routines/:slug/recompile', (req, res) => {
  const r = one('SELECT * FROM routines WHERE slug=?', req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  if (!r.script_mode) return res.status(400).json({ error: 'not a script routine' });
  run("UPDATE routines SET script_stale=1 WHERE slug=?", r.slug);
  // Keep the current script as the basis — the compile prompt revises it.
  const runId = executeRoutine({ ...r, script_stale: 1 }, { event: 'recompile', _recompile: true, routine: r.slug }, 'recompile');
  res.json({ ok: true, runId });
});

// Idempotency: GitHub retries the same delivery id on timeout — drop repeats within 10m.
const _recentDeliveries = new Map();
function isDuplicateDelivery(key) {
  if (!key) return false;
  const prev = _recentDeliveries.get(key);
  _recentDeliveries.set(key, now());
  if (_recentDeliveries.size > 1000) for (const [k, v] of _recentDeliveries) if (now() - v > 600_000) _recentDeliveries.delete(k);
  return prev != null && now() - prev < 600_000;
}
// Recent inbound deliveries (webhook + API ingress) — a debug log of what arrived.
const deliveryLog = [];
function logDelivery(type, event, matched, source) {
  deliveryLog.unshift({ at: now(), source, type, repo: eventRepo(event) || '', action: event?.action || '', pr: event?.pull_request?.number ?? event?.number ?? null, labels: labelsOf(event), matched: matched || [] });
  if (deliveryLog.length > 60) deliveryLog.pop();
}
app.get('/api/webhooks/deliveries', (_q, res) => res.json({ deliveries: deliveryLog.map((d) => ({ ...d, ago: relTime(d.at) })) }));

// Generic event ingress — any trigger type. POST /api/events/push, /pull_request, etc.
app.post('/api/events/:type', (req, res) => {
  const type = req.params.type;
  const payload = type === 'push' && (!req.body || !Object.keys(req.body).length) ? SAMPLE_PUSH() : req.body;
  const out = dispatchEvent(type, payload);
  logDelivery(type, payload, out.matched, 'api');
  if (out.error) return res.status(409).json(out);
  res.json(out);
});

// Real GitHub webhook receiver — dispatches by the X-GitHub-Event header.
app.post('/api/webhooks/github', (req, res) => {
  if (!githubSignatureValid(req)) return res.status(401).json({ error: 'invalid webhook signature' });
  const type = req.get('x-github-event') || 'push';
  if (type === 'ping') { logDelivery('ping', {}, [], 'webhook'); return res.json({ ok: true, pong: true }); }
  const deliveryId = req.get('x-github-delivery') || '';
  if (isDuplicateDelivery(deliveryId)) {
    logDelivery(type, req.body || {}, [], 'webhook·dup');
    logActivity(`webhook ${type} ${deliveryId.slice(0, 8)} dropped · duplicate delivery`, 'idle');
    return res.json({ ok: true, duplicate: true });
  }
  const out = dispatchEvent(type, req.body || {});
  logDelivery(type, req.body || {}, out.matched, 'webhook');
  if (out.error) return res.status(409).json(out);
  res.json({ ok: true, ...out });
});

// ── GitHub webhook setup: secret, public URL (cloudflared tunnel), per-repo hooks ──
// The GitHub events we subscribe to, mapped to our trigger types.
const HOOK_EVENTS = ['pull_request', 'pull_request_review', 'issue_comment', 'issues', 'push', 'check_run', 'check_suite', 'status', 'deployment_status', 'workflow_run', 'release'];
const receiverUrl = () => { const base = meta('webhook_public_url', ''); return base ? base.replace(/\/$/, '') + '/api/webhooks/github' : ''; };
let tunnelProc = null; let tunnelUrl = '';

app.get('/api/webhooks/config', (_q, res) => res.json({
  publicUrl: meta('webhook_public_url', ''),
  receiverUrl: receiverUrl(),
  secretSet: !!(process.env.GITHUB_WEBHOOK_SECRET || meta('webhook_secret', '')),
  events: HOOK_EVENTS,
  tunnel: { available: true, running: !!tunnelProc, url: tunnelUrl }, // cloudflared presence checked on start
}));
app.post('/api/webhooks/config', (req, res) => {
  const url = String(req.body?.publicUrl || '').trim().replace(/\/$/, '');
  if (url) { try { new URL(url); } catch { return res.status(400).json({ error: 'invalid URL' }); } }
  setMeta('webhook_public_url', url);
  res.json({ ok: true, publicUrl: url, receiverUrl: receiverUrl() });
});
app.post('/api/webhooks/secret', (_q, res) => {
  const secret = crypto.randomBytes(24).toString('hex');
  setMeta('webhook_secret', secret);
  process.env.GITHUB_WEBHOOK_SECRET = secret;
  res.json({ ok: true, secretSet: true }); // never returns the secret
});

// Quick public URL via cloudflared (no account needed) → auto-fills publicUrl.
app.post('/api/webhooks/tunnel/start', (req, res) => {
  if (tunnelProc) return res.json({ ok: true, url: tunnelUrl, already: true });
  let child;
  try { child = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`], { env: process.env }); }
  catch (e) { return res.status(500).json({ error: `couldn't start cloudflared: ${e.message}` }); }
  tunnelProc = child; tunnelUrl = '';
  let done = false;
  const finish = (payload, code) => { if (done) return; done = true; clearTimeout(timer); res.status(code || 200).json(payload); };
  const scan = (d) => {
    const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !tunnelUrl) { tunnelUrl = m[0]; setMeta('webhook_public_url', tunnelUrl); finish({ ok: true, url: tunnelUrl, receiverUrl: receiverUrl() }); }
  };
  child.stdout.on('data', scan); child.stderr.on('data', scan);
  child.on('error', (e) => { tunnelProc = null; finish({ error: `cloudflared failed: ${e.message}` }, 500); });
  child.on('exit', () => { if (tunnelProc === child) { tunnelProc = null; tunnelUrl = ''; } if (!done) finish({ error: 'cloudflared exited before a URL appeared' }, 500); });
  const timer = setTimeout(() => finish({ error: 'cloudflared did not produce a URL in time' }, 504), 20_000);
});
app.post('/api/webhooks/tunnel/stop', (_q, res) => {
  if (tunnelProc) { try { tunnelProc.kill(); } catch { /* ignore */ } tunnelProc = null; tunnelUrl = ''; }
  res.json({ ok: true });
});

// Per-repo hooks via gh (needs the repo scope, which admins repo webhooks).
app.get('/api/webhooks/hooks', async (req, res) => {
  const repo = String(req.query.repo || '').trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return res.status(400).json({ error: 'repo must be owner/name' });
  const r = await gh(['api', `repos/${repo}/hooks`]);
  if (r.code !== 0) return res.status(502).json({ error: r.err || 'gh failed' });
  let hooks; try { hooks = JSON.parse(r.out); } catch { hooks = []; }
  const mine = receiverUrl();
  res.json({ hooks: hooks.map((h) => ({ id: h.id, url: h.config?.url, active: h.active, events: h.events, ours: h.config?.url === mine })) });
});
app.post('/api/webhooks/setup', async (req, res) => {
  const repo = String(req.body?.repo || '').trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return res.status(400).json({ error: 'repo must be owner/name' });
  const url = receiverUrl();
  if (!url) return res.status(400).json({ error: 'set a public URL (or start the tunnel) first' });
  let secret = process.env.GITHUB_WEBHOOK_SECRET || meta('webhook_secret', '');
  if (!secret) { secret = crypto.randomBytes(24).toString('hex'); setMeta('webhook_secret', secret); process.env.GITHUB_WEBHOOK_SECRET = secret; }
  const args = ['api', `repos/${repo}/hooks`, '--method', 'POST', '-f', 'name=web', '-F', 'active=true',
    '-f', `config[url]=${url}`, '-f', 'config[content_type]=json', '-f', `config[secret]=${secret}`,
    ...HOOK_EVENTS.flatMap((e) => ['-f', `events[]=${e}`])];
  const r = await gh(args);
  if (r.code !== 0) {
    const dup = /already exists|Hook already/i.test(r.err || '');
    return res.status(dup ? 409 : 502).json({ error: dup ? 'a webhook for this URL already exists on the repo' : (r.err || 'gh failed').slice(0, 300) });
  }
  let hook; try { hook = JSON.parse(r.out); } catch { hook = {}; }
  logActivity(`webhook installed on ${repo} → ${url}`, 'success');
  res.json({ ok: true, id: hook.id, url, events: HOOK_EVENTS });
});
app.delete('/api/webhooks/hooks', async (req, res) => {
  const repo = String(req.body?.repo || req.query.repo || '').trim();
  const id = String(req.body?.id || req.query.id || '').trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^\d+$/.test(id)) return res.status(400).json({ error: 'repo (owner/name) + numeric id required' });
  const r = await gh(['api', `repos/${repo}/hooks/${id}`, '--method', 'DELETE']);
  if (r.code !== 0) return res.status(502).json({ error: r.err || 'gh failed' });
  res.json({ ok: true });
});

function SAMPLE_PUSH() {
  return {
    event: 'push',
    repository: 'fabioelia/harness-this-shit',
    ref: 'refs/heads/feat/oauth-login',
    pusher: 'fabio',
    head_commit: { id: 'a1b9f3c', message: 'wire up the OAuth callback handler' },
    pull_request: { number: 42, title: 'Add OAuth login flow', state: 'open', base: 'main' },
  };
}

app.post('/api/kill-switch', (req, res) => {
  const engaged = !!req.body?.engaged;
  run("UPDATE meta SET value=? WHERE key='kill_switch'", engaged ? 'true' : 'false');
  res.json({ killSwitch: engaged });
});

app.listen(PORT, () => console.log(`Switchboard API on http://localhost:${PORT} · gh:${process.env.PATH ? 'path-ok' : '?'} · slack:${process.env.SLACK_BOT_TOKEN ? 'token' : 'none'}`));
