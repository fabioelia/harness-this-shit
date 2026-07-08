---
name: PR Cleanup (auto loop)
summary: Address failing CI on opted-in PRs, minimally, with the full guard stack.
owner: steven
team: platform
tags: [github, ci, write]
labels: { tier: ops, risk: write }
on:
  - github:
      event: check_run
      status: completed
      conclusion: [failure]
      if: "'auto-cleanup' in pr.labels"
      dedupe_key: "pr:${{ event.pr.number }}:${{ event.pr.head_sha }}"
      debounce: 45s
tools:
  mcp: [github]
  capabilities: [push-commits]
  deny: [git-force-push, merge-pr, pr-comment, label-write]
runtime:
  model: claude-opus-4-8
  repo: fabioelia/harness-this-shit
  branch: main
  checkout: shallow
  worktree: true
  timeout: 20m
concurrency:
  group: "auto-cleanup-${{ event.pr.number }}"
  cancel_in_progress: false
  lease: { resource: "pr:${{ repo }}#${{ event.pr.number }}", ttl: 20m, on_conflict: queue }
  barrier: { stale_if_sha_changed: "${{ event.pr.head_sha }}" }
  yield_to_human: true
  budget: { key: "pr:${{ event.pr.number }}", max_iterations: 3, on_exhausted: needs-human }
outputs:
  summary: structured
  status_surface: { type: pr-comment, marker: "<!-- auto-cleanup-summary -->" }
flow:
  subscribe:
    events: [check_run, pull_request_review, pull_request]
    until: [merged, closed]
    reconcile: 5m
    ttl: 7d
  reactions:
    - when: { check_run: { name: "ci/*", conclusion: failure } }
      do: fix-ci
      budget: { key: "pr:${{ pr.number }}:fix-ci", max: 3, on_exhausted: needs-human }
    - when: { pull_request_review: { state: changes_requested } }
      do: address-review
    - when: { pull_request: { merged: true } }
      do: done
policy:
  requires_approval: false
  retry: { max: 1, backoff: exponential }
  on_failure: [notify-owner]
---
## Prompt

You are running against a PR whose CI just failed and whose author opted in with the
`auto-cleanup` label. Check out its head branch in the workspace, reproduce the failing
check locally if you can, and make the SMALLEST change that plausibly fixes it. Commit
with a clear message and push to the head branch. Only edit files the failing check
implicates.

## Constraints

- Never force-push, never merge, never comment or re-label — you may only push commits.
- If the failure is clearly environmental/flaky, push nothing and say so.

## handler: fix-ci

CI failed again on the PR you are following (see the trigger payload for which check).
Pull the latest head, diagnose THAT check only, and push the smallest fix. If your last
attempt caused it, revert your change instead of doubling down.

## handler: address-review

A reviewer requested changes on the PR you opened. Read every review comment, apply the
requested changes faithfully (no scope creep), and push. Do not reply to comments —
your commits are the reply.
