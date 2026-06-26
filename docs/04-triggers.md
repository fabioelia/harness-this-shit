# 04 — Triggers: the answer to "limited trigger controls"

First-party Claude routines fire on **three** things (schedule / API / GitHub-PR-or-release) with a
**1-hour floor**. Newton's real fleet already needs **eight-plus** trigger types and sub-hour
cadence. This doc defines the full taxonomy and the event machinery behind it. The design principle
is GitHub Actions' `on:`: **one routine, many triggers, each with filters and guards.**

---

## 1. The taxonomy

Every trigger is a `{ <type>: <filters> }` entry in the routine's `on:` list. Categories:

### 1.1 Time

| Type | Form | Notes |
|---|---|---|
| `schedule` (recurring) | `{ cron: "*/30 9-17 * * *", tz: America/New_York }` | **Sub-hour and windowed** — the thing first-party routines can't do. Timezone-aware. |
| `schedule` (one-shot) | `{ at: "2026-07-01T09:00:00Z" }` | Fire once at a future instant. |
| `schedule` (interval) | `{ every: 15m, jitter: 60s }` | Convenience over cron; jitter avoids thundering-herd. |

### 1.2 GitHub (fine-grained — see [07](07-github-integration.md))

| Type | Example filters |
|---|---|
| `github: { event: pull_request }` | `actions: [opened, synchronize, ready_for_review, closed]`, `branches`, `paths`, `draft` |
| `github: { event: push }` | `branches: [main, stage]`, `paths` |
| `github: { event: label }` | `name: cursor-review`, `on: added\|removed` |
| `github: { event: issue_comment }` | `on: [created, edited]` (powers the ticket-police "resume on checkbox tick") |
| `github: { event: pull_request_review }` / `review_comment` | `state: changes_requested` |
| `github: { event: check_run }` / `check_suite` | `status: completed`, `name: "review/*"`, `conclusion: failure` |
| `github: { event: issues }` | `actions: [opened, labeled]` |
| `github: { event: release }` | `actions: [published]` |
| `github: { event: workflow_run }` | react to a GHA workflow completing |
| `github: { event: deployment_status }` | promote/notify on deploy outcomes |

All of these are already available in the GitHub App webhook surface; first-party routines just
don't expose them. We do.

### 1.3 External SaaS events (via connectors — [06](06-connectors-and-mcp.md))

| Type | Example |
|---|---|
| `slack: { channel: C0…, on: message }` | message / mention / reaction in a channel (file-user-requests pattern) |
| `sentry: { event: issue, level: error }` | new high-severity issue |
| `jira: { event: issue_transitioned, to: "In QA" }` | workflow transitions |
| `pagerduty: { event: incident_triggered }` | incident-driven runs |
| `<connector>: { event: … }` | any connector that publishes events registers its event types |

A connector declares the events it can emit; the trigger references them. This is the open-ended
slot that lets the harness grow trigger coverage by adding connectors, not code.

### 1.4 Generic inbound webhook (the universal escape hatch)

```yaml
on:
  - webhook: { id: deploy-finished, secret: vault://…/wh-secret }
```

Gives each routine (optionally) a signed inbound URL — superset of first-party "API trigger," and
the bridge for any system we don't have a first-class connector for yet.

### 1.5 Control-plane

| Type | Meaning |
|---|---|
| `manual: {}` | A "Run" button in the UI + a slash-command surface; renders the routine's `inputs:` as a form. (Newton's `/pr-cleanup`, `/pr-review`.) |
| `api: {}` | `POST /v1/routines/<slug>/dispatch` with a bearer token + typed `inputs` body. |

### 1.6 Hand-off / chaining — `after` (the "followup" pattern, made first-class)

```yaml
on:
  - after: { routine: daily-triage-pipeline, on: [success] }   # success | failure | always
```

Newton has whole automations (`*-followup.md`) whose job is to continue what another routine
produced. Neither GHA nor first-party routines model "run B after A finished" cleanly. We do — and
it composes into pipelines (A → B → C) with the producing run's outputs available to the consumer as
`${{ upstream.* }}`. (GHA's `workflow_run` is the closest analogue; `after` is the friendly form.)

---

## 2. Filters, guards, and shaping

Every trigger entry can carry:

```yaml
- github:
    event: pull_request
    actions: [opened, synchronize]
    branches: [develop, stage]            # include filter (glob)
    paths: ["apps/server/**"]             # include filter (glob)
    paths_ignore: ["**/*.md"]             # exclude filter
    if: "pr.author != 'dependabot[bot]' && pr.draft == false"  # CEL/JMESPath over the payload
    gate: scripts/auto_cleanup_gate.py    # external program; exit 0 ⇒ proceed (Newton's gate)
    debounce: 30s                          # collapse an event burst into one run
    dedupe_key: "pr:${{ event.pr.number }}" # extra idempotency beyond concurrency (see 05)
```

- **`if:`** — a sandboxed expression over the normalized event payload. Cheap, declarative
  pre-filter so we don't spin a runner just to have it `exit 0` (Newton learned this the hard way:
  *"Cheap pre-filter; the real gate is the script"*).
