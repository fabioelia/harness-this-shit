import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cronMatches, nextCronFire, zonedParts, validTz } from '../src/cron.js';
import { compileExpr, evalIf } from '../src/expr.js';
import { renderTemplate, buildContext } from '../src/template.js';
import { durationMs, globMatch, deepMerge, get } from '../src/util.js';

test('cron matching', () => {
  const d = new Date('2026-07-08T13:00:00Z');
  assert.ok(cronMatches('0 13 * * *', d, 'UTC'));
  assert.ok(!cronMatches('0 14 * * *', d, 'UTC'));
  assert.ok(cronMatches('*/30 9-17 * * *', new Date('2026-07-08T13:30:00-04:00'), 'America/New_York'));
  assert.ok(cronMatches('0 13 * * 3', d, 'UTC'));        // 2026-07-08 is a Wednesday
  assert.ok(!cronMatches('0 13 * * 4', d, 'UTC'));
  assert.ok(cronMatches('0,30 13 * * *', d, 'UTC'));
});

test('cron tz awareness', () => {
  const d = new Date('2026-07-08T13:00:00Z');            // 09:00 in New York (EDT)
  assert.equal(zonedParts(d, 'America/New_York').hour, 9);
  assert.ok(cronMatches('0 9 * * *', d, 'America/New_York'));
  assert.ok(!cronMatches('0 13 * * *', d, 'America/New_York'));
  assert.ok(validTz('UTC') && !validTz('Mars/Olympus'));
});

test('nextCronFire finds the next matching minute', () => {
  const next = nextCronFire('0 13 * * *', 'UTC', new Date('2026-07-08T13:30:00Z'));
  assert.equal(next.toISOString(), '2026-07-09T13:00:00.000Z');
});

test('if: expressions', () => {
  const ctx = { pr: { author: 'dependabot[bot]', draft: false, number: 12, labels: ['auto-cleanup', 'ci'] }, event: { action: 'opened' } };
  assert.equal(evalIf("pr.author != 'dependabot[bot]'", ctx), false);
  assert.equal(evalIf("pr.author == 'dependabot[bot]' && pr.draft == false", ctx), true);
  assert.equal(evalIf("pr.number > 10 || pr.draft", ctx), true);
  assert.equal(evalIf("'auto-cleanup' in pr.labels", ctx), true);
  assert.equal(evalIf("pr.labels contains 'nope'", ctx), false);
  assert.equal(evalIf("event.action matches 'open.*'", ctx), true);
  assert.equal(evalIf("event.action in ['opened', 'synchronize']", ctx), true);
  assert.equal(evalIf('!(pr.draft)', ctx), true);
  assert.equal(evalIf('totally garbage ((', ctx), false);          // fail closed
  assert.throws(() => compileExpr('a &&'));
});

test('${{ }} templating', () => {
  const misses = [];
  const out = renderTemplate('pr:${{ repo }}#${{ event.pr.number }} by ${{ pr.author }} x=${{ nope.nothing }}',
    buildContext({ event: { type: 'pull_request', payload: { repository: { full_name: 'acme/x' }, pull_request: { number: 7, user: { login: 'fabio' } } } } }),
    { onMiss: (p) => misses.push(p) });
  assert.equal(out, 'pr:acme/x#7 by fabio x=${{ nope.nothing }}');
  assert.deepEqual(misses, ['nope.nothing']);
});

test('utils', () => {
  assert.equal(durationMs('30m'), 1_800_000);
  assert.equal(durationMs('45s'), 45_000);
  assert.equal(durationMs('14d'), 14 * 86_400_000);
  assert.equal(durationMs('junk'), null);
  assert.ok(globMatch('ci/*', 'ci/test'));
  assert.ok(globMatch('review/*', 'review/security'));
  assert.ok(!globMatch('ci/*', 'lint'));
  assert.ok(globMatch('apps/server/**', 'apps/server/src/deep/x.js'));
  assert.ok(globMatch('*.{ts,tsx}', 'a.tsx'));
  assert.deepEqual(deepMerge({ a: { b: 1, c: 2 } }, { a: { c: 3 } }), { a: { b: 1, c: 3 } });
  assert.equal(get({ a: [{ b: 'x' }] }, 'a.0.b'), 'x');
});
