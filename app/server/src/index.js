import express from 'express';
import cors from 'cors';
import { getDb, all, one, run } from './db.js';
import { runClaude, buildPrompt } from './runner.js';
import { integrationStatus, listRepos, listOrgs } from './integrations.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
getDb();

const PORT = process.env.PORT || 4317;
const j = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } };
const jObj = (s) => { try { return JSON.parse(s); } catch { return null; } };
const meta = (k, d) => one('SELECT value FROM meta WHERE key=?', k)?.value ?? d;
const now = () => Date.now();
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
const MAX_PAYLOAD = 16_000;
const redact = (s) => String(s)
  .replace(/xox[baprs]-[A-Za-z0-9-]+/g, 'xoxb-***')
  .replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, 'gh***')
  .replace(/-----BEGIN[\s\S]*?PRIVATE KEY-----/g, '***private-key***');

const shapeRoutine = (r) => ({
  slug: r.slug, name: r.name, summary: r.summary,
  owner: r.owner, team: r.team, ownerColor: r.av_color, initials: r.initials,
  triggers: j(r.triggers), connectors: j(r.connectors), chain: j(r.chain),
  schedule: r.schedule || '', filters: jObj(r.filters) || {},
  model: r.model, repo: r.repo, branch: r.branch,
  state: r.enabled ? r.state : 'disabled', enabled: !!r.enabled,
  lastAgo: r.last_ago, lastStatus: r.last_status, next: r.next,
  success: r.success, spend: r.spend, metaShort: r.meta_short, leaseRef: r.lease_ref, avg: r.avg,
});

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
      runtime: [r.model || 'claude-opus-4-8', `· repos ${repos.join(', ') || '*'}`, `· branch ${r.branch || 'main'}`],
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

