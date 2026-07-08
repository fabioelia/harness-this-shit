// End-to-end dispatch against a fake `claude` binary: admission pipeline,
// leases, budgets, approvals, secrets, and the .harness record of it all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadDir } from '../src/loader.js';
import { HarnessLog } from '../src/log.js';
import { loadState } from '../src/state.js';
import { Dispatcher } from '../src/dispatch.js';
import { fromManual, makeEnvelope } from '../src/events.js';

const FAKE = join(dirname(fileURLToPath(import.meta.url)), 'fake-claude.js');
process.env.CLAUDE_BIN = FAKE;
chmodSync(FAKE, 0o755);

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'harness-e2e-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  const loaded = loadDir(dir);
  assert.deepEqual(loaded.failures, []);
  const log = new HarnessLog(dir);
  const state = loadState(dir);
  const d = new Dispatcher({ dir, log, state, routines: loaded.routines, registry: loaded.connectors, config: loaded.config });
  return { dir, d, loaded };
}

const SIMPLE = `---
name: Simple
summary: s
owner: o
on: [{ manual: {} }]
runtime: { timeout: 30s }
---
## Prompt
Say hi.
`;

test('manual run succeeds end-to-end and lands in .harness', async () => {
  const { dir, d } = fixture({ 'simple.md': SIMPLE });
  const res = await d.dispatch(d.bySlug('simple'), null, fromManual({}, 'test'));
  assert.equal(res.ok, true);
  assert.match(res.summary, /did the thing/);
  const text = readFileSync(join(dir, '.harness'), 'utf8');
  assert.match(text, /"ev":"run.start"/);
  assert.match(text, /"ev":"run.done"/);
  assert.match(text, /"cost_usd":0.0123/);
  assert.equal([...d.state.runs.values()][0].status, 'succeeded');
});

test('secret values never reach .harness', async () => {
  process.env.TEST_TOKEN_FOR_HARNESS = 'sekret-value-9876543210';
  process.env.TEST_SECRET_VALUE = 'sekret-value-9876543210';   // fake-claude echoes it into its result
  const { dir, d } = fixture({
    'sec.md': `---\nname: Sec\nsummary: s\nowner: o\non: [{ manual: {} }]\nsecrets:\n  - { name: TOK, from: env://TEST_TOKEN_FOR_HARNESS }\nruntime: { timeout: 30s }\n---\n## Prompt\nUse \${{ secrets.TOK }}.\n`,
  });
  const res = await d.dispatch(d.bySlug('sec'), null, fromManual({}, 'test'));
  assert.equal(res.ok, true);
  const text = readFileSync(join(dir, '.harness'), 'utf8');
  assert.ok(!text.includes('sekret-value-9876543210'), 'secret leaked into .harness');
  delete process.env.TEST_SECRET_VALUE;
});

test('missing secret fails the run cleanly', async () => {
  const { d } = fixture({
    'sec2.md': `---\nname: Sec2\nsummary: s\nowner: o\non: [{ manual: {} }]\nsecrets:\n  - { name: TOK, from: env://DOES_NOT_EXIST_XYZ }\n---\n## Prompt\nx\n`,
  });
  const res = await d.dispatch(d.bySlug('sec2'), null, fromManual({}, 'test'));
  assert.equal(res.ok, false);
  assert.match(res.summary, /missing secrets: TOK/);
});

test('lease on_conflict: skip stands down; queue waits for release', async () => {
  const { d } = fixture({
    'leasy.md': `---\nname: Leasy\nsummary: s\nowner: o\non: [{ manual: {} }]\nconcurrency:\n  lease: { resource: "pr:acme/x#7", ttl: 5m, on_conflict: skip }\nruntime: { timeout: 30s }\n---\n## Prompt\nx\n`,
  });
  d.acquireLease('pr:acme/x#7', 'run_other', 'other', '', 300_000);
  const res = await d.dispatch(d.bySlug('leasy'), null, fromManual({}, 'test'));
  assert.equal(res.skipped, true);
  assert.match(res.reason, /held by run_other/);
  d.releaseLease('pr:acme/x#7', 'run_other');
  const res2 = await d.dispatch(d.bySlug('leasy'), null, fromManual({}, 'test'));
  assert.equal(res2.ok, true);
});

