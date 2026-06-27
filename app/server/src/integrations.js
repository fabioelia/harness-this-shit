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

// Discover the check names that actually run on a repo, so a reaction can target a
// SPECIFIC check. Unions real recent check-run names + commit-status contexts + GHA
// workflow names (some workflows may not have run on the default branch yet). Cached.
const _checkCache = new Map();
export async function listChecks(repo) {
  if (!repo) return [];
  const c = _checkCache.get(repo);
  if (c && Date.now() - c.at < 120_000) return c.names;
  const br = await gh(['repo', 'view', repo, '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name']);
  const branch = br.code === 0 && br.out.trim() ? br.out.trim() : 'main';
  const names = new Set();
  const add = (r) => { if (r.code === 0) r.out.split('\n').map((s) => s.trim()).filter(Boolean).forEach((n) => names.add(n)); };
  add(await gh(['api', `repos/${repo}/commits/${branch}/check-runs?per_page=100`, '--jq', '.check_runs[].name']));
  add(await gh(['api', `repos/${repo}/commits/${branch}/status`, '--jq', '.statuses[].context']));
  add(await gh(['workflow', 'list', '--repo', repo, '--json', 'name', '--jq', '.[].name']));
  const out = [...names].filter(Boolean).sort();
  _checkCache.set(repo, { at: Date.now(), names: out });
  return out;
}

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

// The Claude account this harness runs sessions as (cached ~60s).
let _claude = null, _claudeAt = 0;
export async function claudeAccount() {
  if (_claude && Date.now() - _claudeAt < 60_000) return _claude;
  const r = await sh('claude', ['auth', 'status']);
  let acct = { loggedIn: false };
  if (r.code === 0) { try { const o = JSON.parse(r.out); acct = { loggedIn: !!o.loggedIn, email: o.email || null, org: o.orgName || null, plan: o.subscriptionType || null, method: o.authMethod || null }; } catch { /* non-json */ } }
  _claude = acct; _claudeAt = Date.now();
  return _claude;
}

// Live, on-demand connectivity test for a connector. Optional {channel,text} for slack.
export async function testConnector(code, { channel, text } = {}) {
  const c = String(code || '').toLowerCase();
  if (c === 'gh' || c === 'github') {
    const r = await gh(['api', 'user', '--jq', '.login']);
    return r.code === 0 ? { ok: true, detail: `authenticated as @${r.out.trim()}` } : { ok: false, detail: r.err || 'gh not authed — run `gh auth login`' };
  }
  if (c === 'sl' || c === 'slack') {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) return { ok: false, detail: 'no Slack token configured' };
    try {
      const a = await (await fetch('https://slack.com/api/auth.test', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })).json();
      if (!a.ok) return { ok: false, detail: `auth.test failed: ${a.error}` };
      if (channel) {
        const p = await (await fetch('https://slack.com/api/chat.postMessage', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ channel, text: text || 'Switchboard connector test ✅' }) })).json();
        if (p.ok) return { ok: true, detail: `posted a test message to ${p.channel} as @${a.user}` };
        return { ok: false, detail: p.error === 'not_in_channel' ? `auth ok (${a.team}) — but bot isn't in ${channel}; /invite it` : `auth ok (${a.team}) but post failed: ${p.error}` };
      }
      return { ok: true, detail: `token valid · ${a.team} · @${a.user}` };
    } catch (e) { return { ok: false, detail: `network error: ${e.message}` }; }
  }
  if (c === 'wb' || c === 'web') {
    try { const r = await fetch('https://example.com', { method: 'HEAD' }); return { ok: r.ok, detail: `web reachable · HTTP ${r.status}` }; }
    catch (e) { return { ok: false, detail: `web unreachable: ${e.message}` }; }
  }
  if (c === 'at' || c === 'atlassian') {
    return process.env.ATLASSIAN_API_TOKEN ? { ok: true, detail: 'token is set (Confluence publish is not yet a granted tool)' } : { ok: false, detail: 'set an Atlassian API token to enable' };
  }
  return { ok: false, detail: 'unknown connector' };
}

// Live status of the harness's real integrations (cached ~30s).
let _status = null, _statusAt = 0;
export function bustStatus() { _status = null; _statusAt = 0; }
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