// ── Execution: enrich (gh) → run Claude → deliver sinks → chain ───────────────
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
    // its granted tools, and does the work itself (gh, slack-post, web…). No harness
    // enrichment, no harness sinks.
    const tools = j(r.connectors);
    const prompt = buildPrompt({ ...r, connectors: tools }, rawEvent ?? {}, policyConstraints());
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

    const res = await runClaude(prompt, { tools, onEvent });
    const ok = !res.isError && !!res.finalText;
    const output = ok ? res.finalText : (res.finalText || res.stderr || `claude exited ${res.code}`);

    run('UPDATE runs SET status=?, dur=?, dur_ms=?, output=?, cost_usd=?, num_turns=?, session_id=? WHERE id=?',
      ok ? 'succeeded' : 'failed', fmtDur(res.ms), res.ms, output, res.costUsd, res.numTurns, res.sessionId, id);
    // Roll up real spend + avg duration onto the routine.
    const agg = one('SELECT COALESCE(SUM(cost_usd),0) AS spend, AVG(dur_ms) AS avgms FROM runs WHERE routine_slug=?', r.slug);
    run('UPDATE routines SET state=?, last_ago=?, last_status=?, success=?, spend=?, avg=? WHERE slug=?',
      'idle', 'just now', ok ? 'success' : 'failing', ok ? 100 : 0,
      `$${Number(agg.spend || 0).toFixed(2)}`, agg.avgms ? fmtDur(agg.avgms) : '—', r.slug);
    logActivity(`${r.slug} ${ok ? 'ran · ' + output.split('\n').pop().slice(0, 60) : 'failed'} · ${triggerLabel}`, ok ? 'success' : 'failing');

    // chain: kick off downstream routines with this session's result as context
    if (ok) {
      for (const slug of j(r.chain)) {
        const dr = one('SELECT * FROM routines WHERE slug=? AND enabled=1', slug);
        if (dr) executeRoutine(dr, { ...(rawEvent ?? {}), upstream: { routine: r.slug, output } }, `after · ${r.slug}`);
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
function filtersMatch(r, event) {
  let f; try { f = JSON.parse(r.filters || '{}'); } catch { f = {}; }
  const actions = Array.isArray(f.actions) ? f.actions : [];
  const branches = Array.isArray(f.branches) ? f.branches : [];
  if (actions.length && event?.action && !actions.includes(event.action)) return false;
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

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/api/health', (_q, res) => res.json({ ok: true }));

// The user's real GitHub repos — so the UI can see & target repositories.
// ?owner=<org|*> & ?q=<search> for cross-org browse / GitHub-wide search.
app.get('/api/github/repos', async (req, res) => res.json({ repos: await listRepos({ owner: String(req.query.owner || ''), q: String(req.query.q || '') }) }));
app.get('/api/github/orgs', async (_q, res) => res.json({ orgs: await listOrgs() }));

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
  res.json({ ...shapeRoutine(r), ...detailOf(r), runHistory });
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
  const sinks = Array.isArray(b.sinks) ? b.sinks.filter((s) => s && s.type) : [];
  const chain = Array.isArray(b.chain) ? b.chain.filter(Boolean) : [];
  const schedule = (b.schedule || '').trim();
  const filters = cleanFilters(b.filters);
  const enabled = b.enabled === false ? 0 : 1;
  const ord = (one('SELECT MAX(ord) AS m FROM routines').m ?? -1) + 1;
  const next = triggers.includes('schedule') ? (schedule || 'scheduled') : triggers.length ? 'on event' : '—';

  run(
    `INSERT INTO routines
      (slug,name,summary,owner,team,triggers,connectors,state,last_ago,last_status,next,success,spend,enabled,meta_short,lease_ref,avg,av_color,initials,ord,prompt,model,repo,branch,sinks,chain,schedule,filters)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    slug, name, (b.summary || '').trim(), owner, team,
    JSON.stringify(triggers), JSON.stringify(connectors),
    'idle', 'never', 'idle', next, null, '$0.00', enabled, '', '', '—',
    ownerColor(owner), initialsOf(owner), ord,
    (b.prompt || '').trim(), (b.model || 'claude-opus-4-8').trim(), (b.repo || '').trim(), (b.branch || 'main').trim(),
    JSON.stringify(sinks), JSON.stringify(chain), schedule, JSON.stringify(filters)
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
  if (j(r.connectors).length) { L.push('tools:'); L.push(`  mcp: [${j(r.connectors).join(', ')}]`); }
  L.push('runtime:', `  model: ${r.model}`, `  repos: [${(r.repo || '').split(',').map((s) => s.trim()).filter(Boolean).join(', ') || '*'}]`, `  branch: ${r.branch}`);
  const chain = j(r.chain);
  if (chain.length) L.push(`chain: [${chain.join(', ')}]`);
  L.push('---', '', r.prompt && r.prompt.trim() ? r.prompt : `## Prompt\n${r.summary}`);
  return L.join('\n');
}

app.get('/api/routines/:slug/raw', (req, res) => {
  const r = one('SELECT * FROM routines WHERE slug=?', req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json({ file: `${r.slug}.routine.md`, md: buildRoutineMd(r) });
});

app.put('/api/routines/:slug', (req, res) => {
  const r = one('SELECT * FROM routines WHERE slug=?', req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  const owner = (b.owner ?? r.owner).trim() || 'unassigned';
  const triggers = Array.isArray(b.triggers) ? b.triggers.filter(Boolean) : j(r.triggers);
  const schedule = b.schedule != null ? String(b.schedule).trim() : (r.schedule || '');
  const filters = b.filters != null ? cleanFilters(b.filters) : (jObj(r.filters) || {});
  const next = triggers.includes('schedule') ? (schedule || 'scheduled') : triggers.length ? 'on event' : '—';
  run(
    `UPDATE routines SET name=?,summary=?,owner=?,team=?,triggers=?,connectors=?,sinks=?,chain=?,model=?,repo=?,branch=?,prompt=?,av_color=?,initials=?,next=?,schedule=?,filters=? WHERE slug=?`,
    (b.name ?? r.name).trim() || r.name, (b.summary ?? r.summary).trim(), owner, (b.team ?? r.team).trim() || 'general',
    JSON.stringify(triggers), JSON.stringify(Array.isArray(b.connectors) ? b.connectors.filter(Boolean) : j(r.connectors)),
    JSON.stringify(Array.isArray(b.sinks) ? b.sinks.filter((s) => s && s.type) : j(r.sinks)),
    JSON.stringify(Array.isArray(b.chain) ? b.chain.filter(Boolean) : j(r.chain)),
    (b.model ?? r.model).trim() || 'claude-opus-4-8', (b.repo ?? r.repo).trim(), (b.branch ?? r.branch).trim() || 'main',
    (b.prompt ?? r.prompt).trim(), ownerColor(owner), initialsOf(owner), next, schedule, JSON.stringify(filters), r.slug
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
    { label: 'Model', ok: !!r.model, detail: r.model },
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
    const okCron = parts.length === 5 && parts.every((f) => /^[\d*,/-]+$/.test(f));
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
  const saved = jObj(meta('policies', 'null'));
  const policies = DEFAULT_POLICIES.map((p) => ({ ...p, on: saved && p.key in saved ? !!saved[p.key] : p.on }));
  res.json({ identities: st, policies });
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
    { code: 'GH', name: 'GitHub', kind: 'CLI · gh', health: st.github.connected ? 'ok' : 'off', auth: st.github.connected ? `gh · @${st.github.account}` : 'run `gh auth login`', scopes: 'read/write PRs, issues, checks, gists', routines: uses('github'), avColor: '#7f9bd1' },
    { code: 'SL', name: 'Slack', kind: 'Bot', health: st.slack.connected ? 'ok' : 'off', auth: st.slack.connected ? `${st.slack.team} · @${st.slack.bot}` : 'set SLACK_BOT_TOKEN', scopes: 'post messages via slack-post', routines: uses('slack'), avColor: '#c9a24a' },
    { code: 'WB', name: 'Web fetch', kind: 'Built-in', health: 'ok', auth: 'no auth needed', scopes: 'fetch & read public URLs', routines: uses('web'), avColor: '#8aa0b8' },
    { code: 'AT', name: 'Atlassian / Confluence', kind: 'API · planned', health: process.env.ATLASSIAN_API_TOKEN ? 'ok' : 'off', auth: process.env.ATLASSIAN_API_TOKEN ? 'token set' : 'set ATLASSIAN_API_TOKEN', scopes: 'publish to Confluence (not yet a granted tool)', routines: uses('confluence'), avColor: '#6fae9a' },
  ];
  res.json(out);
});

app.get('/api/activity', (_q, res) =>
  res.json(all('SELECT * FROM activity ORDER BY ord DESC LIMIT 40').map((a) => ({ time: a.time, text: a.text, state: a.state })))
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
