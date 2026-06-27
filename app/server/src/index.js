import express from 'express';
import cors from 'cors';
import { getDb, all, one, run } from './db.js';

const app = express();
app.use(cors());
app.use(express.json());
getDb();

const PORT = process.env.PORT || 4317;
const j = (s) => { try { return JSON.parse(s); } catch { return []; } };
const meta = (k, d) => one('SELECT value FROM meta WHERE key=?', k)?.value ?? d;

const shapeRoutine = (r) => ({
  slug: r.slug, name: r.name, summary: r.summary,
  owner: r.owner, team: r.team, ownerColor: r.av_color, initials: r.initials,
  triggers: j(r.triggers), connectors: j(r.connectors),
  state: r.enabled ? r.state : 'disabled', enabled: !!r.enabled,
  lastAgo: r.last_ago, lastStatus: r.last_status, next: r.next,
  success: r.success, spend: r.spend, metaShort: r.meta_short, leaseRef: r.lease_ref, avg: r.avg,
});

// Routine detail derived from the routine's own stored fields — never fabricated.
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
    flowNodes: [{ title: j(r.triggers)[0] || 'trigger', sub: 'on' }, { title: 'run', sub: r.slug, tone: 'run' }, { title: 'status', sub: 'surface' }],
    reactions: [],
    prompt: r.prompt && r.prompt.trim() ? r.prompt : `## Prompt\n${r.summary}`,
    lease: null,
    ownedPRs: [],
  };
}

// Owner avatar helpers for newly-created routines.
const AV_PALETTE = ['#d98a5c', '#c9a24a', '#6fae9a', '#7f9bd1', '#c98fb0', '#b59ad6', '#5b9ee6', '#5fbf86', '#e6b052'];
const ownerColor = (name) => {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AV_PALETTE[h % AV_PALETTE.length];
};
const initialsOf = (name) => {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '??';
  return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase();
};
const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

app.get('/api/health', (_q, res) => res.json({ ok: true }));

app.get('/api/stats', (_q, res) => {
  const rows = all('SELECT * FROM routines');
  const enabled = rows.filter((r) => r.enabled);
  const st = (s) => rows.filter((r) => r.enabled && r.state === s).length;
  const teams = new Set(rows.map((r) => r.team)).size;
  const withSuccess = enabled.filter((r) => r.success != null);
  const success7d = withSuccess.length ? Math.round(withSuccess.reduce((a, r) => a + r.success, 0) / withSuccess.length) : null;
  res.json({
    wordmark: meta('wordmark', 'Switchboard'),
    killSwitch: meta('kill_switch', 'false') === 'true',
    total: rows.length, enabled: enabled.length, teams,
    running: st('running'), needsHuman: st('needs_human'), failing: st('failing'),
    runsToday: one('SELECT COUNT(*) AS n FROM runs').n, success7d, reactions24h: 0,
    leases: rows.filter((r) => r.enabled && r.lease_ref).length,
  });
});

app.get('/api/routines', (_q, res) => res.json(all('SELECT * FROM routines ORDER BY ord').map(shapeRoutine)));

app.get('/api/routines/:slug', (req, res) => {
  const r = one('SELECT * FROM routines WHERE slug=?', req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  const runHistory = all('SELECT * FROM runs WHERE routine_slug=? ORDER BY ord', r.slug)
    .map((x) => ({ id: x.id, status: x.status, ago: x.ago, dur: x.dur, trigger: x.trigger }));
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
  const enabled = b.enabled === false ? 0 : 1;
  const ord = (one('SELECT MAX(ord) AS m FROM routines').m ?? -1) + 1;
  const next = triggers.includes('schedule') ? 'scheduled' : triggers.length ? 'on event' : '—';

  run(
    `INSERT INTO routines
      (slug,name,summary,owner,team,triggers,connectors,state,last_ago,last_status,next,success,spend,enabled,meta_short,lease_ref,avg,av_color,initials,ord,prompt,model,repo,branch)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    slug, name, (b.summary || '').trim(), owner, team,
    JSON.stringify(triggers), JSON.stringify(connectors),
    'idle', 'never', 'idle', next, null, '$0.00', enabled, '', '', '—',
    ownerColor(owner), initialsOf(owner), ord,
    (b.prompt || '').trim(), (b.model || 'claude-opus-4-8').trim(), (b.repo || '').trim(), (b.branch || 'main').trim()
  );
  res.status(201).json(shapeRoutine(one('SELECT * FROM routines WHERE slug=?', slug)));
});

app.get('/api/runs', (_q, res) =>
  res.json(all('SELECT * FROM runs ORDER BY ord').map((x) => {
    const r = one('SELECT name FROM routines WHERE slug=?', x.routine_slug);
    return { id: x.id, routineSlug: x.routine_slug, routineName: r?.name ?? x.routine_slug, status: x.status, ago: x.ago, dur: x.dur, trigger: x.trigger };
  }))
);

app.get('/api/runs/:id', (req, res) => {
  const x = one('SELECT * FROM runs WHERE id=?', req.params.id);
  if (!x) return res.status(404).json({ error: 'not found' });
  res.json({
    id: x.id, routine: x.routine_slug, status: x.status, trigger: x.trigger,
    started: '—', elapsed: x.dur, model: '—',
    timeline: [], awaiting: null,
    summary: { result: '—', iteration: '—', commit: '—', surface: '—' },
    diff: null, dispatcher: [], outputs: [], leaseBarrier: [['trigger', x.trigger]],
  });
});

app.get('/api/connectors', (_q, res) =>
  res.json(all('SELECT * FROM connectors ORDER BY ord').map((c) => ({
    code: c.code, name: c.name, kind: c.kind, health: c.health, auth: c.auth, scopes: c.scopes, routines: c.routines, avColor: c.av_color,
  })))
);

app.get('/api/activity', (_q, res) =>
  res.json(all('SELECT * FROM activity ORDER BY ord').map((a) => ({ time: a.time, text: a.text, state: a.state })))
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
  run('UPDATE routines SET state=?, last_ago=?, last_status=? WHERE slug=?', 'running', 'now', 'running', r.slug);
  res.json({ ok: true, status: 'running' });
});

app.post('/api/kill-switch', (req, res) => {
  const engaged = !!req.body?.engaged;
  run("UPDATE meta SET value=? WHERE key='kill_switch'", engaged ? 'true' : 'false');
  res.json({ killSwitch: engaged });
});

app.listen(PORT, () => console.log(`Switchboard API on http://localhost:${PORT}`));
