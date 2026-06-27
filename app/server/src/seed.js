// A fresh store ships with a real, runnable starter fleet + agent team — the same
// definitions the "Load examples" button installs (samples.js), nothing fabricated.
import { SAMPLE_ROUTINES, SAMPLE_AGENTS, DEFAULT_REPO } from './samples.js';

const PALETTE = ['#5b9ee6', '#c9a24a', '#6fae9a', '#b49ae6', '#e0996a', '#7f9bd1', '#9a93a6'];
const pick = (s) => PALETTE[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];
const initials = (s) => String(s || '?').replace(/[^a-z0-9]/gi, ' ').trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
const fillRepo = (s, repo) => String(s || '').split('__REPO__').join(repo);

function insertRoutine(db, r, ord, repo) {
  const triggers = r.triggers || [];
  const next = triggers.includes('schedule') ? (r.schedule || 'scheduled') : triggers.length ? 'on event' : '—';
  db.prepare(
    `INSERT INTO routines
      (slug,name,summary,owner,team,triggers,connectors,state,last_ago,last_status,next,success,spend,enabled,meta_short,lease_ref,avg,av_color,initials,ord,prompt,model,repo,branch,chain,schedule,filters,reactions,effort,memory,concurrency)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    r.slug, r.name, r.summary || '', r.owner || 'platform', r.team || 'platform',
    JSON.stringify(triggers), JSON.stringify(r.connectors || []),
    'idle', 'never', 'idle', next, null, '$0.00', 1, '', '', '—',
    pick(r.owner || r.slug), initials(r.owner || r.name), ord,
    fillRepo(r.prompt, repo), r.model || 'claude-opus-4-8',
    r.repo === '__REPO__' ? repo : (r.repo || ''), 'main',
    JSON.stringify(r.chain || []), r.schedule || '', JSON.stringify(r.filters || {}),
    JSON.stringify(r.reactions || []), r.effort || '', r.memory ? 1 : 0, JSON.stringify(r.concurrency || {})
  );
}

function insertAgent(db, a, repo) {
  db.prepare(
    'INSERT INTO agents (name,role,summary,connectors,model,effort,memory,av_color,created_at) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(
    a.name, fillRepo(a.role, repo), a.summary || '', JSON.stringify(a.connectors || []),
    a.model || 'claude-opus-4-8', a.effort || '', a.memory ? 1 : 0, pick(a.name), Date.now()
  );
}

export function seed(db) {
  const repo = DEFAULT_REPO;
  SAMPLE_ROUTINES.forEach((r, i) => insertRoutine(db, r, i, repo));
  SAMPLE_AGENTS.forEach((a) => insertAgent(db, a, repo));
  db.prepare('INSERT INTO meta (key,value) VALUES (?,?)').run('kill_switch', 'false');
  db.prepare('INSERT INTO meta (key,value) VALUES (?,?)').run('wordmark', 'Switchboard');
}
