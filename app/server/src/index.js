import express from 'express';
import cors from 'cors';
import { getDb, all, one, run } from './db.js';

const app = express();
app.use(cors());
app.use(express.json());

getDb(); // open + seed on boot

const PORT = process.env.PORT || 4317;
const now = () => Date.now();
const j = (s) => { try { return JSON.parse(s); } catch { return []; } };

// ── Enrichment helpers ────────────────────────────────────────────────────────
function teamOf(id) { return one('SELECT * FROM teams WHERE id = ?', id); }
function ownerOf(handle) { return one('SELECT * FROM users WHERE handle = ?', handle); }
function triggersOf(rid) { return all('SELECT type,label,detail FROM triggers WHERE routine_id = ?', rid); }
function grantsOf(rid) { return all('SELECT kind,name FROM grants WHERE routine_id = ?', rid); }
function latestRun(rid) {
  return one('SELECT * FROM runs WHERE routine_id = ? ORDER BY started_at DESC LIMIT 1', rid);
}
function leaseOf(rid) { return one('SELECT * FROM leases WHERE routine_id = ? ORDER BY expires_at DESC LIMIT 1', rid); }

function shapeRoutine(r, { detail = false } = {}) {
  const team = teamOf(r.team_id);
  const owner = ownerOf(r.owner);
  const last = latestRun(r.id);
  const subs = all('SELECT * FROM subscriptions WHERE routine_id = ?', r.id);
  const base = {
    id: r.id, slug: r.slug, name: r.name, summary: r.summary,
    enabled: !!r.enabled, state: r.enabled ? r.state : 'disabled', risk: r.risk,
    visibility: r.visibility, model: r.model, repo: r.repo, branch: r.branch,
    filePath: r.file_path, tags: j(r.tags),
    team: team ? { id: team.id, name: team.name, accent: team.accent } : null,
    owner: owner ? { handle: owner.handle, name: owner.name, accent: owner.accent } : { handle: r.owner, name: r.owner, accent: '#8A93A6' },
    triggers: triggersOf(r.id),
    successRate: r.success_rate, runs7d: r.runs_7d, avgDurationSec: r.avg_duration_sec,
    spendToday: r.spend_today, nextRunAt: r.next_run_at, updatedAt: r.updated_at,
    watching: subs.length,
    lastRun: last ? { id: last.id, status: last.status, startedAt: last.started_at, durationSec: last.duration_sec, summary: last.summary, target: last.target } : null,
    lease: leaseOf(r.id),
  };
  if (!detail) return base;
  return {
    ...base,
    createdAt: r.created_at, prompt: r.prompt,
    grants: grantsOf(r.id),
    reactions: all('SELECT when_label AS whenLabel, do_label AS doLabel, budget FROM reactions WHERE routine_id = ?', r.id),
    runs: all('SELECT * FROM runs WHERE routine_id = ? ORDER BY started_at DESC LIMIT 12', r.id),
    subscriptions: subs,
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/stats', (_req, res) => {
  const routines = all('SELECT * FROM routines');
  const enabled = routines.filter(r => r.enabled);
  const byState = {};
  for (const r of routines) {
    const s = r.enabled ? r.state : 'disabled';
    byState[s] = (byState[s] || 0) + 1;
  }
  const dayAgo = now() - 86_400_000;
  const runsToday = one('SELECT COUNT(*) AS n FROM runs WHERE started_at > ?', dayAgo).n;
  const failedToday = one("SELECT COUNT(*) AS n FROM runs WHERE started_at > ? AND status = 'failed'", dayAgo).n;
  const avgSuccess = enabled.length ? enabled.reduce((a, r) => a + r.success_rate, 0) / enabled.length : 0;
  const spendToday = routines.reduce((a, r) => a + r.spend_today, 0);
  const leases = one('SELECT COUNT(*) AS n FROM leases').n;
  const watching = one('SELECT COUNT(*) AS n FROM subscriptions').n;
  const needsHuman = one('SELECT COUNT(*) AS n FROM subscriptions WHERE status = ?', 'needs_human').n
    + routines.filter(r => r.enabled && r.state === 'needs_human').length;
  res.json({
    org: one("SELECT value FROM meta WHERE key='org'")?.value || 'Switchboard',
    killSwitch: (one("SELECT value FROM meta WHERE key='kill_switch'")?.value || 'false') === 'true',
    total: routines.length, enabled: enabled.length,
    byState, runsToday, failedToday,
    avgSuccess, spendToday: +spendToday.toFixed(2),
    activeLeases: leases, watching, needsHuman,
  });
});

