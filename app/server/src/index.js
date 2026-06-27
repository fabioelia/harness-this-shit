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

// ── Static detail bundles (verbatim from the design) ──────────────────────────
const PR_CLEANUP_DETAIL = {
  breadcrumb: ['Fleet', 'pr-cleanup'],
  file: 'pr-cleanup.routine.md',
  frontMatter: {
    on: [
      { key: 'github · check_run', detail: 'status: completed · name: review/*' },
      { key: 'gate: auto_cleanup_gate.py', tone: 'lease' },
    ],
    tools: [
      { sign: '+', name: 'push-commits', tone: 'ok' },
      { sep: true },
      { sign: '−', name: 'git-force-push', tone: 'bad' },
      { sign: '−', name: 'merge-pr', tone: 'bad' },
      { sign: '−', name: 'pr-comment', tone: 'bad' },
      { sign: '−', name: 'label-write', tone: 'bad' },
    ],
    runtime: ['claude-opus-4-8', '· repo newton', '· branch develop', '· worktree true', '· timeout 30m'],
    concurrency: [
      ['group', 'auto-cleanup-${pr.number}', 'cancel_in_progress', 'false'],
      ['lease', 'pr:newton#${pr.number}', 'ttl', '20m'],
      ['barrier', 'stale_if_sha_changed', 'yield_to_human', 'true'],
      ['budget', 'max_iterations 3', 'on_exhausted', 'needs-human'],
    ],
  },
  flowNodes: [
    { title: 'check_run', sub: 'review/*' },
    { title: 'run', sub: 'pr-cleanup', tone: 'run' },
    { title: 'opens PR', sub: 'subscribes' },
  ],
  reactions: [
    { dot: '#e5736b', when: 'check_run ci/* = failure', to: 'fix-ci · budget 3', toTone: 'accent' },
    { dot: '#e6b052', when: 'review = changes_requested', to: 'routine:pr-cleanup', toTone: 'accent' },
    { dot: '#5fbf86', when: 'pull_request merged = true', to: 'done · unsubscribe', toTone: 'ok' },
  ],
  prompt:
    '## Prompt\nYou are running on a PR’s already-checked-out head branch. Only edit\nfiles — never comment, label, or merge. Address the failing\nreview/* findings and required-CI failures minimally...\n\n## Constraints\n- Never force-push. Never merge. Act only on the trigger PR.',
  lease: { claiming: 'pr:newton#4821', ttlLeft: '12m left · 20m', ttlPct: 60, budget: '2 / 3', budgetPct: 66, yield: true, barrier: 'a1b9f3c' },
  ownedPRs: [
    { ref: 'newton#4821', title: 'Fix flaky auth retry on 429', status: 'running', label: 'Reacting', waiting: 'waiting on ci/unit re-run', last: 'fix-ci · 12m ago', budget: '2 / 3' },
    { ref: 'newton#4799', title: 'Bump pydantic to 2.9.2', status: 'queued', label: 'Watching', waiting: 'waiting on human review', last: 'no reactions yet', budget: '0 / 3' },
    { ref: 'newton#4760', title: 'Refactor lease store keys', status: 'success', label: 'Done', waiting: 'merged · unsubscribed', last: 'done · 1d ago', budget: '1 / 3' },
  ],
};

const RUN_8F3A2 = {
  routine: 'pr-cleanup', status: 'running', trigger: 'check_run review/unit',
  started: '14:31:08', elapsed: '1m 42s', model: 'claude-opus-4-8',
  timeline: [
    { t: '00:00', tag: 'dispatch', text: 'Dispatcher admitted run · lease pr:newton#4821 acquired (ttl 20m)', dot: '#5fbf86' },
    { t: '00:01', tag: 'setup', text: 'Checked out head a1b9f3c in an isolated git worktree', dot: '#7f8a80' },
    { t: '00:04', tag: 'read', text: 'Read 6 files · fetched CI logs for review/unit', dot: '#7f8a80' },
    { t: '00:22', tag: 'agent', text: 'Sub-agent diagnose · failing test test_auth_retry_429', dot: '#5b9ee6' },
    { t: '00:48', tag: 'edit', text: 'Edited apps/server/auth/retry.py  (+8 −3)', dot: '#5b9ee6' },
    { t: '01:05', tag: 'test', text: 'Ran pytest tests/auth · 142 passed, 0 failed', dot: '#5fbf86' },
    { t: '01:20', tag: 'mcp', text: 'github · pushed commit 4f2a1d to pr:newton#4821', dot: '#5fbf86' },
    { t: '01:38', tag: 'output', text: 'Upserted status comment · marker auto-cleanup-summary', dot: '#5fbf86' },
  ],
  awaiting: 'awaiting re-run of ci/unit on pushed commit…',
  summary: { result: 'Addressed 1 required-CI failure', iteration: '2 of 3', commit: '4f2a1d', surface: 'PR comment updated' },
  diff: { file: 'apps/server/auth/retry.py', add: '+8', del: '−3', note: '1 file changed' },
  dispatcher: [
    { label: 'Concurrency group', val: 'auto-cleanup-4821 · serialized' },
    { label: 'Lease pr:newton#4821', val: 'acquired · ttl 20m' },
    { label: 'SHA barrier', val: 'head a1b9f3c matches trigger' },
    { label: 'Yield-to-human', val: 'no human commit since last action' },
    { label: 'Iteration budget', val: '2 of 3 used' },
  ],
  outputs: [
    { dot: '#5fbf86', label: 'Status comment', val: 'pr:newton#4821 ›', tone: 'accent' },
    { dot: '#5fbf86', label: 'Pushed commit', val: '4f2a1d ›', tone: 'accent' },
    { dot: '#e6b052', label: 'Check-run routine/pr-cleanup', val: 'neutral', tone: 'warn' },
  ],
  leaseBarrier: [['lease', 'pr:newton#4821 · 12m'], ['head sha', 'a1b9f3c'], ['budget', '2 / 3 used']],
};

