// Deterministic GitHub + Slack I/O run by the harness itself (not the agent):
// barrier SHA checks, flow polling, status-surface upserts, notifications.
import { spawn } from 'node:child_process';

export function sh(cmd, args, { input, env, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(cmd, args, { env: env ?? process.env }); }
    catch (e) { return resolve({ code: -1, out: '', err: `spawn failed: ${e.message}` }); }
    let out = '', err = '';
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out: '', err: `${cmd} not runnable: ${e.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out: out.trim(), err: err.trim() }); });
    if (input != null) { child.stdin.write(input); child.stdin.end(); }
  });
}
export const gh = (args, opts) => sh('gh', args, opts);

export async function livePrHeadSha(repo, pr) {
  const r = await gh(['pr', 'view', String(pr), '--repo', repo, '--json', 'headRefOid', '--jq', '.headRefOid']);
  return r.code === 0 ? r.out.trim() : null;
}

export async function prView(repo, pr, fields) {
  const r = await gh(['pr', 'view', String(pr), '--repo', repo, '--json', fields]);
  if (r.code !== 0) return { err: r.err || `gh exited ${r.code}` };
  try { return { pr: JSON.parse(r.out) }; } catch { return { err: 'unparseable gh output' }; }
}

export async function resolvePrFromBranch(repo, branch) {
  const r = await gh(['pr', 'list', '--repo', repo, '--head', branch, '--state', 'all', '--json', 'number', '--jq', '.[0].number']);
  return r.code === 0 && r.out.trim() ? Number(r.out.trim()) : null;
}

let _login = null;
export async function ghLogin() {
  if (_login !== null) return _login;
  const r = await gh(['api', 'user', '--jq', '.login']);
  _login = r.code === 0 ? r.out.trim() : '';
  return _login;
}

// Find-and-update one idempotent PR comment by marker; create if absent.
export async function upsertPrComment(repo, pr, marker, body) {
  const text = `${marker}\n${body}`;
  const list = await gh(['api', `repos/${repo}/issues/${pr}/comments?per_page=100`, '--jq',
    `[.[] | select(.body | startswith(${JSON.stringify(marker)}))][0].id`]);
  const id = list.code === 0 && list.out.trim() && list.out.trim() !== 'null' ? list.out.trim() : null;
  const r = id
    ? await gh(['api', '--method', 'PATCH', `repos/${repo}/issues/comments/${id}`, '-f', `body=${text}`])
    : await gh(['api', '--method', 'POST', `repos/${repo}/issues/${pr}/comments`, '-f', `body=${text}`]);
  return { ok: r.code === 0, ref: id ?? 'created', err: r.err };
}

export async function emitCheckRun(repo, sha, name, ok, summary) {
  const r = await gh(['api', '--method', 'POST', `repos/${repo}/check-runs`,
    '-f', `name=${name}`, '-f', `head_sha=${sha}`, '-f', 'status=completed',
    '-f', `conclusion=${ok ? 'success' : 'failure'}`,
    '-f', 'output[title]=routine result', '-f', `output[summary]=${summary.slice(0, 600)}`]);
  return { ok: r.code === 0, err: r.err };
}

// Slack Web API — used for slack-message status surfaces and failure notify.
export async function slackPost(channel, text, { token = process.env.SLACK_BOT_TOKEN, ts = null } = {}) {
  if (!token) return { ok: false, err: 'no SLACK_BOT_TOKEN' };
  const api = ts ? 'chat.update' : 'chat.postMessage';
  try {
    const res = await (await fetch(`https://slack.com/api/${api}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel, text, ...(ts ? { ts } : {}) }),
    })).json();
    return res.ok ? { ok: true, ref: res.ts, channel: res.channel } : { ok: false, err: res.error };
  } catch (e) { return { ok: false, err: `network: ${e.message}` }; }
}