app.get('/api/routines', (req, res) => {
  let rows = all('SELECT * FROM routines ORDER BY name');
  const { team, state, q } = req.query;
  let list = rows.map(r => shapeRoutine(r));
  if (team) list = list.filter(r => r.team?.id === team);
  if (state) list = list.filter(r => r.state === state);
  if (q) {
    const s = String(q).toLowerCase();
    list = list.filter(r => (r.name + r.summary + r.tags.join(' ') + r.owner.name).toLowerCase().includes(s));
  }
  res.json(list);
});

app.get('/api/routines/:slug', (req, res) => {
  const r = one('SELECT * FROM routines WHERE slug = ?', req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json(shapeRoutine(r, { detail: true }));
});

app.post('/api/routines/:slug/enable', (req, res) => {
  const r = one('SELECT * FROM routines WHERE slug = ?', req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  const enabled = req.body?.enabled ? 1 : 0;
  run('UPDATE routines SET enabled = ?, updated_at = ? WHERE id = ?', enabled, now(), r.id);
  run('INSERT INTO audit (actor,action,target,detail,ts) VALUES (?,?,?,?,?)',
    'you', enabled ? 'enabled' : 'disabled', r.slug, enabled ? 'Enabled from the fleet board' : 'Disabled from the fleet board', now());
  res.json(shapeRoutine(one('SELECT * FROM routines WHERE id = ?', r.id), { detail: true }));
});

app.post('/api/routines/:slug/dispatch', (req, res) => {
  const r = one('SELECT * FROM routines WHERE slug = ?', req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  if ((one("SELECT value FROM meta WHERE key='kill_switch'")?.value) === 'true')
    return res.status(409).json({ error: 'kill switch engaged' });
  const runId = 'run_' + Math.random().toString(36).slice(2, 9);
  const t = now();
  run(`INSERT INTO runs (id,routine_id,status,trigger_type,trigger_summary,started_at,finished_at,duration_sec,summary,decision,pushed_sha,target,tokens,cost)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    runId, r.id, 'running', 'manual', 'Manual run (Run now)', t, null, null, null, 'admit', null, null, null, null);
  run('UPDATE routines SET state = ?, updated_at = ? WHERE id = ?', 'running', t, r.id);
  run('INSERT INTO audit (actor,action,target,detail,ts) VALUES (?,?,?,?,?)', 'you', 'dispatched', r.slug, 'Manual run via Run now', t);
  res.json({ runId, status: 'running' });
});

app.get('/api/runs', (req, res) => {
  const limit = Math.min(+(req.query.limit || 40), 200);
  const rows = all('SELECT * FROM runs ORDER BY started_at DESC LIMIT ?', limit);
  res.json(rows.map(run_ => {
    const r = one('SELECT slug,name,team_id FROM routines WHERE id = ?', run_.routine_id);
    return { ...run_, routine: r ? { slug: r.slug, name: r.name, team: teamOf(r.team_id) } : null };
  }));
});

app.get('/api/connectors', (_req, res) => {
  res.json(all('SELECT * FROM connectors ORDER BY status DESC, name').map(c => ({
    ...c, events: j(c.events), connected: c.status === 'connected',
  })));
});

app.get('/api/subscriptions', (_req, res) => {
  res.json(all('SELECT * FROM subscriptions ORDER BY updated_at DESC').map(s => {
    const r = one('SELECT slug,name FROM routines WHERE id = ?', s.routine_id);
    return { ...s, routine: r };
  }));
});

app.get('/api/activity', (_req, res) => {
  res.json(all('SELECT * FROM audit ORDER BY ts DESC LIMIT 40'));
});

app.get('/api/teams', (_req, res) => res.json(all('SELECT * FROM teams ORDER BY name')));

app.post('/api/kill-switch', (req, res) => {
  const engaged = !!req.body?.engaged;
  run("UPDATE meta SET value = ? WHERE key = 'kill_switch'", engaged ? 'true' : 'false');
  run('INSERT INTO audit (actor,action,target,detail,ts) VALUES (?,?,?,?,?)',
    'you', engaged ? 'engaged kill switch' : 'released kill switch', 'org', engaged ? 'Org-wide emergency stop' : 'Resumed the fleet', now());
  res.json({ killSwitch: engaged });
});

app.listen(PORT, () => console.log(`Switchboard API on http://localhost:${PORT}`));
