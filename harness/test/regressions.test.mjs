// Regression tests for the adversarially-verified review findings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadDir } from '../src/loader.js';
import { HarnessLog, replay } from '../src/log.js';
import { loadState, materialize } from '../src/state.js';
import { Dispatcher } from '../src/dispatch.js';
import { FlowManager } from '../src/flow.js';
import { fromManual, makeEnvelope } from '../src/events.js';
import { jsonForLog } from '../src/util.js';
import { normalizeRoutine } from '../src/schema.js';
import { parseRoutineFile } from '../src/frontmatter.js';
import { uiToMeta, routineFileText, mergeOn, mergeFlow, rebuildBody, patchRoutineMeta } from '../src/writer.js';

const FAKE = join(dirname(fileURLToPath(import.meta.url)), 'fake-claude.js');
process.env.CLAUDE_BIN = FAKE;
chmodSync(FAKE, 0o755);

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'harness-rg-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  const loaded = loadDir(dir);
  assert.deepEqual(loaded.failures.flatMap((f) => f.errors), []);
  const log = new HarnessLog(dir);
  const state = loadState(dir);
  const d = new Dispatcher({ dir, log, state, routines: loaded.routines, registry: loaded.connectors, config: loaded.config });
  d.flow = new FlowManager(d);
  return { dir, d, state, log };
}

// [0] Oversized payloads must not throw after the lease is acquired.
test('P0: a >20KB event payload does not leak the lease or vanish the run', async () => {
  const { dir, d } = fixture({ 'big.md': `---\nname: Big\nsummary: s\nowner: o\non: [{ manual: {} }]\nconcurrency: { scope: routine, on_conflict: wait }\nruntime: { timeout: 30s }\n---\n## Prompt\nx\n` });
  const huge = { event: 'manual', blob: 'A'.repeat(60_000) };
  const res = await d.dispatch(d.bySlug('big'), null, makeEnvelope('manual', 'manual', huge));
  assert.equal(res.ok, true, 'run completed despite huge payload');
  assert.equal(d.leases.size, 0, 'lease released — not leaked');
  const text = readFileSync(join(dir, '.harness'), 'utf8');
  assert.match(text, /"ev":"run.start"/);
  assert.match(text, /"ev":"run.done"/);
  for (const line of text.split('\n').filter(Boolean)) JSON.parse(line);   // every line stays valid JSON
});

test('jsonForLog never emits invalid JSON for oversized input', () => {
  const v = jsonForLog({ x: 'A'.repeat(50_000) }, 1000);
  assert.equal(v._truncated, true);
  JSON.parse(JSON.stringify(v));                                            // round-trips
  assert.deepEqual(jsonForLog({ a: 1 }), { a: 1 });
});

// [10] A pipeline exception must produce a terminal run.done, not a stuck 'running'.
test('P1: a dispatch pipeline exception terminates the run (no zombie running)', async () => {
  const { dir, d } = fixture({ 'e.md': `---\nname: E\nsummary: s\nowner: o\non: [{ manual: {} }]\nruntime: { timeout: 30s }\n---\n## Prompt\nx\n` });
  const r = d.bySlug('e');
  // force execute() to throw by making the registry getter blow up mid-pipeline
  d.config.getMcpAuth = () => { throw new Error('boom'); };
  r.tools.mcp = ['some-mcp'];                                               // triggers buildMcpConfig → getMcpAuth
  const res = await d.dispatch(r, null, fromManual({}, 't'));
  assert.equal(res.ok, false);
  const run = [...d.state.runs.values()][0];
  assert.equal(run.status, 'failed');
  assert.match(readFileSync(join(dir, '.harness'), 'utf8'), /"ev":"run.done"[^\n]*"ok":false/);
});

// [2] Kill switch engaged while a run waits in the lease queue must stop it.
test('P1: kill switch engaged mid-wait stops a lease-queued run', async () => {
  const { d } = fixture({ 'w.md': `---\nname: W\nsummary: s\nowner: o\non: [{ manual: {} }]\nconcurrency: { scope: routine, on_conflict: wait }\nruntime: { timeout: 30s }\n---\n## Prompt\nx\n` });
  const r = d.bySlug('w');
  d.acquireLease('routine:w', 'run_holder', 'w', '', 300_000);
  const p = d.dispatch(r, null, fromManual({}, 't'));                        // enters the wait loop
  await new Promise((res) => setTimeout(res, 200));
  d.state.killSwitch = true;                                                 // flip while queued
  const res = await p;
  assert.equal(res.skipped, true);
  assert.match(res.reason, /kill switch/);
  d.state.killSwitch = false;
});

