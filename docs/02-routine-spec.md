# 02 — The canonical routine file (`*.routine.md`)

This is the center of gravity. **Everything is powered by this one Markdown file.** It is the unit
the team edits, the unit the UI renders, and the unit the runtime executes. It is a strict superset
of the shape Newton already runs in `automations/*.md`, so existing automations port with near-zero
change.

A routine file = **YAML front matter** (the machine-readable contract: identity, triggers, tools,
grants, concurrency, secrets, inputs) + a **Markdown body** (the prompt the agent runs). Git is the
system of record; the web UI is a structured editor over the same file (see [08](08-team-web-ui.md)).

Convention: files live in a repo under `routines/` (or anywhere, configurable) and are named
`<slug>.routine.md`. The `.routine.md` suffix is what the harness globs for.

---

## 1. Minimal example

```markdown
---
name: PR Attention Digest
summary: Post a daily merge-readiness digest of every open PR to #pr-digest.
owner: steven
on:
  - schedule: { cron: "0 13 * * *", tz: UTC }
tools:
  mcp: [slack]
  capabilities: [slack-post]
runtime:
  model: claude-opus-4-8
  repo: Newton-Research-Inc/newton
  branch: develop
---

## Prompt

Post a team-wide PR merge-readiness digest to the #pr-digest Slack channel: every open
non-draft PR as a row of objective signals (human approval, CI, scorecard, per-voice bot
verdicts), ranked closest-to-merge first. Don't manufacture a verdict — let the columns speak.
```

That's a complete, runnable routine. Everything below is optional richness.

---

## 2. Front matter — full schema

Grouped by concern. **Bold** = required. Everything else has a sensible default.

### 2.1 Identity & ownership

```yaml
name: "Ticket Police"            # **required** human name
slug: ticket-police              # defaults to the filename; stable id used in URLs/leases
summary: >-                      # **required** one-liner (shown in the catalog, the digest, logs)
  Find or file a Jira ticket for a PR whose title has no NP-#### key.
owner: fabio                     # **required** principal accountable (UI handle / email / team)
maintainers: [steven, dan]       # optional co-owners who may edit without review
team: platform                   # owning team (drives default RBAC + the catalog grouping)
tags: [github, jira, hygiene]    # free-form, for filtering the catalog
labels: { tier: ops, risk: write } # arbitrary k/v for policy + reporting
enabled: true                    # master on/off (UI toggle); disabled routines never fire
visibility: team                 # team | org | private — who can see/run it
```

### 2.2 Triggers — `on:` (the heart; full taxonomy in [04](04-triggers.md))

A list, GitHub-Actions style. Any one firing starts a run. Each entry is `{ <type>: <filters> }`.

```yaml
on:
  # time
  - schedule: { cron: "*/30 9-17 * * *", tz: America/New_York }   # sub-hour OK
  - schedule: { at: "2026-07-01T09:00:00Z" }                       # one-shot

  # github (fine-grained, unlike first-party routines)
  - github:
      event: pull_request
      actions: [opened, synchronize, ready_for_review]
      branches: [develop, stage]            # base filter
      paths: ["apps/server/**"]             # optional path filter
  - github: { event: label, name: cursor-review, on: added }
  - github: { event: check_run, status: completed, name: "review/*" }
  - github: { event: issue_comment, on: [created, edited] }
  - github: { event: push, branches: [main] }

  # external SaaS events (via connectors)
  - slack: { channel: C0AHK1RAH62, on: message }
  - sentry: { event: issue, level: error }            # connector-provided event
  - webhook: { id: deploy-finished }                  # generic inbound HTTP

  # control-plane
  - manual: {}                                         # "Run" button / slash-command
  - api: {}                                            # POST /routines/<slug>/dispatch
  - after:                                             # hand-off / chaining (the followup pattern)
      routine: daily-triage-pipeline
      on: [success]                                    # success | failure | always
```

Trigger-level controls:

```yaml
on:
  - github:
      event: pull_request
      actions: [opened, synchronize]
      if: "pr.author != 'dependabot[bot]'"   # CEL/JMESPath guard over the event payload
      gate: scripts/auto_cleanup_gate.py     # optional external gate (exit 0 = proceed); see C6/[05]
      debounce: 30s                           # collapse a burst of events into one run
```

### 2.3 Inputs — typed parameters for manual/API runs (GHA `workflow_dispatch` inputs)

