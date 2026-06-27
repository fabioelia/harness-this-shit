import express from 'express';
import cors from 'cors';
import { getDb, all, one, run } from './db.js';
import { runClaude, buildPrompt } from './runner.js';
import { enrichEvent, deliverSinks } from './integrations.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
getDb();

const PORT = process.env.PORT || 4317;
const j = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } };
const jObj = (s) => { try { return JSON.parse(s); } catch { return null; } };
const meta = (k, d) => one('SELECT value FROM meta WHERE key=?', k)?.value ?? d;
const now = () => Date.now();

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

const shapeRoutine = (r) => ({
  slug: r.slug, name: r.name, summary: r.summary,
  owner: r.owner, team: r.team, ownerColor: r.av_color, initials: r.initials,
  triggers: j(r.triggers), connectors: j(r.connectors), sinks: j(r.sinks), chain: j(r.chain),
  state: r.enabled ? r.state : 'disabled', enabled: !!r.enabled,
  lastAgo: r.last_ago, lastStatus: r.last_status, next: r.next,
  success: r.success, spend: r.spend, metaShort: r.meta_short, leaseRef: r.lease_ref, avg: r.avg,
});

function detailOf(r) {
  return {
    breadcrumb: ['Fleet', r.slug],
    file: `${r.slug}.routine.md`,
    frontMatter: {
      on: j(r.triggers).map((t) => ({ key: `trigger · ${t}`, detail: '' })),
      tools: j(r.connectors).map((c) => ({ sign: '+', name: c, tone: 'ok' })),
      runtime: [r.model || 'claude-opus-4-8', `· repo ${r.repo || '—'}`, `· branch ${r.branch || '—'}`],
      concurrency: r.lease_ref
        ? [['lease', r.lease_ref, 'ttl', '20m']]
        : [['group', `${r.slug}-\${event}`, 'cancel_in_progress', 'true']],
    },
    flowNodes: [{ title: j(r.triggers)[0] || 'trigger', sub: 'on' }, { title: 'run', sub: r.slug, tone: 'run' }, { title: j(r.sinks)[0]?.type || 'stdout', sub: 'sink' }],
    reactions: [],
    prompt: r.prompt && r.prompt.trim() ? r.prompt : `## Prompt\n${r.summary}`,
    lease: null,
    ownedPRs: [],
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
    const event = await enrichEvent(rawEvent ?? {});
    run('UPDATE runs SET event=? WHERE id=?', JSON.stringify(event), id);

    const res = await runClaude(buildPrompt(r, event));
    const ok = res.code === 0 && !!res.output;
    const output = ok ? res.output : (res.output || res.stderr || `claude exited ${res.code}`);

    let sinksResult = [];
    if (ok) {
      try { sinksResult = await deliverSinks(j(r.sinks), output, event); } catch (e) { sinksResult = [{ type: 'error', ok: false, detail: e.message }]; }
    }
    run('UPDATE runs SET status=?, dur=?, output=?, sinks_result=? WHERE id=?',
      ok ? 'succeeded' : 'failed', fmtDur(res.ms), output, JSON.stringify(sinksResult), id);
    run('UPDATE routines SET state=?, last_ago=?, last_status=?, success=? WHERE slug=?',
      'idle', 'just now', ok ? 'success' : 'failing', ok ? 100 : 0, r.slug);
    logActivity(`${r.slug} ${ok ? 'printed output' : 'failed'} · ${triggerLabel}`, ok ? 'success' : 'failing');
    sinksResult.filter((s) => s.type !== 'stdout').forEach((s) =>
      logActivity(`${r.slug} → ${s.type} ${s.ok ? 'delivered' : 'skipped'} · ${s.detail}`, s.ok ? 'success' : 'queued'));

    // chain: kick off downstream routines with the upstream output
    if (ok) {
      for (const slug of j(r.chain)) {
        const dr = one('SELECT * FROM routines WHERE slug=? AND enabled=1', slug);
        if (dr) executeRoutine(dr, { ...event, upstream: { routine: r.slug, output } }, `after · ${r.slug}`);
      }
    }
  })().catch((e) => {
    run('UPDATE runs SET status=?, output=? WHERE id=?', 'failed', `harness error: ${e.message}`, id);
  });

  return id;
}

