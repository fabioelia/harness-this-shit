import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { getDb, all, one, run } from './db.js';
import { runClaude, buildPrompt } from './runner.js';
import { integrationStatus, listRepos, listOrgs, listChecks, claudeAccount, testConnector, bustStatus, gh } from './integrations.js';

const app = express();
// Same-machine tool: only allow the local web origin to call the API from a browser.
app.use(cors({ origin: [/^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/] }));
app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
getDb();

// Verify a GitHub webhook HMAC (X-Hub-Signature-256) when a secret is configured.
function githubSignatureValid(req) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return true; // not configured → accept (local/dev)
  const sig = req.get('x-hub-signature-256') || '';
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody || Buffer.from('')).digest('hex');
  try { return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); }
  catch { return false; }
}

const PORT = process.env.PORT || 4317;
const j = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } };
const jObj = (s) => { try { return JSON.parse(s); } catch { return null; } };
const meta = (k, d) => one('SELECT value FROM meta WHERE key=?', k)?.value ?? d;
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
// Normalize whatever the user pasted into a single server def.
function normalizeMcpDef(name, cfg) {
  if (typeof cfg === 'string') cfg = JSON.parse(cfg);
  if (cfg && cfg.mcpServers && typeof cfg.mcpServers === 'object') { const k = Object.keys(cfg.mcpServers)[0]; cfg = cfg.mcpServers[k]; }
  else if (cfg && cfg[name] && (cfg[name].command || cfg[name].url)) cfg = cfg[name];
  return cfg;
}
// Write an --mcp-config file for the granted MCP server names; null if none configured.
function writeMcpConfig(grantedNames) {
  const set = mcpNameSet();
  const names = [...new Set((grantedNames || []).filter((n) => set.has(n)))];
  if (!names.length) return null;
  const mcpServers = {};
  for (const n of names) { const row = one('SELECT config FROM mcp_servers WHERE name=?', n); if (row) mcpServers[n] = jObj(row.config) || {}; }
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
  return { actions: arr(o.actions), branches: arr(o.branches) };
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
    model: r.model, effort: r.effort || '', memory: !!r.memory, repo: r.repo, branch: r.branch,
    state: r.enabled ? r.state : 'disabled', enabled: !!r.enabled,
    lastAgo: r.last_ago, lastStatus: r.last_status, next: r.next,
    recent, successRate, spend: r.spend, avg: r.avg, runCount: recent.length,
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

// ── Execution: build prompt → run an auto-mode session → capture trace → chain ─
function executeRoutine(r, rawEvent, triggerLabel) {
  const id = runId();
  const created = now();
  const ord = (one('SELECT MAX(ord) AS m FROM runs').m ?? -1) + 1;
  run(`INSERT INTO runs (id,routine_slug,status,ago,dur,trigger,ord,output,event,created_at,sinks_result)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id, r.slug, 'running', 'now', '…', triggerLabel, ord, '', JSON.stringify(rawEvent ?? {}), created, '[]');
  run('UPDATE routines SET state=?, last_ago=?, last_status=? WHERE slug=?', 'running', 'now', 'running', r.slug);

  (async () => {
    // The session is autonomous: it gets the natural instruction + the raw event +
    // its granted tools, and does the work itself (gh, slack-post, web…) — the harness
    // only routes, captures the trace, and enforces guardrails.
    const tools = j(r.connectors);
    const memoryDir = r.memory ? ensureMemory(r.slug) : null;
    const mcpGranted = tools.filter((c) => !['github', 'slack', 'web', 'webfetch'].includes(c));
    const mcpConfig = mcpGranted.length ? writeMcpConfig(mcpGranted) : null;
    const prompt = buildPrompt({ ...r, connectors: tools }, rawEvent ?? {}, policyConstraints(), { memoryDir });
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
      run('INSERT INTO run_events (run_id,seq,t_offset,type,tool,ok,payload) VALUES (?,?,?,?,?,?,?)',
        id, seq++, now() - t0, type, tool ?? null, ok == null ? null : (ok ? 1 : 0), JSON.stringify({ d: p, truncated }));
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

    const res = await runClaude(prompt, { tools, onEvent, model: normModel(r.model), effort: normEffort(r.effort), memoryDir, mcpConfig });
    if (mcpConfig) try { unlinkSync(mcpConfig); } catch { /* ignore */ }
    const ok = !res.isError && !!res.finalText;
    const rawOut = ok ? res.finalText
      : (res.finalText || (res.code === 124 ? `timed out after ${Math.round(res.ms / 1000)}s` : res.stderr || `claude exited ${res.code}`));
    const output = redact(rawOut); // never persist/log unredacted session output

    run('UPDATE runs SET status=?, dur=?, dur_ms=?, output=?, cost_usd=?, num_turns=?, session_id=? WHERE id=?',
      ok ? 'succeeded' : 'failed', fmtDur(res.ms), res.ms, output, res.costUsd, res.numTurns, res.sessionId, id);
    // Roll up real spend + avg duration onto the routine.
    const agg = one('SELECT COALESCE(SUM(cost_usd),0) AS spend, AVG(dur_ms) AS avgms FROM runs WHERE routine_slug=?', r.slug);
    run('UPDATE routines SET state=?, last_ago=?, last_status=?, success=?, spend=?, avg=? WHERE slug=?',
      'idle', 'just now', ok ? 'success' : 'failing', ok ? 100 : 0,
      `$${Number(agg.spend || 0).toFixed(2)}`, agg.avgms ? fmtDur(agg.avgms) : '—', r.slug);
    logActivity(`${r.slug} ${ok ? 'ran · ' + output.split('\n').pop().slice(0, 60) : 'failed'} · ${triggerLabel}`, ok ? 'success' : 'failing');

    // reactions: arm watches on the entity this run touched (PR checks/review/merge, timeout…)
    try { await armReactions(r, rawEvent ?? {}, id); } catch (e) { logActivity(`reactions error · ${r.slug}: ${e.message}`, 'failing'); }

    // chain: kick off downstream routines, guarding against cycles + runaway depth.
    if (ok) {
      const path = Array.isArray(rawEvent?._chainPath) ? rawEvent._chainPath : [];
      const nextPath = [...path, r.slug];
      if (nextPath.length > 8) {
        logActivity(`chain stopped · max depth (8) reached at ${r.slug}`, 'idle');
      } else {
        for (const slug of j(r.chain)) {
          if (nextPath.includes(slug)) { logActivity(`chain stopped · cycle back to ${slug}`, 'idle'); continue; }
          const dr = one('SELECT * FROM routines WHERE slug=? AND enabled=1', slug);
          if (dr) executeRoutine(dr, { ...(rawEvent ?? {}), _chainPath: nextPath, upstream: { routine: r.slug, output } }, `after · ${r.slug}`);
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
function filtersMatch(r, event) {
  let f; try { f = JSON.parse(r.filters || '{}'); } catch { f = {}; }
  const actions = Array.isArray(f.actions) ? f.actions : [];
  const branches = Array.isArray(f.branches) ? f.branches : [];
  if (actions.length) {
    // Match against the event's action OR a CI conclusion/state (so "success"/"failure"
    // work for check_run/workflow_run/status/deployment, and "approved" for reviews).
    const vals = eventStates(event);
    if (vals.length && !vals.some((v) => actions.includes(v))) return false;
  }
  if (branches.length) { const br = branchOf(event); if (br && !branches.includes(br)) return false; }
  return true;
}

function dispatchEvent(type, payload) {
  if (meta('kill_switch', 'false') === 'true') {
    logActivity(`event ${type} dropped · kill switch engaged`, 'failing');
    return { error: 'kill switch engaged' };
  }
  const event = payload && Object.keys(payload).length ? payload : { event: type };
  const candidates = all('SELECT * FROM routines WHERE enabled=1').filter((r) => j(r.triggers).includes(type));
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
  if (meta('kill_switch', 'false') === 'true') return;
  const d = new Date();
  const stamp = `${d.getFullYear()}/${d.getMonth()}/${d.getDate()} ${d.getHours()}:${d.getMinutes()}`;
  for (const r of all('SELECT * FROM routines WHERE enabled=1')) {
    if (!j(r.triggers).includes('schedule') || !r.schedule) continue;
    if (!cronMatches(r.schedule, d)) continue;
    if (_lastFired.get(r.slug) === stamp) continue; // fire at most once per matching minute
    _lastFired.set(r.slug, stamp);
    executeRoutine(r, { event: 'schedule', cron: r.schedule, fired_at: d.toISOString() }, `schedule · ${r.schedule}`);
  }
}
if (process.env.SWITCHBOARD_NO_SCHEDULER !== '1') setInterval(tickScheduler, 30_000).unref?.();

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

// The user's real GitHub repos — so the UI can see & target repositories.
// ?owner=<org|*> & ?q=<search> for cross-org browse / GitHub-wide search.
app.get('/api/github/repos', async (req, res) => res.json({ repos: await listRepos({ owner: String(req.query.owner || ''), q: String(req.query.q || '') }) }));
app.get('/api/github/orgs', async (_q, res) => res.json({ orgs: await listOrgs() }));
// Possible check names for a repo — so a reaction can target a specific check.
app.get('/api/github/checks', async (req, res) => res.json({ checks: await listChecks(String(req.query.repo || '')) }));

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
  res.json({ ...shapeRoutine(r), ...detailOf(r), runHistory, watches });
});

app.post('/api/routines', (req, res) => {
  const b = req.body || {};
  const name = (b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'A routine name is required.' });
  const slug = (b.slug || slugify(name)).trim();
  if (!slug) return res.status(400).json({ error: 'A valid slug is required.' });
  if (one('SELECT 1 FROM routines WHERE slug=?', slug)) return res.status(409).json({ error: `A routine with slug "${slug}" already exists.` });

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
      (slug,name,summary,owner,team,triggers,connectors,state,last_ago,last_status,next,success,spend,enabled,meta_short,lease_ref,avg,av_color,initials,ord,prompt,model,repo,branch,chain,schedule,filters,reactions,effort,memory)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    slug, name, (b.summary || '').trim(), owner, team,
    JSON.stringify(triggers), JSON.stringify(connectors),
    'idle', 'never', 'idle', next, null, '$0.00', enabled, '', '', '—',
    ownerColor(owner), initialsOf(owner), ord,
    (b.prompt || '').trim(), normModel(b.model), (b.repo || '').trim(), (b.branch || 'main').trim(),
    JSON.stringify(chain), schedule, JSON.stringify(filters), JSON.stringify(reactions), normEffort(b.effort), b.memory ? 1 : 0
  );
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
  L.push(`  repos: [${(r.repo || '').split(',').map((s) => s.trim()).filter(Boolean).join(', ') || '*'}]`, `  branch: ${r.branch}`);
  if (r.memory) L.push('  memory: enabled');
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
  run(
    `UPDATE routines SET name=?,summary=?,owner=?,team=?,triggers=?,connectors=?,chain=?,model=?,repo=?,branch=?,prompt=?,av_color=?,initials=?,next=?,schedule=?,filters=?,reactions=?,effort=?,memory=? WHERE slug=?`,
    (b.name ?? r.name).trim() || r.name, (b.summary ?? r.summary).trim(), owner, (b.team ?? r.team).trim() || 'general',
    JSON.stringify(triggers), JSON.stringify(Array.isArray(b.connectors) ? b.connectors.filter(Boolean) : j(r.connectors)),
    JSON.stringify(Array.isArray(b.chain) ? b.chain.filter(Boolean) : j(r.chain)),
    normModel(b.model ?? r.model), (b.repo ?? r.repo).trim(), (b.branch ?? r.branch).trim() || 'main',
    (b.prompt ?? r.prompt).trim(), ownerColor(owner), initialsOf(owner), next, schedule, JSON.stringify(filters), JSON.stringify(reactions),
    b.effort != null ? normEffort(b.effort) : (r.effort || ''),
    b.memory != null ? (b.memory ? 1 : 0) : r.memory, r.slug
  );
  res.json(shapeRoutine(one('SELECT * FROM routines WHERE slug=?', r.slug)));
});

app.delete('/api/routines/:slug', (req, res) => {
  const r = one('SELECT * FROM routines WHERE slug=?', req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  run('DELETE FROM routines WHERE slug=?', r.slug);
  run('DELETE FROM runs WHERE routine_slug=?', r.slug);
  res.json({ ok: true });
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
  // Flag granted tools the runner can't actually provide.
  const phantom = tools.filter((c) => !['github', 'slack', 'web', 'webfetch'].includes(c));
  if (phantom.length) checks.push({ label: 'Tools', ok: false, detail: `not wired: ${phantom.join(', ')} — only github, slack, web are granted` });
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
    return { seq: e.seq, t: fmtOffset(e.t_offset), type: e.type, tool: e.tool, ok: e.ok, text: pl.d, truncated: !!pl.truncated };
  });
  res.json({
    id: x.id, routine: x.routine_slug, status: x.status, trigger: x.trigger,
    started: new Date(x.created_at).toLocaleTimeString(), elapsed: x.dur, model: r?.model || 'claude',
    cost: x.cost_usd, turns: x.num_turns, sessionId: x.session_id,
    stdout: x.output, event: jObj(x.event), trace,
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
  const out = [
    { code: 'GH', name: 'GitHub', kind: 'CLI · gh', health: st.github.connected ? 'ok' : 'off', auth: st.github.connected ? `gh · @${st.github.account}` : 'run `gh auth login`', scopes: 'read/write PRs, issues, checks, gists', routines: uses('github'), avColor: '#7f9bd1', testable: true, configKey: '' },
    { code: 'SL', name: 'Slack', kind: 'Bot', health: st.slack.connected ? 'ok' : 'off', auth: st.slack.connected ? `${st.slack.team} · @${st.slack.bot}` : 'set a bot token', scopes: 'post messages via slack-post', routines: uses('slack'), avColor: '#c9a24a', testable: true, configKey: 'slack' },
    { code: 'WB', name: 'Web fetch', kind: 'Built-in', health: 'ok', auth: 'no auth needed', scopes: 'fetch & read public URLs', routines: uses('web'), avColor: '#8aa0b8', testable: true, configKey: '' },
    { code: 'AT', name: 'Atlassian / Confluence', kind: 'API · planned', health: process.env.ATLASSIAN_API_TOKEN ? 'ok' : 'off', auth: process.env.ATLASSIAN_API_TOKEN ? 'token set' : 'set an API token', scopes: 'publish to Confluence (not yet a granted tool)', routines: uses('confluence'), avColor: '#6fae9a', testable: true, configKey: 'atlassian' },
  ];
  for (const s of all('SELECT name, config FROM mcp_servers ORDER BY name')) {
    const cfg = jObj(s.config) || {};
    out.push({ code: s.name, name: s.name, kind: 'MCP', health: 'ok', auth: cfg.command ? `stdio · ${cfg.command}` : cfg.url ? `http · ${cfg.url}` : 'custom MCP', scopes: `mcp__${s.name}__*`, routines: uses(s.name), avColor: '#b49ae6', testable: true, configKey: '', mcp: true });
  }
  res.json(out);
});

// Live connectivity test for a connector (gh user / slack / web / atlassian / MCP server).
app.post('/api/connectors/:code/test', async (req, res) => {
  if (mcpNameSet().has(req.params.code)) return res.json(await testMcp(req.params.code));
  res.json(await testConnector(req.params.code, req.body || {}));
});
// Custom MCP servers — drop in a config + auth (env/headers); routines grant them by name.
app.get('/api/mcp', (_q, res) => res.json(all('SELECT * FROM mcp_servers ORDER BY name').map((s) => ({ name: s.name, config: maskConfig(jObj(s.config) || {}) }))));
app.post('/api/mcp', (req, res) => {
  const name = String(req.body?.name || '').trim().replace(/[^a-z0-9_-]/gi, '');
  if (!name) return res.status(400).json({ error: 'a server name (letters, digits, - or _) is required' });
  let cfg;
  try { cfg = normalizeMcpDef(name, req.body?.config); } catch { return res.status(400).json({ error: 'config must be valid JSON' }); }
  if (!cfg || typeof cfg !== 'object' || (!cfg.command && !cfg.url)) return res.status(400).json({ error: 'config needs a "command" (stdio) or a "url" (http/sse)' });
  run("INSERT INTO mcp_servers (name,config,created_at) VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET config=excluded.config", name, JSON.stringify(cfg), now());
  res.json({ ok: true, name });
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
  const event = req.body?.event ?? { event: 'manual', routine: r.slug, dispatched_at: new Date().toISOString() };
  res.json({ ok: true, runId: executeRoutine(r, event, 'manual'), status: 'running' });
});

// Generic event ingress — any trigger type. POST /api/events/push, /pull_request, etc.
app.post('/api/events/:type', (req, res) => {
  const type = req.params.type;
  const payload = type === 'push' && (!req.body || !Object.keys(req.body).length) ? SAMPLE_PUSH() : req.body;
  const out = dispatchEvent(type, payload);
  if (out.error) return res.status(409).json(out);
  res.json(out);
});

// Real GitHub webhook receiver — dispatches by the X-GitHub-Event header.
app.post('/api/webhooks/github', (req, res) => {
  if (!githubSignatureValid(req)) return res.status(401).json({ error: 'invalid webhook signature' });
  const type = req.get('x-github-event') || 'push';
  const out = dispatchEvent(type, req.body || {});
  if (out.error) return res.status(409).json(out);
  res.json({ ok: true, ...out });
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
