import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fromGithub, makeEnvelope } from '../src/events.js';
import { triggerMatches, matchFleet } from '../src/match.js';
import { normalizeRoutine } from '../src/schema.js';
import { HarnessLog, replay } from '../src/log.js';
import { materialize } from '../src/state.js';

const routine = (meta) => {
  const { routine: r, errors } = normalizeRoutine(meta, {});
  assert.deepEqual(errors, []);
  return { ...r, handlers: {}, prompt: 'x' };
};

test('github label event matches label trigger (incl. labeled alias)', () => {
  const r = routine({
    name: 'tp', summary: 's', owner: 'o',
    on: [{ github: { event: 'label', name: 'jira-ticket', on: 'added' } }],
  });
  const payload = { action: 'labeled', label: { name: 'jira-ticket' }, pull_request: { number: 3, labels: [{ name: 'jira-ticket' }] }, repository: { full_name: 'acme/x' } };
  const [prEnv, labelEnv] = fromGithub('pull_request', payload, 'd1');
  assert.ok(labelEnv, 'labeled delivery also surfaces as label event');
  assert.ok(triggerMatches(r, r.on[0], labelEnv));
  assert.ok(!triggerMatches(r, r.on[0], prEnv));           // event name mismatch on the raw pr envelope
});

test('branch/path/action/draft filters and if: guard', () => {
  const r = routine({
    name: 'x', summary: 's', owner: 'o',
    on: [{ github: { event: 'pull_request', actions: ['opened'], branches: ['develop'], draft: false, if: "pr.author != 'dependabot[bot]'" } }],
  });
  const mk = (over = {}) => makeEnvelope('github', 'pull_request', {
    action: 'opened',
    pull_request: { number: 1, draft: false, user: { login: 'fabio' }, head: { ref: 'develop', sha: 'abc' }, ...over.pr },
    repository: { full_name: 'acme/x' },
    ...over.top,
  });
  assert.ok(triggerMatches(r, r.on[0], mk()));
  assert.ok(!triggerMatches(r, r.on[0], mk({ top: { action: 'closed' } })));
  assert.ok(!triggerMatches(r, r.on[0], mk({ pr: { draft: true } })));
  assert.ok(!triggerMatches(r, r.on[0], mk({ pr: { user: { login: 'dependabot[bot]' } } })));
});

test('check_run conclusion + name glob', () => {
  const r = routine({
    name: 'x', summary: 's', owner: 'o',
    on: [{ github: { event: 'check_run', status: 'completed', name: 'ci/*', conclusion: ['failure'] } }],
  });
  const env = (name, conclusion) => makeEnvelope('github', 'check_run', { action: 'completed', check_run: { name, status: 'completed', conclusion }, repository: { full_name: 'acme/x' } });
  assert.ok(triggerMatches(r, r.on[0], env('ci/test', 'failure')));
  assert.ok(!triggerMatches(r, r.on[0], env('ci/test', 'success')));
  assert.ok(!triggerMatches(r, r.on[0], env('lint', 'failure')));
});

test('after + connector + webhook matching', () => {
  const after = routine({ name: 'x', summary: 's', owner: 'o', on: [{ after: { routine: 'upstream', on: ['success'] } }] });
  const okEnv = makeEnvelope('after', 'after', {}, { upstream: { routine: 'upstream', outcome: 'success' } });
  const badEnv = makeEnvelope('after', 'after', {}, { upstream: { routine: 'upstream', outcome: 'failure' } });
  assert.ok(triggerMatches(after, after.on[0], okEnv));
  assert.ok(!triggerMatches(after, after.on[0], badEnv));

  const slackR = routine({ name: 'y', summary: 's', owner: 'o', on: [{ slack: { event: 'message', channel: 'C0BUGS' } }] });
  assert.ok(triggerMatches(slackR, slackR.on[0], makeEnvelope('slack', 'message', { channel: 'C0BUGS', text: 'hi' })));
  assert.ok(!triggerMatches(slackR, slackR.on[0], makeEnvelope('slack', 'message', { channel: 'C0OTHER' })));

  const whR = routine({ name: 'z', summary: 's', owner: 'o', on: [{ webhook: { id: 'deploy-done' } }] });
  assert.ok(triggerMatches(whR, whR.on[0], makeEnvelope('webhook', 'deploy-done', {}, { webhook_id: 'deploy-done' })));
  assert.equal(matchFleet([slackR, whR, after], makeEnvelope('slack', 'message', { channel: 'C0BUGS' })).length, 1);
});

test('.harness log: append, redact, replay, materialize', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-test-'));
  const log = new HarnessLog(dir);
  log.redactSecret('xoxb-super-secret-token-1234');
  log.append('harness.up', { pid: process.pid, port: 1, routines: 1 });
  log.append('run.start', { run: 'run_1', slug: 'a', trigger: 'manual' });
  log.append('run.event', { run: 'run_1', seq: 0, type: 'text', text: 'posting with xoxb-super-secret-token-1234 now' });
  log.append('budget.tick', { key: 'pr:7', used: 1, max: 3 });
  log.append('run.done', { run: 'run_1', slug: 'a', ok: true, ms: 5, cost_usd: 0.01, summary: 'done', resource: 'pr:acme/x#7' });
  log.append('run.pending', { run: 'run_2', slug: 'a', approvers: ['lead'] });
  log.append('flow.subscribed', { flow: 'flow_1', run: 'run_1', slug: 'a', repo: 'acme/x', pr: 7, events: ['check_run'], until: ['merged'], reconcile_ms: 60000, expires_at: Date.now() + 1000 });

  const rawText = readFileSync(join(dir, '.harness'), 'utf8');
  assert.ok(!rawText.includes('xoxb-super-secret-token-1234'), 'secret must be redacted');
  assert.ok(rawText.includes('***'));

  const entries = replay(dir);
  assert.equal(entries.length, 7);
  const s = materialize(entries);
  assert.equal(s.runs.get('run_1').status, 'succeeded');
  assert.equal(s.budgets.get('pr:7'), 1);
  assert.equal(s.approvals.get('run_2').status, 'pending');
  assert.equal(s.flows.get('flow_1').status, 'open');
  assert.equal(s.lastRunFor.has('pr:acme/x#7'), true);
});