function dispatchEvent(type, payload) {
  if (meta('kill_switch', 'false') === 'true') return { error: 'kill switch engaged' };
  const event = payload && Object.keys(payload).length ? payload : { event: type };
  const matched = all('SELECT * FROM routines WHERE enabled=1').filter((r) => j(r.triggers).includes(type));
  const runs = matched.map((r) => ({ slug: r.slug, runId: executeRoutine(r, event, `${type} · ${event.ref || event.repository?.full_name || event.repository || 'event'}`) }));
  return { matched: matched.map((r) => r.slug), runs, event };
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/api/health', (_q, res) => res.json({ ok: true }));

app.get('/api/stats', (_q, res) => {
  const rows = all('SELECT * FROM routines');
  const enabled = rows.filter((r) => r.enabled);
  const st = (s) => rows.filter((r) => r.enabled && r.state === s).length;
  const teams = new Set(rows.map((r) => r.team)).size;
  const withSuccess = enabled.filter((r) => r.success != null);
  const success7d = withSuccess.length ? Math.round(withSuccess.reduce((a, r) => a + r.success, 0) / withSuccess.length) : null;
  const dayAgo = now() - 86_400_000;
  res.json({
    wordmark: meta('wordmark', 'Switchboard'), killSwitch: meta('kill_switch', 'false') === 'true',
    total: rows.length, enabled: enabled.length, teams,
    running: st('running'), needsHuman: st('needs_human'), failing: st('failing'),
    runsToday: one('SELECT COUNT(*) AS n FROM runs WHERE created_at > ?', dayAgo).n, success7d, reactions24h: 0,
    leases: rows.filter((r) => r.enabled && r.lease_ref).length,
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
  const enabled = b.enabled === false ? 0 : 1;
  const ord = (one('SELECT MAX(ord) AS m FROM routines').m ?? -1) + 1;
  const next = triggers.includes('schedule') ? 'scheduled' : triggers.length ? 'on event' : '—';

  run(
    `INSERT INTO routines
      (slug,name,summary,owner,team,triggers,connectors,state,last_ago,last_status,next,success,spend,enabled,meta_short,lease_ref,avg,av_color,initials,ord,prompt,model,repo,branch,sinks,chain)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    slug, name, (b.summary || '').trim(), owner, team,
    JSON.stringify(triggers), JSON.stringify(connectors),
    'idle', 'never', 'idle', next, null, '$0.00', enabled, '', '', '—',
    ownerColor(owner), initialsOf(owner), ord,
    (b.prompt || '').trim(), (b.model || 'claude-opus-4-8').trim(), (b.repo || '').trim(), (b.branch || 'main').trim(),
    JSON.stringify(sinks), JSON.stringify(chain)
  );
  res.status(201).json(shapeRoutine(one('SELECT * FROM routines WHERE slug=?', slug)));
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
  const sinks = j(x.sinks_result);
  const timeline = [
    { t: '00:00', tag: 'dispatch', text: `Dispatcher admitted run · trigger ${x.trigger}`, dot: '#5fbf86' },
    { t: '00:00', tag: 'enrich', text: `Enriched event via gh (live GitHub data)`, dot: '#7f8a80' },
    { t: '00:00', tag: 'claude', text: `Spawned a headless Claude instance · claude -p`, dot: '#5b9ee6' },
  ];
  if (!running) {
    timeline.push({ t: x.dur, tag: ok ? 'output' : 'error', text: ok ? `Printed ${x.output.length} chars to stdout` : 'Run failed — see output', dot: ok ? '#5fbf86' : '#e5736b' });
    sinks.filter((s) => s.type !== 'stdout').forEach((s) => timeline.push({ t: x.dur, tag: 'sink', text: `${s.type} → ${s.ok ? 'delivered' : 'skipped'} · ${s.detail}`, dot: s.ok ? '#5fbf86' : '#e6b052' }));
  }
  res.json({
    id: x.id, routine: x.routine_slug, status: x.status, trigger: x.trigger,
    started: new Date(x.created_at).toLocaleTimeString(), elapsed: x.dur, model: r?.model || 'claude',
    stdout: x.output, event: jObj(x.event), sinksResult: sinks,
    timeline, awaiting: running ? 'claude -p still running…' : null,
    summary: { result: running ? 'Running…' : ok ? (x.output.split('\n')[0].slice(0, 80) || 'Completed') : 'Failed', iteration: '1 of 1', commit: '—', surface: (j(r?.sinks).map((s) => s.type).join(', ') || 'stdout') },
    diff: null, dispatcher: [], outputs: [], leaseBarrier: [['trigger', x.trigger]],
  });
});

app.get('/api/connectors', (_q, res) =>
  res.json(all('SELECT * FROM connectors ORDER BY ord').map((c) => ({
    code: c.code, name: c.name, kind: c.kind, health: c.health, auth: c.auth, scopes: c.scopes, routines: c.routines, avColor: c.av_color,
  })))
);

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