```yaml
inputs:
  pr_number: { type: int, required: true, description: "PR to clean up" }
  repo:      { type: string, default: "Newton-Research-Inc/newton" }
  dry_run:   { type: bool, default: false }
```

The UI renders these as a form on the "Run" button; the API validates them; the body reads them as
`${{ inputs.pr_number }}`. Trigger payloads (e.g. the PR number from a `github` event) are exposed
the same way as `${{ event.* }}`.

### 2.4 Tools, MCPs, capabilities — the grant model (detail in [06](06-connectors-and-mcp.md))

```yaml
tools:
  mcp: [slack, atlassian, sentry, github]   # MCP connectors this routine may use (by registry id)
  capabilities: [slack-read, slack-post, open-pr, pr-comment]  # native harness grants
  scopes:                                    # resource-level narrowing within a connector
    slack: { channels: [C0AHK1RAH62] }
    github: { repos: [Newton-Research-Inc/newton], permissions: { contents: write, pull_requests: write } }
  deny: [git-force-push, merge-pr]           # explicit hard prohibitions, always enforced
```

`capabilities` is a closed vocabulary the harness understands and enforces (it's *not* free text):
`slack-read`, `slack-post`, `open-pr`, `pr-comment`, `push-commits`, `create-branch`, `merge-pr`
(default-denied), `jira-write`, `web-fetch`, … Each maps to concrete runner permissions + tool
exposure. Anything not granted is unavailable to the agent — least privilege by default.

### 2.5 Runtime — where/how the agent runs

```yaml
runtime:
  model: claude-opus-4-8            # any model id; harness is model-agnostic (see C4)
  effort: high                      # reasoning effort, when the model supports it
  repo: Newton-Research-Inc/newton  # repo to clone (or a list; or none for repo-less routines)
  branch: develop                   # default working branch
  checkout: full | shallow | none   # how much history the run needs
  worktree: true                    # run in an isolated git worktree (Newton's pr-cleanup pattern)
  timeout: 30m                      # hard wall-clock cap
  container: default                # named runner image/profile (toolchain: uv, node20, gh, …)
  network: { egress: [api.slack.com, "*.atlassian.net"] }  # optional egress allowlist
```

### 2.6 Concurrency & collision control — the platform primitive (full design in [05](05-concurrency-and-collisions.md))

This is the part that makes "two agents never touch the same PR" declarative instead of bespoke.

```yaml
concurrency:
  # GHA-style group: runs sharing a resolved key are serialized (or cancel each other).
  group: "pr-cleanup-${{ event.pr.number }}"
  cancel_in_progress: false        # false = queue/serialize (Newton's choice); true = supersede

  # Claim-before-act lease: acquire an exclusive lease on a resource before doing work.
  lease:
    resource: "pr:${{ event.repo }}#${{ event.pr.number }}"  # what we're claiming
    ttl: 20m                        # auto-expire so a crashed run can't deadlock the resource
    on_conflict: skip               # skip | queue | steal-if-expired

  # SHA barrier: drop the run if the artifact moved under us (stale-verdict protection).
  barrier:
    stale_if_sha_changed: "${{ event.pr.head_sha }}"

  # Yield to humans: stand down if a human acted after our last action.
  yield_to_human: true

  # Per-target iteration budget: stop a non-converging loop, hand off to a human.
  budget:
    key: "pr:${{ event.pr.number }}"
    max_iterations: 3
    on_exhausted: needs-human       # observable terminal state, not an infinite loop
```

Sensible defaults mean most routines write nothing here; PR-mutating routines opt into a lease +
budget and get Newton's whole guard stack for free.

### 2.7 Secrets — declared, never embedded (Newton's `memory_expects`, formalized)

```yaml
secrets:
  - name: SLACK_BOT_TOKEN
    from: vault://platform/slack/bot-token   # reference, not a value
    scopes: [reactions:write]
    description: "Used for Slack reactions; injected as env, redacted in all logs."
```

The harness injects these as env vars into the run and **redacts them from logs and run summaries**.
No secret value ever appears in the file, the UI, or git. (See [06](06-connectors-and-mcp.md).)

### 2.8 State / memory — cross-run persistence

```yaml
state:
  enabled: true
  store: routine                    # routine-scoped key/value + markdown notes that survive runs
  files: [triage-follow-up.md]      # named memory docs the body reads/writes (Newton's pattern)
```

### 2.9 Outputs & status surface — how a run reports (idempotency built in; see C7)

```yaml
outputs:
  status_surface:                   # the single place a run reports, upserted (never spammed)
    type: pr-comment                # pr-comment | slack-message | check-run | none
    marker: "<!-- ticket-police -->" # idempotency marker: find-and-update one comment
  emit_check_run: "routine/ticket-police"   # publish a GitHub check-run (joins merge gate)
  summary: structured               # require a structured end-of-run summary (logged + shown in UI)
```

### 2.10 Policy & guardrails — org-level safety

```yaml
policy:
  requires_approval: false          # gate runs behind a human approver (like GHA environments)
  approvers: [platform-leads]
  max_runs_per_day: 50              # cost/rate guardrail
  on_failure: [notify-owner]        # notify | retry | open-issue
  retry: { max: 2, backoff: exponential }
  notify: { on: [failure], channel: slack://C0... }
```

### 2.11 Includes — DRY shared fragments (GHA reusable workflows / composite actions)

```yaml
includes:
  - shared/fix-dismiss-triage-contract.md   # body fragments stitched in before the prompt
  - shared/github-slack-directory.md
```

A routine can also *extend* a template: `extends: templates/pr-worker.routine.md` inherits front
matter (overridable per field) so a team standardizes "all PR workers behave like this."

### 2.12 Reactive flow — follow & react to PRs this routine opens (full design in [11](11-reactive-flows-and-pr-subscriptions.md))

When a routine opens a PR, it shouldn't fire-and-forget. `flow:` declares that the routine
**subscribes to that PR's hook events** and **reacts** to them — the "*if `ci/*` fails, do Y*" rules
that become the routine's flow diagram. These are *instance-level* subscriptions on artifacts the
routine created, distinct from the *class-level* `on:` triggers in §2.2.

```yaml
flow:
  subscribe:
    events: [check_run, pull_request_review, issue_comment, status, pull_request]
    until: [merged, closed]      # auto-unsubscribe
    reconcile: 1h                # poll fallback for events webhooks don't deliver (CI-success, conflicts)
    ttl: 14d
  reactions:                     # event on the owned PR -> handler
    - when: { check_run: { name: "ci/*", conclusion: failure } }
      do: fix-ci                 # a named `## handler: fix-ci` body section, a `routine:<slug>`, or an inline prompt
      budget: { key: "pr:${{ pr.number }}:fix-ci", max: 3, on_exhausted: needs-human }
    - when: { pull_request_review: { state: changes_requested } }
      do: routine:pr-cleanup     # delegate to the shared cleanup routine
    - when: { pull_request: { merged: true } }
      do: done                   # terminal: unsubscribe + clean up
```

Each reaction spawns a PR-scoped **reaction run** that obeys all of [05](05-concurrency-and-collisions.md)
(lease on `pr:#N`, SHA barrier, yield-to-human, per-handler budget) and updates one idempotent status
surface. Subscriptions are auto-created on PR creation and auto-removed on merge/close.

---

## 3. The body — prompt conventions

Everything after the front matter is the prompt. Conventions (lifted from how Newton writes them,
because they work):

- A top `# Title` and a `## Prompt` section holding the operative prompt. (The harness runs the
  `## Prompt` body; text above it is human-facing context. This matches Newton exactly and lets a
  file be both documentation and executable.)
- Numbered procedure (`## 1. Set up …`, `## 2. Gather context …`) — the agent follows it as steps.
- A `## Constraints` / guardrails section enumerating hard rules ("never force-push", "never close a
  ticket", "act only on the PR in the trigger payload").
- Templated runtime values via `${{ … }}`: `${{ inputs.* }}`, `${{ event.* }}`, `${{ secrets.* }}`
  (redacted), `${{ state.* }}`, `${{ runtime.* }}`.
- Explicit return/summary shape so the harness can parse and display a structured result.
- `## handler: <name>` sections — the bodies that `flow.reactions[].do` (§2.12) point at, e.g.
  `## handler: fix-ci`. Each is a self-contained sub-prompt run when its reaction fires.

The harness never paraphrases the body — it passes it to the runner verbatim (with `${{ }}`
resolved). Prompt wording is behavior; changes go through review like code.

---

## 4. Three ported examples (proving the shape carries Newton's real automations)

### 4.1 A cron digest (was `pr-attention-digest.md`)

```yaml
---
name: PR Attention Digest
summary: Daily merge-readiness digest of open PRs to #pr-digest.
owner: steven
team: platform
on:
  - schedule: { cron: "0 13 * * *", tz: UTC }
tools: { mcp: [slack], capabilities: [slack-post], scopes: { slack: { channels: [C0PRDIGEST] } } }
runtime: { model: claude-opus-4-8, repo: Newton-Research-Inc/newton, branch: develop }
outputs: { status_surface: { type: slack-message } }
---
## Prompt
Post a team-wide PR merge-readiness digest … (body unchanged from Newton)
```

### 4.2 A label-triggered, multi-turn routine (was `ticket-police.md`)

```yaml
---
name: Ticket Police
summary: Find or file a Jira ticket for a PR whose title lacks an NP-#### key.
owner: fabio
team: platform
on:
  - github: { event: label, name: jira-ticket, on: added }
  - github: { event: issue_comment, on: edited }      # resume when the author ticks a checkbox
  - schedule: { cron: "0 */4 * * *" }                  # REMIND sweep
tools:
  mcp: [atlassian, slack, github]
  capabilities: [slack-read, slack-post, pr-comment, open-pr]
runtime: { model: claude-opus-4-8, repo: Newton-Research-Inc/newton, branch: develop }
state: { enabled: true }
concurrency:
  group: "ticket-police-${{ event.pr.number }}"
  lease: { resource: "pr:${{ event.repo }}#${{ event.pr.number }}", ttl: 10m, on_conflict: skip }
outputs: { status_surface: { type: pr-comment, marker: "<!-- ticket-police -->" } }
---
## Prompt
You are "ticket-police" … (body unchanged from Newton — the checkbox-menu PR comment flow)
```

Note how `event: issue_comment, on: edited` cleanly expresses Newton's "resume when a box is ticked"
need, and the `lease` makes the de-dup ("keep the earliest comment, only its owner proceeds")
*structural* instead of something the prompt re-derives every run.

### 4.3 A PR-mutating loop with the full guard stack (was `gha-pr-cleanup.md` + `auto_cleanup_gate.py`)

```yaml
---
name: PR Cleanup (auto loop)
summary: Address failing AI-review findings + required-CI failures on opted-in PRs, minimally.
owner: steven
team: platform
on:
  - github:
      event: check_run
      status: completed
      name: "review/*"
      gate: scripts/auto_cleanup_gate.py     # the existing guard logic runs as the trigger gate
tools:
  capabilities: [push-commits]               # may push; may NOT comment/label/merge
  deny: [git-force-push, merge-pr, pr-comment, label-write]
runtime: { model: claude-opus-4-8, repo: Newton-Research-Inc/newton, branch: develop, worktree: true }
concurrency:
  group: "auto-cleanup-${{ event.pr.number }}"
  cancel_in_progress: false
  lease: { resource: "pr:${{ event.repo }}#${{ event.pr.number }}", ttl: 20m }
  barrier: { stale_if_sha_changed: "${{ event.pr.head_sha }}" }
  yield_to_human: true
  budget: { key: "pr:${{ event.pr.number }}", max_iterations: 3, on_exhausted: needs-human }
policy: { requires_approval: false }   # write consent comes from the `auto-cleanup` label (a grant)
outputs: { summary: structured, status_surface: { type: pr-comment, marker: "<!-- auto-cleanup-summary -->" } }
---
## Prompt
You are running on a PR's already-checked-out head branch … only edit files … (body unchanged)
```

The entire `auto_cleanup_gate.py` guard stack (SHA guard, barrier, opt-in, yield, budget, verdict)
is now expressed in `concurrency:` + the `gate:`; the bespoke Python becomes a thin, declarative
contract the platform enforces for *every* PR-mutating routine, not just this one.

---

## 5. Why front-matter-as-contract is the whole ballgame

- **One source of truth.** The schedule, the grants, the model, the prompt — all in one reviewed
  file. No console drift (Newton's C2 pain, gone).
- **Reviewable & reversible.** Changing what an automation does is a PR with diff, blame, and
  rollback. The web UI writes the same file (commit on save), so UI edits are also reviewable.
- **Portable.** A routine is a file; copy it between repos/teams; publish it to a catalog; `extends`
  a template. (GHA Marketplace energy.)
- **Statically analyzable.** The harness validates the schema, lints grants ("requests `merge-pr`
  but that's org-denied"), detects two routines claiming the same lease key, and renders the whole
  fleet without running anything.
- **Model- and runner-agnostic.** `runtime.model` names any model; the body is just a prompt. Today
  the runner is Claude Code; the contract doesn't assume it.

The JSON-Schema for this front matter is the first artifact to build ([10](10-roadmap.md), Phase 0)
— it pins the contract that the validator, the UI form, and the runtime all share.
