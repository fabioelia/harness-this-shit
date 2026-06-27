// Deterministic I/O run by the harness itself (NOT by the agent): GitHub via the
// `gh` CLI and Slack via the Web API. Keeps the Claude instance text-only/safe
// while the harness does real, reviewable side effects.
import { spawn } from 'node:child_process';

export function sh(cmd, args, { input } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { env: process.env });
    } catch (e) {
      return resolve({ code: -1, out: '', err: `spawn failed: ${e.message}` });
    }
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => resolve({ code: -1, out: '', err: `${cmd} not runnable: ${e.message}` }));
    child.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
    if (input != null) { child.stdin.write(input); child.stdin.end(); }
  });
}
export const gh = (args, opts) => sh('gh', args, opts);

// The orgs the user belongs to — so the picker can scope to any of them.
let _orgCache = { at: 0, orgs: [] };
export async function listOrgs() {
  if (Date.now() - _orgCache.at < 300_000 && _orgCache.orgs.length) return _orgCache.orgs;
  const res = await gh(['api', 'user/orgs', '--paginate', '--jq', '.[].login']);
  const orgs = res.code === 0 ? [...new Set(res.out.split('\n').map((s) => s.trim()).filter(Boolean))].sort() : [];
  if (orgs.length) _orgCache = { at: Date.now(), orgs };
  return orgs;
}

// Resolve repos for the picker, cached 60s per (owner,q):
//  - q + owner '*'   → search all of GitHub by query
//  - q + owner <org> → search within that org
//  - owner <org>     → list that org's repos
//  - (none)          → the authenticated user's repos (owned + collaborator)
const _repoCaches = new Map();
const lines = (res) => (res.code === 0 ? [...new Set(res.out.split('\n').map((s) => s.trim()).filter(Boolean))].sort() : []);
export async function listRepos({ owner = '', q = '' } = {}) {
  const key = `${owner}|${q}`;
  const c = _repoCaches.get(key);
  if (c && Date.now() - c.at < 60_000) return c.repos;
  let res;
  if (q && owner && owner !== '*') res = await gh(['search', 'repos', q, '--owner', owner, '--limit', '50', '--json', 'fullName', '--jq', '.[].fullName']);
  else if (q) res = await gh(['search', 'repos', q, '--limit', '50', '--json', 'fullName', '--jq', '.[].fullName']);
  else if (owner && owner !== '*') res = await gh(['repo', 'list', owner, '--limit', '200', '--json', 'nameWithOwner', '--jq', '.[].nameWithOwner']);
  else res = await gh(['repo', 'list', '--limit', '200', '--json', 'nameWithOwner', '--jq', '.[].nameWithOwner']);
  const repos = lines(res);
  if (repos.length) _repoCaches.set(key, { at: Date.now(), repos });
  return repos;
}

// Live status of the harness's real integrations (cached ~30s).
let _status = null, _statusAt = 0;
export async function integrationStatus() {
  if (_status && Date.now() - _statusAt < 30_000) return _status;
  const who = await gh(['api', 'user', '-q', '.login']);
  let slack = { ok: false };
  if (process.env.SLACK_BOT_TOKEN) {
    try {
      const r = await fetch('https://slack.com/api/auth.test', { method: 'POST', headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` } });
      slack = await r.json();
    } catch { /* offline */ }
  }
  _status = {
    github: { connected: who.code === 0, account: who.code === 0 ? who.out : null },
    slack: { connected: !!slack.ok, team: slack.team || null, bot: slack.user || null },
  };
  _statusAt = Date.now();
  return _status;
}