function genDetail(r) {
  // Lighter, generated detail for routines other than pr-cleanup.
  const on = j(r.triggers).map((t) => ({ key: `trigger · ${t}`, detail: '' }));
  return {
    breadcrumb: ['Fleet', r.slug], file: `${r.slug}.routine.md`,
    frontMatter: {
      on,
      tools: j(r.connectors).map((c) => ({ sign: '+', name: c, tone: 'ok' })),
      runtime: ['claude-opus-4-8', '· repo newton', '· branch develop'],
      concurrency: r.lease_ref
        ? [['lease', r.lease_ref, 'ttl', '20m'], ['budget', 'max_iterations 3', 'on_exhausted', 'needs-human']]
        : [['group', `${r.slug}-\${event}`, 'cancel_in_progress', 'true']],
    },
    flowNodes: [{ title: j(r.triggers)[0] || 'trigger', sub: 'on' }, { title: 'run', sub: r.slug, tone: 'run' }, { title: 'status', sub: 'surface' }],
    reactions: [],
    prompt: `## Prompt\n${r.summary}\n\n## Constraints\n- Act only on the trigger payload. Never escalate beyond granted tools.`,
    lease: r.lease_ref ? { claiming: r.lease_ref, ttlLeft: '12m left · 20m', ttlPct: 60, budget: '2 / 3', budgetPct: 66, yield: true, barrier: 'a1b9f3c' } : null,
    ownedPRs: [],
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/api/health', (_q, res) => res.json({ ok: true }));

app.get('/api/stats', (_q, res) => {
  const rows = all('SELECT * FROM routines');
  const enabled = rows.filter((r) => r.enabled);
  const st = (s) => rows.filter((r) => r.enabled && r.state === s).length;
  const teams = new Set(rows.map((r) => r.team)).size;
  res.json({
    wordmark: meta('wordmark', 'Switchboard'),
    killSwitch: meta('kill_switch', 'false') === 'true',
    total: rows.length, enabled: enabled.length, teams,
    running: st('running'), needsHuman: st('needs_human'), failing: st('failing'),
    runsToday: 38, success7d: 89, reactions24h: 23,
    leases: rows.filter((r) => r.enabled && r.lease_ref).length,
  });
});

app.get('/api/routines', (_q, res) => res.json(all('SELECT * FROM routines ORDER BY ord').map(shapeRoutine)));

app.get('/api/routines/:slug', (req, res) => {
  const r = one('SELECT * FROM routines WHERE slug=?', req.params.slug);
  if (!r) return res.status(404).json({ error: 'not found' });
  const detail = r.slug === 'pr-cleanup' ? PR_CLEANUP_DETAIL : genDetail(r);
  const runHistory = all('SELECT * FROM runs WHERE routine_slug=? ORDER BY ord', r.slug)
    .map((x) => ({ id: x.id, status: x.status, ago: x.ago, dur: x.dur, trigger: x.trigger }));
  res.json({ ...shapeRoutine(r), ...detail, runHistory });
});

app.get('/api/runs', (_q, res) => {
  res.json(all('SELECT * FROM runs ORDER BY ord').map((x) => {
    const r = one('SELECT name FROM routines WHERE slug=?', x.routine_slug);
    return { id: x.id, routineSlug: x.routine_slug, routineName: r?.name ?? x.routine_slug, status: x.status, ago: x.ago, dur: x.dur, trigger: x.trigger };
  }));
});

app.get('/api/runs/:id', (req, res) => {
  const x = one('SELECT * FROM runs WHERE id=?', req.params.id);
  if (!x) return res.status(404).json({ error: 'not found' });
  if (x.id === 'run_8f3a2') return res.json({ id: x.id, ...RUN_8F3A2 });
  res.json({
    id: x.id, routine: x.routine_slug, status: x.status, trigger: x.trigger,
    started: '14:00:00', elapsed: x.dur, model: 'claude-opus-4-8',
    timeline: [
      { t: '00:00', tag: 'dispatch', text: `Dispatcher admitted run · trigger ${x.trigger}`, dot: '#5fbf86' },
      { t: '00:01', tag: 'setup', text: 'Checked out head in an isolated worktree', dot: '#7f8a80' },
      { t: x.dur, tag: 'output', text: 'Wrote structured summary · status surface upserted', dot: x.status === 'failing' ? '#e5736b' : '#5fbf86' },
    ],
    awaiting: null,
    summary: { result: x.status === 'failing' ? 'Left a Needs-Attention note' : 'Completed', iteration: '1 of 1', commit: '—', surface: 'status surface upserted' },
    diff: null,
    dispatcher: [{ label: 'Lease', val: 'n/a · read-only' }, { label: 'Decision', val: 'admit' }],
    outputs: [{ dot: '#5fbf86', label: 'Status surface', val: 'updated', tone: 'accent' }],
    leaseBarrier: [['decision', 'admit'], ['trigger', x.trigger]],
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
  run('INSERT INTO activity (time,text,state,ord) VALUES (?,?,?,?)', 'now', `${r.slug} dispatched manually · Run now`, 'running', -1);
  res.json({ ok: true, status: 'running' });
});

app.post('/api/kill-switch', (req, res) => {
  const engaged = !!req.body?.engaged;
  run("UPDATE meta SET value=? WHERE key='kill_switch'", engaged ? 'true' : 'false');
  res.json({ killSwitch: engaged });
});

app.listen(PORT, () => console.log(`Switchboard API on http://localhost:${PORT}`));