- **`gate:`** — an escape hatch to run arbitrary deterministic logic (a script) before admitting,
  for guard logic too complex for `if:`. This is precisely how `auto_cleanup_gate.py` works today;
  we keep it as a supported extension point rather than forcing everything into YAML.
- **`debounce` / `dedupe_key`** — turn a storm of webhooks (a force-push fires many events) into a
  single run.

---

## 3. The event pipeline (how a trigger becomes a run)

```
1. INGEST     Event Gateway verifies signature, normalizes to a canonical Event envelope:
              { source, type, payload, repo?, actor?, resource_key?, received_at, dedupe_hint }
2. BUS        Durable enqueue (at-least-once). Ordering key = resource (e.g. pr:#123) so events
              about the same target stay ordered.
3. MATCH      Trigger Matcher selects enabled routines whose `on:` matches (type + filters + `if:`).
              Produces RunRequest{ routine, event, resolved_inputs }.
4. GATE       Optional `gate:` program runs; non-zero ⇒ drop with reason.
5. DISPATCH   Dispatcher applies concurrency/lease/barrier/budget/policy (see 05). Admit / queue / skip.
6. RUN        Run Orchestrator provisions a runner and executes. Status streamed to the UI.
7. EMIT       On finish, may emit downstream events (`after` consumers, status surfaces, check-runs).
```

The **canonical Event envelope** is what makes the system extensible: connectors and webhooks all
normalize into the same shape, so the matcher and templating (`${{ event.* }}`) are uniform
regardless of source.

---

## 4. Side-by-side: what we add over first-party routines

| Capability | First-party routines | Switchboard |
|---|---|---|
| Schedule granularity | ≥ 1 hour | sub-minute; tz-aware; business-hour windows; jitter |
| GitHub events | PRs / releases (coarse) | full webhook surface: label, check_run, issue_comment(edited), review, push, paths… |
| Slack / Sentry / Jira / PagerDuty events | ✗ | ✓ via connectors |
| Generic inbound webhook | API POST only | signed per-routine webhooks + API |
| Manual run with typed inputs | limited | `workflow_dispatch`-style typed `inputs:` form |
| Chaining (run B after A) | ✗ | `after:` first-class, with upstream outputs |
| Per-trigger filters (`branches`/`paths`/`if`) | ✗ | ✓ |
| External gate program | ✗ (DIY) | `gate:` extension point |
| Debounce / dedupe of event storms | ✗ | ✓ |
| Daily run cap | 5 / 15 / 25 per plan | governed by org policy + budgets, not a hard per-user wall |

---

## 5. Scheduler design notes

- A **durable timer service** (not a host crontab): persists next-fire times, survives restarts, and
  is the single authority so a routine never double-fires across replicas.
- Cron evaluated per routine in its declared `tz`; DST handled by the tz database.
- **Missed-fire policy** per routine: `skip` (default), `run_once_on_recovery`, or `backfill` — what
  happens if the scheduler was down across a fire time.
- **Catch-up suppression**: if a routine's prior run is still executing when the next fires, defer to
  the routine's `concurrency` (serialize or skip) rather than stacking — this is where triggers and
  collision control meet ([05](05-concurrency-and-collisions.md)).

---

## 6. Worked trace (ticket-police, end to end)

1. A human adds the `jira-ticket` label to PR #1342. GitHub App posts a `label` webhook.
2. Gateway normalizes → `Event{ source: github, type: label, payload:{name: jira-ticket, action: added}, repo, resource_key: pr:#1342 }`.
3. Matcher: `ticket-police` has `on: github{event:label,name:jira-ticket,on:added}` → match. `if:`
   (PR open, non-draft) passes.
4. Dispatcher: routine declares `lease: pr:newton#1342`. No conflicting lease → **admit**, acquire
   lease (TTL 10m).
5. Runner clones newton@develop, starts Atlassian+Slack+GitHub MCPs (the grant), runs the prompt.
   The agent posts the single `<!-- ticket-police -->` checkbox comment, nudges Slack, ends.
6. Lease released; run `SUCCEEDED`; status surface = the PR comment (idempotent marker).
7. Author ticks a checkbox → `issue_comment: edited` webhook → step 2 again → matcher matches the
   *same* routine's second trigger → dispatcher sees the lease free → admit → the agent reads the
   ticked box and acts. No collision, no console, one file.