test('iteration budget exhausts into needs-human', async () => {
  const { dir, d } = fixture({
    'budgety.md': `---\nname: Budgety\nsummary: s\nowner: o\non: [{ manual: {} }]\nconcurrency:\n  budget: { key: "pr:9", max_iterations: 2, on_exhausted: needs-human }\nruntime: { timeout: 30s }\n---\n## Prompt\nx\n`,
  });
  const r = d.bySlug('budgety');
  assert.equal((await d.dispatch(r, null, fromManual({}, 't'))).ok, true);
  assert.equal((await d.dispatch(r, null, fromManual({}, 't'))).ok, true);
  const third = await d.dispatch(r, null, fromManual({}, 't'));
  assert.equal(third.skipped, true);
  assert.match(third.reason, /budget pr:9 exhausted/);
  assert.ok(d.state.needsHuman.has('pr:9'));
  assert.match(readFileSync(join(dir, '.harness'), 'utf8'), /"ev":"budget.exhausted"/);
});

test('requires_approval parks the run; approved dispatch executes', async () => {
  const { d } = fixture({
    'gated.md': `---\nname: Gated\nsummary: s\nowner: o\non: [{ manual: {} }]\npolicy: { requires_approval: true, approvers: [lead] }\nruntime: { timeout: 30s }\n---\n## Prompt\nx\n`,
  });
  const r = d.bySlug('gated');
  const env = fromManual({}, 'test');
  const res = await d.dispatch(r, null, env);
  assert.equal(res.pending, true);
  const a = d.state.approvals.get(res.id);
  assert.equal(a.status, 'pending');
  const res2 = await d.dispatch(r, null, a.event, { approved: true });
  assert.equal(res2.ok, true);
});

test('max_runs_per_day cap skips', async () => {
  const { d } = fixture({
    'capped.md': `---\nname: Capped\nsummary: s\nowner: o\non: [{ manual: {} }]\npolicy: { max_runs_per_day: 1 }\nruntime: { timeout: 30s }\n---\n## Prompt\nx\n`,
  });
  const r = d.bySlug('capped');
  assert.equal((await d.dispatch(r, null, fromManual({}, 't'))).ok, true);
  const second = await d.dispatch(r, null, fromManual({}, 't'));
  assert.equal(second.skipped, true);
  assert.match(second.reason, /max_runs_per_day/);
});

test('failed run reports failure', async () => {
  process.env.FAKE_FAIL = '1';
  try {
    const { d } = fixture({ 'f.md': `---\nname: F\nsummary: s\nowner: o\non: [{ manual: {} }]\nruntime: { timeout: 30s }\n---\n## Prompt\nx\n` });
    const res = await d.dispatch(d.bySlug('f'), null, fromManual({}, 't'));
    assert.equal(res.ok, false);
  } finally {
    delete process.env.FAKE_FAIL;
  }
});

test('timeout kills a hung session', async () => {
  process.env.FAKE_HANG = '1';
  try {
    const { d } = fixture({ 'h.md': `---\nname: H\nsummary: s\nowner: o\non: [{ manual: {} }]\nruntime: { timeout: 2s }\n---\n## Prompt\nx\n` });
    const res = await d.dispatch(d.bySlug('h'), null, fromManual({}, 't'));
    assert.equal(res.ok, false);
    assert.match(res.summary, /timed out/);
  } finally {
    delete process.env.FAKE_HANG;
  }
});

test('structured summary contract parses trailing JSON', async () => {
  const { d } = fixture({
    's.md': `---\nname: S\nsummary: s\nowner: o\non: [{ manual: {} }]\noutputs: { summary: structured }\nruntime: { timeout: 30s }\n---\n## Prompt\nx\n`,
  });
  // fake-claude's result ends with a PR URL line, not JSON → contract violation logged, run still ok
  const res = await d.dispatch(d.bySlug('s'), null, fromManual({}, 't'));
  assert.equal(res.ok, true);
});

test('group cancel_in_progress supersedes the running holder', async () => {
  process.env.FAKE_HANG = '1';
  try {
    const { d } = fixture({
      'g.md': `---\nname: G\nsummary: s\nowner: o\non: [{ manual: {} }]\nconcurrency: { group: "fixed", cancel_in_progress: true }\nruntime: { timeout: 20s }\n---\n## Prompt\nx\n`,
    });
    const r = d.bySlug('g');
    const first = d.dispatch(r, null, fromManual({}, 't'));          // hangs until killed
    await new Promise((res) => setTimeout(res, 600));                // let it acquire the group + spawn
    delete process.env.FAKE_HANG;
    const second = await d.dispatch(r, null, fromManual({}, 't'));
    const firstRes = await first;
    assert.equal(second.ok, true);
    assert.equal(firstRes.ok, false);                                // canceled by supersession
  } finally {
    delete process.env.FAKE_HANG;
  }
});
