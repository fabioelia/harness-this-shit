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

// Resolve a repo + PR number from a normalized event (best effort).
function prRef(event) {
  if (!event || typeof event !== 'object') return null;
  const repo = event.repository?.full_name || event.repository || event.repo;
  const number = event.pull_request?.number ?? event.pr_number ?? event.number;
  return repo && number ? { repo: String(repo), number: Number(number) } : { repo: repo ? String(repo) : null, number: null };
}

// Enrich an event with REAL GitHub data (the PR title/state/author/url) via gh.
// Resolves a PR by number, or — for a push — by the pushed branch (`gh pr list --head`).
export async function enrichEvent(event) {
  const ref = prRef(event);
  if (!ref?.repo) return event;
  let pr = null;
  if (ref.number) {
    const r = await gh(['pr', 'view', String(ref.number), '--repo', ref.repo, '--json', 'title,state,author,url,number,headRefName']);
    if (r.code === 0) { try { pr = JSON.parse(r.out); } catch { /* ignore */ } }
    else return { ...event, _enrich: `gh pr view failed: ${r.err || r.code}` };
  } else {
    const branch = (event.ref || '').replace('refs/heads/', '') || event.branch || event.pull_request?.head || '';
    if (!branch) return event;
    const r = await gh(['pr', 'list', '--repo', ref.repo, '--head', branch, '--state', 'open', '--json', 'title,state,author,url,number,headRefName']);
    if (r.code === 0) { try { pr = (JSON.parse(r.out) || [])[0] || null; } catch { /* ignore */ } }
    if (!pr) return { ...event, _enrich: `no open PR found for branch ${branch}` };
  }
  if (!pr) return event;
  return {
    ...event,
    pull_request: {
      ...(event.pull_request || {}),
      number: pr.number, title: pr.title, state: pr.state,
      author: pr.author?.login, url: pr.url, head: pr.headRefName,
    },
    _enriched_from: 'gh',
  };
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

export async function postSlack(channel, text) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return { ok: false, detail: 'SLACK_BOT_TOKEN not set' };
  if (!channel) return { ok: false, detail: 'no channel configured' };
  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel, text }),
    });
    const j = await res.json();
    if (j.ok) return { ok: true, detail: `posted to ${j.channel} @ ${j.ts}` };
    if (j.error === 'not_in_channel' || j.error === 'channel_not_found')
      return { ok: false, detail: `bot not in ${channel} — run “/invite @fabio_bot” there (one-time)` };
    return { ok: false, detail: `slack: ${j.error}` };
  } catch (e) {
    return { ok: false, detail: `slack error: ${e.message}` };
  }
}

// Deliver a routine's output to each configured sink. Returns delivery results.
export async function deliverSinks(sinks, output, event) {
  const results = [];
  for (const sink of sinks || []) {
    const type = sink.type;
    const target = (sink.target || '').trim();
    if (type === 'stdout') {
      results.push({ type, target: 'run.output', ok: true, detail: `${output.length} chars` });
    } else if (type === 'slack') {
      const channel = target || process.env.SLACK_DEFAULT_CHANNEL || '';
      const r = await postSlack(channel, output);
      results.push({ type, target: channel || '(unset)', ...r });
    } else if (type === 'github-comment') {
      const ref = prRef(event);
      const repo = (target.split('#')[0]) || ref?.repo;
      const num = target.includes('#') ? target.split('#')[1] : ref?.number;
      if (!repo || !num) { results.push({ type, target, ok: false, detail: 'no repo#pr resolved' }); continue; }
      const r = await gh(['pr', 'comment', String(num), '--repo', repo, '--body', output]);
      results.push({ type, target: `${repo}#${num}`, ok: r.code === 0, detail: r.code === 0 ? (r.out || 'commented') : (r.err || `gh exit ${r.code}`) });
    } else if (type === 'github-gist') {
      const r = await gh(['gist', 'create', '-d', target || 'switchboard output', '-'], { input: output });
      results.push({ type, target: target || 'gist', ok: r.code === 0, detail: r.code === 0 ? r.out : (r.err || `gh exit ${r.code}`) });
    } else if (type === 'confluence' || type === 'wiki') {
      const hasToken = !!(process.env.ATLASSIAN_API_TOKEN && process.env.ATLASSIAN_BASE_URL);
      results.push({ type, target: target || '(space)', ok: false, detail: hasToken ? 'publish not yet wired' : 'set ATLASSIAN_API_TOKEN + ATLASSIAN_BASE_URL to enable' });
    } else {
      results.push({ type, target, ok: false, detail: 'unknown sink type' });
    }
  }
  return results;
}