// [3] Coalesced tasks are not lost when the drain run can't execute.
test('P1: coalesced tasks are unclaimed when the drain run is skipped', async () => {
  const { d } = fixture({ 'c.md': `---\nname: C\nsummary: s\nowner: o\non: [{ manual: {} }]\nconcurrency: { scope: pr, on_conflict: coalesce }\nruntime: { timeout: 30s }\n---\n## Prompt\nx\n` });
  const r = d.bySlug('c');
  const env = () => makeEnvelope('manual', 'manual', { event: 'manual', pull_request: { number: 3 }, repository: { full_name: 'a/b' } });
  process.env.FAKE_HANG = '1';
  try {
    const first = d.dispatch(r, null, env());
    await new Promise((res) => setTimeout(res, 600));
    const second = await d.dispatch(r, null, env());                        // coalesced → task added
    assert.equal(second.coalesced, true);
    assert.equal(d.pendingTasks('c@pr:a/b#3').length, 1);
    d.state.killSwitch = true;                                              // drain will be skipped
    d.cancel([...d.state.runs.keys()][0]);
    await first;
    await new Promise((res) => setTimeout(res, 300));
    // the drain run was skipped by the kill switch — the task must be back to pending, not lost
    d.state.killSwitch = false;
    assert.equal(d.pendingTasks('c@pr:a/b#3').length, 1, 'task returned to pending, not stranded');
  } finally { delete process.env.FAKE_HANG; d.state.killSwitch = false; }
});

// [1] Timeout reaction must not re-fire after a restart (replay rebuilds the guard key).
test('P1: flow timeout guard key survives replay (no re-fire after restart)', async () => {
  const { dir, d } = fixture({
    't.md': `---\nname: T\nsummary: s\nowner: o\non: [{ manual: {} }]\nflow:\n  subscribe: { reconcile: 45s, ttl: 1h }\n  reactions:\n    - when: { timeout: { after: 1s } }\n      do: routine:t2\n---\n## Prompt\nx\n`,
    't2.md': `---\nname: T2\nsummary: s\nowner: o\non: [{ manual: {} }]\nruntime: { timeout: 30s }\n---\n## Prompt\ny\n`,
  });
  await d.dispatch(d.bySlug('t'), null, fromManual({}, 'x'));
  await new Promise((res) => setTimeout(res, 1100));
  await d.flow.tick();
  const entries = replay(dir);
  const fired = entries.filter((e) => e.ev === 'flow.reaction').length;
  assert.equal(fired, 1, 'timer fired once');
  // simulate a restart: rebuild flow state from the log alone
  const s2 = materialize(entries);
  const flow = [...s2.flows.values()][0];
  assert.equal(flow.fired['timeout:routine:t2'], 1, 'the once-only guard key is rebuilt from replay');
});

// [13]/[8] PUT must preserve every:/at:/after:/webhook triggers + guards it can't model.
test('P0: mergeOn preserves non-UI triggers and guards on a rename-only edit', () => {
  const original = [
    { schedule: { every: '15m', jitter: '30s' } },
    { after: { routine: 'upstream', on: ['success'] } },
    { webhook: { id: 'deploy-done', secret: 'env://WH' } },
    { github: { event: 'pull_request', if: "pr.draft == false", debounce: '30s', actions: ['opened'] } },
    { manual: {} },
  ];
  // a rename-only edit → the UI rebuilds `on:` from its lossy view
  const uiTriggers = ['schedule', 'pull_request', 'manual'];   // UI can't see after/webhook, folds every into 'schedule'
  const uiOn = [{ schedule: { cron: '' } }, { github: { event: 'pull_request', filters: { match: 'all', groups: [] } } }, { manual: {} }];
  const merged = mergeOn(original, uiOn, uiTriggers);
  // every:/at: schedule preserved verbatim (not turned into an invalid cron)
  assert.ok(merged.some((e) => e.schedule?.every === '15m'), 'every: schedule preserved');
  assert.ok(!merged.some((e) => e.schedule?.cron === ''), 'no invalid empty cron written');
  // after: and webhook: preserved even though the UI never listed them
  assert.ok(merged.some((e) => e.after?.routine === 'upstream'), 'after: preserved');
  assert.ok(merged.some((e) => e.webhook?.id === 'deploy-done'), 'webhook: preserved');
  // github guards preserved
  const gh = merged.find((e) => e.github);
  assert.equal(gh.github.if, "pr.draft == false");
  assert.equal(gh.github.debounce, '30s');
  // the whole thing still loads
  const meta = { name: 'X', summary: 's', owner: 'o', on: merged };
  const { errors } = normalizeRoutine(meta, {});
  assert.deepEqual(errors, []);
});

