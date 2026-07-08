import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoutineFile, splitFrontMatter } from '../src/frontmatter.js';
import { normalizeRoutine } from '../src/schema.js';

const FULL = `---
name: Everything Routine
summary: Exercises the whole docs/02 schema.
owner: fabio
maintainers: [steven]
team: platform
tags: [a, b]
labels: { tier: ops }
on:
  - schedule: { cron: "*/30 9-17 * * *", tz: America/New_York }
  - schedule: { every: 15m, jitter: 60s }
  - github:
      event: pull_request
      actions: [opened, synchronize]
      branches: [develop]
      paths: ["apps/server/**"]
      if: "pr.author != 'dependabot[bot]'"
      gate: scripts/gate.py
      debounce: 30s
      dedupe_key: "pr:\${{ event.pr.number }}"
  - after: { routine: upstream-thing, on: [success] }
  - webhook: { id: deploy-finished, secret: env://WH_SECRET }
  - manual: {}
inputs:
  pr_number: { type: int, required: true, description: "PR" }
  dry_run: { type: bool, default: false }
tools:
  mcp: [slack, atlassian, github]
  capabilities: [slack-post, pr-comment]
  scopes: { slack: { channels: [C0X] } }
  deny: [git-force-push, merge-pr]
runtime:
  model: claude-opus-4-8
  effort: high
  repo: acme/newton
  branch: develop
  checkout: shallow
  worktree: true
  timeout: 30m
concurrency:
  group: "clean-\${{ event.pr.number }}"
  cancel_in_progress: false
  lease: { resource: "pr:\${{ repo }}#\${{ event.pr.number }}", ttl: 20m, on_conflict: skip }
  barrier: { stale_if_sha_changed: "\${{ event.pr.head_sha }}" }
  yield_to_human: true
  budget: { key: "pr:\${{ event.pr.number }}", max_iterations: 3, on_exhausted: needs-human }
secrets:
  - name: SLACK_BOT_TOKEN
    from: env://SLACK_BOT_TOKEN
state: { enabled: true, files: [notes.md] }
outputs:
  status_surface: { type: pr-comment, marker: "<!-- x -->" }
  emit_check_run: "routine/everything"
  summary: structured
policy:
  requires_approval: true
  approvers: [lead]
  max_runs_per_day: 50
  retry: { max: 2, backoff: exponential }
  notify: { on: [failure], channel: "slack://C0A" }
flow:
  subscribe: { events: [check_run], until: [merged, closed], reconcile: 1h, ttl: 14d }
  reactions:
    - when: { check_run: { name: "ci/*", conclusion: failure } }
      do: fix-ci
      budget: { key: "pr:\${{ pr.number }}:fix", max: 3 }
    - when: { pull_request: { merged: true } }
      do: done
---
# Title

Context for humans.

## Prompt

Do the thing to PR \${{ inputs.pr_number }}.

## Constraints

- be careful

## handler: fix-ci

Fix the failing check.
`;

test('front matter + body sections parse', () => {
  const { meta, prompt, handlers } = parseRoutineFile(FULL);
  assert.equal(meta.name, 'Everything Routine');
  assert.match(prompt, /Do the thing to PR/);
  assert.match(prompt, /## Constraints/);         // non-handler sections stay in the prompt when ## Prompt exists? no —
  assert.ok(handlers['fix-ci'].includes('Fix the failing check'));
});

test('no front matter → meta null', () => {
  const { meta } = splitFrontMatter('# just a doc\n');
  assert.equal(meta, null);
});

test('full schema normalizes without errors', () => {
  const { meta } = parseRoutineFile(FULL);
  const { routine, errors, warnings } = normalizeRoutine(meta, { file: 'everything.md', connectorIds: new Set(['slack', 'atlassian', 'github', 'web']) });
  assert.deepEqual(errors, []);
  assert.equal(routine.slug, 'everything');
  assert.equal(routine.on.length, 6);
  assert.equal(routine.on[2].guards.if, "pr.author != 'dependabot[bot]'");
  assert.equal(routine.on[2].guards.debounce, '30s');
  assert.equal(routine.concurrency.lease.onConflict, 'skip');
  assert.equal(routine.concurrency.budget.maxIterations, 3);
  assert.equal(routine.runtime.timeoutMs, 30 * 60_000);
  assert.equal(routine.policy.retry.max, 2);
  assert.equal(routine.flow.reactions.length, 2);
  assert.equal(routine.inputs.pr_number.required, true);
  assert.ok(!warnings.some((w) => w.includes('unknown front-matter key')), warnings.join('; '));
});

test('schema errors on garbage', () => {
  const { errors } = normalizeRoutine({ name: 'x', on: [{ schedule: { cron: 'not cron' } }, { github: {} }, { after: {} }] }, {});
  assert.ok(errors.some((e) => e.includes('not 5-field cron')));
  assert.ok(errors.some((e) => e.includes('event: required')));
  assert.ok(errors.some((e) => e.includes('routine: required')));
});

test('unknown top-level key is lint, not fatal', () => {
  const { routine, warnings } = normalizeRoutine({ name: 'x', summary: 's', owner: 'o', trigger: 'oops' }, {});
  assert.ok(routine);
  assert.ok(warnings.some((w) => w.startsWith('trigger:')));
});
