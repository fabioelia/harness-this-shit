// The Fleet-app backbone surface: filter-group DSL, scope-shorthand leases,
// coalesce inbox + drain, kill switch, chain push, writer round-trip, timeouts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadDir } from '../src/loader.js';
import { HarnessLog } from '../src/log.js';
import { loadState, materialize } from '../src/state.js';
import { Dispatcher } from '../src/dispatch.js';
import { FlowManager } from '../src/flow.js';
import { fromManual, makeEnvelope } from '../src/events.js';
import { filterGroupsMatch, triggerMatches } from '../src/match.js';
import { normalizeRoutine } from '../src/schema.js';
import { uiToMeta, routineFileText, flowToReactions } from '../src/writer.js';
import { parseRoutineFile } from '../src/frontmatter.js';
import { replay } from '../src/log.js';

const FAKE = join(dirname(fileURLToPath(import.meta.url)), 'fake-claude.js');
process.env.CLAUDE_BIN = FAKE;
chmodSync(FAKE, 0o755);

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'harness-bb-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  const loaded = loadDir(dir);
  assert.deepEqual(loaded.failures.map((f) => f.errors).flat(), []);
  const log = new HarnessLog(dir);
  const state = loadState(dir);
  const d = new Dispatcher({ dir, log, state, routines: loaded.routines, registry: loaded.connectors, config: loaded.config });
  return { dir, d, loaded, log, state };
}

test('filter-group DSL matches like the Fleet UI', () => {
  const p = { action: 'opened', pull_request: { user: { login: 'fabio' }, head: { ref: 'develop' }, draft: false, labels: [{ name: 'auto' }] } };
  assert.ok(filterGroupsMatch({ match: 'all', groups: [{ match: 'all', conditions: [{ field: 'action', op: 'is', values: ['opened', 'synchronize'] }, { field: 'author', op: 'is_not', values: ['dependabot[bot]'] }] }] }, p));
  assert.ok(!filterGroupsMatch({ groups: [{ match: 'all', conditions: [{ field: 'branch', op: 'is', values: ['main'] }] }] }, p));
  assert.ok(filterGroupsMatch({ match: 'any', groups: [{ match: 'all', conditions: [{ field: 'branch', op: 'is', values: ['main'] }] }, { match: 'all', conditions: [{ field: 'label', op: 'contains', values: ['aut'] }] }] }, p));
});

test('github trigger honors embedded filters', () => {
  const { routine } = normalizeRoutine({
    name: 'f', summary: 's', owner: 'o',
    on: [{ github: { event: 'pull_request', filters: { match: 'all', groups: [{ match: 'all', conditions: [{ field: 'action', op: 'is', values: ['opened'] }] }] } } }],
  }, {});
  const env = (action) => makeEnvelope('github', 'pull_request', { action, pull_request: { number: 1 }, repository: { full_name: 'a/b' } });
  assert.ok(triggerMatches(routine, routine.on[0], env('opened')));
  assert.ok(!triggerMatches(routine, routine.on[0], env('closed')));
});

test('scope shorthand synthesizes per-routine PR lease; coalesce hands off to inbox and drains', async () => {
  const { dir, d } = fixture({
    'co.md': `---\nname: Co\nsummary: s\nowner: o\non: [{ manual: {} }]\nconcurrency: { scope: pr, on_conflict: coalesce }\nruntime: { timeout: 30s }\n---\n## Prompt\nx\n`,
  });
  const r = d.bySlug('co');
  const env = () => makeEnvelope('manual', 'manual', { event: 'manual', pull_request: { number: 9 }, repository: { full_name: 'acme/x' } });
  process.env.FAKE_HANG = '1';
  try {
    const first = d.dispatch(r, null, env());
    await new Promise((res) => setTimeout(res, 700));
    assert.ok([...d.leases.keys()].includes('co@pr:acme/x#9'), `lease keys: ${[...d.leases.keys()]}`);
    delete process.env.FAKE_HANG;
    const second = await d.dispatch(r, null, env());
    assert.equal(second.coalesced, true);
    assert.equal(d.pendingTasks('co@pr:acme/x#9').length, 1);
    d.cancel([...d.state.runs.keys()][0]);
    await first;
    // drain fired a fresh run for the pending task
    await new Promise((res) => setTimeout(res, 600));
    const text = readFileSync(join(dir, '.harness'), 'utf8');
    assert.match(text, /"ev":"task.added"/);
    assert.match(text, /"ev":"inbox.drain"/);
    assert.match(text, /"ev":"task.claimed"/);
  } finally { delete process.env.FAKE_HANG; }
});

test('kill switch blocks dispatch until cleared', async () => {
  const { d } = fixture({ 'k.md': `---\nname: K\nsummary: s\nowner: o\non: [{ manual: {} }]\nruntime: { timeout: 30s }\n---\n## Prompt\nx\n` });
  d.state.killSwitch = true;
  const res = await d.dispatch(d.bySlug('k'), null, fromManual({}, 't'));
  assert.equal(res.skipped, true);
  assert.match(res.reason, /kill switch/);
  d.state.killSwitch = false;
  assert.equal((await d.dispatch(d.bySlug('k'), null, fromManual({}, 't'))).ok, true);
});