test('P1: mergeFlow preserves handler + done reactions and per-reaction budgets', () => {
  const rawFlow = {
    subscribe: { events: ['check_run'], until: ['merged'], reconcile: '5m', ttl: '7d' },
    reactions: [
      { when: { check_run: { name: 'ci/*', conclusion: 'failure' } }, do: 'fix-ci', budget: { key: 'x', max: 3 } }, // handler
      { when: { pull_request_review: { state: 'changes_requested' } }, do: 'routine:cleanup' },                     // UI-visible
      { when: { pull_request: { merged: true } }, do: 'done' },                                                     // done
    ],
  };
  // the UI only ever saw the routine:cleanup row and re-sends it unchanged
  const uiRows = [{ source: 'github', kind: 'review', when: 'changes_requested', check: '', run: 'cleanup' }];
  const merged = mergeFlow(rawFlow, uiRows);
  assert.equal(merged.subscribe.reconcile, '5m', 'subscribe block preserved');
  assert.ok(merged.reactions.some((r) => r.do === 'fix-ci' && r.budget), 'handler reaction + budget preserved');
  assert.ok(merged.reactions.some((r) => r.do === 'done'), 'done reaction preserved');
  assert.ok(merged.reactions.some((r) => r.do === 'routine:cleanup'), 'UI reaction kept');
});

// [15] Prompt rewrite must keep the preamble and ## handler: sections.
test('P1: rebuildBody preserves preamble and handler sections', () => {
  const body = `# Title\n\nHuman context above the prompt.\n\n## Prompt\n\nOld operative prompt.\n\n## Constraints\n\n- rule\n\n## handler: fix-ci\n\nFix the check.\n`;
  const rebuilt = rebuildBody(body, 'New operative prompt.');
  assert.match(rebuilt, /Human context above the prompt/);
  assert.match(rebuilt, /New operative prompt/);
  assert.ok(!rebuilt.includes('Old operative prompt'));
  assert.match(rebuilt, /## handler: fix-ci/);
  assert.match(rebuilt, /Fix the check\./);
});

// [18] A no-op UI save must not pin the default model or inject a lease.
test('P2: uiToMeta with auto/wait concurrency writes no lease block', () => {
  const meta = uiToMeta({ name: 'X', summary: 's', owner: 'o', triggers: ['manual'], concurrency: { scope: 'auto', onConflict: 'wait' } });
  assert.equal(meta.concurrency, undefined, 'auto+wait is the no-opinion default — not written');
  const meta2 = uiToMeta({ name: 'X', summary: 's', owner: 'o', triggers: ['manual'], concurrency: { scope: 'pr', onConflict: 'coalesce' } });
  assert.deepEqual(meta2.concurrency, { scope: 'pr', on_conflict: 'coalesce' });
});

// [6] recoverMissedCrons must not double-fire in the same minute as the live tick.
test('P2: a recovered cron records lastCron so the live tick does not re-fire it', () => {
  const entries = [
    { t: '2026-07-08T09:00:00.000Z', ev: 'cron.fired', slug: 'r', idx: 0, stamp: '2026-6-8T9:0', cron: '0 9 * * *', recovered: true },
  ];
  const s = materialize(entries);
  assert.equal(s.lastCron.get('r|0'), '2026-6-8T9:0', 'cron.fired(recovered) records lastCron on replay too');
});