test('chain pushes to downstream with upstream context', async () => {
  const { dir, d } = fixture({
    'a.md': `---\nname: A\nsummary: s\nowner: o\non: [{ manual: {} }]\nchain: [b]\nruntime: { timeout: 30s }\n---\n## Prompt\nx\n`,
    'b.md': `---\nname: B\nsummary: s\nowner: o\non: [{ manual: {} }]\nruntime: { timeout: 30s }\n---\n## Prompt\nUpstream said: \${{ upstream.output }}\n`,
  });
  const res = await d.dispatch(d.bySlug('a'), null, fromManual({}, 't'));
  assert.equal(res.ok, true);
  await new Promise((r) => setTimeout(r, 800));
  const entries = replay(dir);
  assert.ok(entries.some((e) => e.ev === 'chain.fired' && e.from === 'a' && e.to === 'b'));
  const bRun = [...materialize(entries).runs.values()].find((x) => x.slug === 'b');
  assert.ok(bRun, 'chained run for b exists');
  assert.equal(bRun.kind, 'chain');
});

test('run ledger carries event payload, output, tokens for the UI', async () => {
  const { dir, d } = fixture({ 'l.md': `---\nname: L\nsummary: s\nowner: o\non: [{ manual: {} }]\nruntime: { timeout: 30s }\n---\n## Prompt\nx\n` });
  const env = makeEnvelope('manual', 'manual', { event: 'manual', marker: 'xyz123' });
  await d.dispatch(d.bySlug('l'), null, env);
  const s = materialize(replay(dir));
  const run = [...s.runs.values()][0];
  assert.equal(run.event.marker, 'xyz123');
  assert.match(run.output, /did the thing/);
  assert.equal(run.inTokens, 100);
  assert.equal(run.outTokens, 20);
});

test('writer: UI body → docs/02 file → loads back equivalently', () => {
  const body = {
    name: 'PR Review', slug: 'pr-review', summary: 'Reviews PRs.', owner: 'platform', team: 'platform',
    triggers: ['pull_request', 'schedule', 'manual'], schedule: '0 8 * * 1-5',
    filters: { match: 'all', groups: [{ match: 'all', conditions: [{ field: 'action', op: 'is', values: ['opened', 'synchronize'] }] }] },
    connectors: ['github', 'slack'], model: 'claude-opus-4-8', effort: 'high',
    repo: 'acme/x, acme/y', branch: 'develop', memory: true,
    concurrency: { scope: 'pr', onConflict: 'coalesce' }, retries: 2,
    chain: ['announce'],
    reactions: [
      { source: 'github', kind: 'checks', when: 'failure', check: 'ci/test', run: 'ci-triage' },
      { source: 'github', kind: 'review', when: 'approved', check: '', run: 'merge-ready' },
      { source: 'timeout', kind: 'after', when: '30m', check: '', run: 'nudge' },
    ],
    prompt: 'Review the PR carefully.',
  };
  const meta = uiToMeta(body);
  const text = routineFileText(meta, body.prompt);
  const parsed = parseRoutineFile(text);
  const { routine, errors } = normalizeRoutine(parsed.meta, { file: 'pr-review.md' });
  assert.deepEqual(errors, []);
  assert.equal(routine.slug, 'pr-review');
  assert.deepEqual(routine.on.map((t) => t.type), ['github', 'schedule', 'manual']);
  assert.equal(routine.on[0].config.event, 'pull_request');
  assert.equal(routine.on[0].config.filters.groups[0].conditions[0].values[1], 'synchronize');
  assert.equal(routine.on[1].config.cron, '0 8 * * 1-5');
  assert.deepEqual(routine.tools.mcp, ['github', 'slack']);
  assert.deepEqual(routine.runtime.repo, ['acme/x', 'acme/y']);
  assert.equal(routine.runtime.branch, 'develop');
  assert.equal(routine.state.enabled, true);
  assert.equal(routine.concurrency.scope, 'pr');
  assert.equal(routine.concurrency.scopeConflict, 'coalesce');
  assert.equal(routine.policy.retry.max, 2);
  assert.deepEqual(routine.chain, ['announce']);
  assert.equal(routine.flow.reactions.length, 3);
  assert.match(parsed.prompt, /Review the PR carefully/);
  // and back to UI rows
  const rows = flowToReactions(routine.flow);
  assert.deepEqual(rows[0], { source: 'github', kind: 'checks', when: 'failure', check: 'ci/test', run: 'ci-triage' });
  assert.deepEqual(rows[2], { source: 'timeout', kind: 'after', when: '30m', check: '', run: 'nudge' });
});

test('flow timeout reaction fires after its duration', async () => {
  const { dir, d } = fixture({
    't.md': `---\nname: T\nsummary: s\nowner: o\non: [{ manual: {} }]\nflow:\n  subscribe: { reconcile: 45s, ttl: 1h }\n  reactions:\n    - when: { timeout: { after: 1s } }\n      do: routine:t2\n---\n## Prompt\nx\n`,
    't2.md': `---\nname: T2\nsummary: s\nowner: o\non: [{ manual: {} }]\nruntime: { timeout: 30s }\n---\n## Prompt\ny\n`,
  });
  const fm = new FlowManager(d);
  d.flow = fm;
  await d.dispatch(d.bySlug('t'), null, fromManual({}, 'x'));
  assert.equal([...d.state.flows.values()].filter((f) => f.status === 'open').length, 1, 'timer-only subscription opened');
  await new Promise((r) => setTimeout(r, 1100));
  await fm.tick();
  await new Promise((r) => setTimeout(r, 700));
  const entries = replay(dir);
  assert.ok(entries.some((e) => e.ev === 'flow.reaction' && e.reaction === 'routine:t2'));
  const t2 = [...materialize(entries).runs.values()].find((x) => x.slug === 't2');
  assert.ok(t2, 'timeout reaction dispatched t2');
  // a timer fires exactly once — a second tick must not re-dispatch
  const before = entries.filter((e) => e.ev === 'flow.reaction').length;
  await fm.tick();
  assert.equal(replay(dir).filter((e) => e.ev === 'flow.reaction').length, before);
});
