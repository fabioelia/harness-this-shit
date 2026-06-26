# 03 — Architecture

Switchboard is a **control plane** around a **runner**. The control plane decides *when* a routine
runs, *with what* grants and secrets, and *whether it's allowed to run right now* (collision
control). The runner is Claude Code (`claude -p` / Agent SDK) executing the routine's prompt in a
sandboxed repo checkout. This split mirrors GitHub Actions (the GHA service vs. the runner) and is
what lets us swap or scale runners without touching the product.

```
                                  ┌──────────────────────────────────────────────┐
   Sources of events              │                CONTROL PLANE                 │
   ─────────────────              │                                              │
   GitHub App webhooks ─────────► │  Event Gateway ──► Event Bus (durable queue) │
   Slack / Sentry / SaaS  ──────► │        │                    │                │
   Inbound webhooks ────────────► │        │                    ▼                │
   Scheduler (cron/at) ─────────► │        │            Trigger Matcher          │
   API / Manual (UI) ───────────► │        │       (which routines `on:` this?)  │
   "after" hand-offs ───────────► │        │                    │                │
                                  │        │                    ▼                │
                                  │        │             Dispatcher              │
                                  │        │   (concurrency groups · leases ·    │
                                  │        │    SHA barrier · budgets · gates)   │
                                  │        │                    │ admits         │
   Routine files (git) ──sync──►  │   Routine Registry          ▼                │
   Connector/MCP registry ─────►  │   Connector Registry   Run Orchestrator      │
   Secret store (vault) ───────►  │   Secret Broker        (state machine,       │
                                  │                         retries, durable)    │
                                  │                              │ leases a runner│
                                  └──────────────────────────────┼───────────────┘
                                                                 ▼
                                  ┌──────────────────────────────────────────────┐
                                  │                 DATA PLANE (runners)          │
                                  │  Sandboxed worker: clone repo → inject        │
                                  │  secrets+MCP config → run `claude -p` with     │
                                  │  granted tools → stream logs/artifacts back    │
                                  └──────────────────────────────────────────────┘
                                                                 │
                                  Web UI / API  ◄──── Run store, logs, audit, metrics
```

---

## 1. Components

### Control plane

| Component | Responsibility |
|---|---|
| **Event Gateway** | Single ingress for all external events: GitHub App webhooks, Slack/Sentry/SaaS events (via connectors), generic inbound webhooks. Verifies signatures, normalizes into a canonical `Event` envelope, drops onto the bus. |
| **Scheduler** | Owns time-based triggers. Evaluates `cron`/`at` per routine (sub-minute capable), accounting for timezones and business-hour windows. Emits `schedule` events onto the bus. A durable timer service, not a host crontab. |
| **Event Bus** | Durable, at-least-once queue (the spine). Decouples ingestion from matching/dispatch; gives us replay, backpressure, and ordering keys. |
| **Trigger Matcher** | For each `Event`, finds every enabled routine whose `on:` matches (type + filters + `if:` guard). Produces candidate `RunRequest`s. Pure, fast, side-effect-free. |
| **Dispatcher** | The gatekeeper ([05](05-concurrency-and-collisions.md)). For each `RunRequest`, evaluates concurrency groups, leases, SHA barriers, iteration budgets, external `gate:` scripts, and policy (approval, rate caps). Admits, queues, or drops. **This is where "two agents never touch the same PR" is enforced.** |
| **Routine Registry** | The synced, parsed, validated set of routine files. Watches git repos (and the UI's commits), parses front matter against the JSON-Schema, exposes the fleet to the matcher and the UI. Source of truth = git; registry = the queryable index. |
| **Connector Registry** | The catalog of available MCP servers + native capabilities, their auth state, and which routines are granted them ([06](06-connectors-and-mcp.md)). |
| **Secret Broker** | Resolves `secrets:` references to short-lived injected values at run start; enforces redaction. Never persists secret values in run records. |
| **Run Orchestrator** | The durable state machine for a single run: provision runner → checkout → inject → execute → collect → finalize, with retries/timeouts/budget decrement. Survives process restarts (durable execution engine — see [09](09-tooling-stack.md)). |

### Data plane

| Component | Responsibility |
|---|---|
| **Runner pool** | Ephemeral, sandboxed workers (containers). Each run gets a fresh, isolated environment: repo clone (or worktree), a toolchain image, granted MCP servers wired up, secrets injected as env, network egress allowlisted. Runs `claude -p` (or Agent SDK) with the resolved prompt. |
| **Runner agent** | The thin process inside the worker that: pulls the `RunSpec`, performs checkout, starts the MCP servers the routine is granted, launches Claude Code, streams logs/events/artifacts back, reports exit status + structured summary. |

### Edge

| Component | Responsibility |
|---|---|
| **Web app + API** | The team UI ([08](08-team-web-ui.md)) and the REST/GraphQL + webhook API. Read models over the run store, audit log, registry; write paths for enable/disable, manual dispatch, edits-as-commits, connector auth. |

---

## 2. The execution substrate (the "harness on top of Claude Code")

The runner executes a routine by invoking **headless Claude Code**:

- `claude -p "<resolved prompt>"` (or the Agent SDK) inside the worker, with:
  - the repo cloned at `runtime.repo@branch` (full/shallow/none per the file; optional git worktree),
  - the granted **MCP servers started and registered** so the agent's tool surface is exactly the
    `tools.mcp` grant (nothing more),
  - **native capabilities** mapped to allowed tools / permission policy (e.g. `push-commits` enables
    git push to the head ref; `merge-pr` is default-denied),
  - **secrets injected** as env vars (redacted in logs),
  - **egress** restricted to the routine's allowlist.
- The agent's natural-language body *is* the program. Internally a routine can fan out to subagents
  (Newton's `.claude/agents/*` show how rich this gets) — that's the runner's concern, not ours.
- The runner streams a structured event log (tool calls, file edits, sub-runs) so the UI can show a
  live, inspectable run — the equivalent of GHA's live job log.

**Why headless Claude Code (not a bespoke loop):** it's the same engine the user already trusts for
routines, it's model-agnostic via `runtime.model`, and (post-June-2026) `claude -p` usage doesn't
draw down subscription session caps — so the harness isn't throttled by the per-plan routine limits.
The control plane stays runner-agnostic: a `RunSpec` is "prompt + checkout + grants + secrets +
limits," which a different runner could honor later.

---

## 3. Core data model

```
Organization 1───* Team 1───* Member            (RBAC; see 08)
Team 1───* Routine                              (parsed from a *.routine.md, keyed by repo+slug)
Routine 1───* TriggerBinding                    (one per `on:` entry; what the matcher indexes)
Routine *───* ConnectorGrant *───1 Connector    (which MCPs/capabilities, at what scope)
Routine *───* SecretBinding *───1 Secret        (references, never values)
Routine 1───* Run                               (every execution)
Run 1───* RunStep / LogChunk / Artifact         (the inspectable timeline)
Run *───1 Event                                 (what triggered it; null for manual)
Lease (resource, holder_run, ttl, sha)          (collision control; see 05)
ConcurrencyGroup (key) 1───* Run                (serialization)
Budget (key, used, max)                         (per-target iteration cap)
AuditEntry (actor, action, target, ts, diff)    (everything that changes state)
```

Notes:
- **Routine** is a *projection of a file*, not the primary record. Git holds truth; the row is an
  index with `repo`, `path`, `commit_sha`, parsed front matter, and validation status.
- **Run** is immutable once finalized; its status is a small state machine (below).
- **Lease / Budget / ConcurrencyGroup** are the collision-control tables ([05](05-concurrency-and-collisions.md)).
- **AuditEntry** records every enable/disable, edit, manual dispatch, grant change, secret rotation,
  and lease steal — the team-exposure requirement implies a real audit trail.

---

## 4. Run lifecycle (state machine)

```
QUEUED ─► ADMITTED ─► PROVISIONING ─► RUNNING ─► COLLECTING ─► SUCCEEDED
   │          │                          │                        │
   │          │ (dispatcher denies)      │ (timeout/error)         └─► (finalize: status surface,
   │          ▼                          ▼                              check-run, budget decrement,
   │       SKIPPED                    FAILED ─► (retry policy?) ─► QUEUED   notify, audit)
   │      (collision/                    │
   │       gate/budget)                  └─► NEEDS_HUMAN  (budget exhausted / yield)
   ▼
 CANCELED (superseded by cancel_in_progress, or user-canceled)
```

- **QUEUED→ADMITTED** is the Dispatcher decision; `SKIPPED` carries a reason (`collision`,
  `stale-sha`, `budget-exhausted`, `gate-rejected`, `disabled`, `rate-capped`) that is *observable*
  (Newton's principle: terminal states visible on the PR / in the UI, not hidden).
- **Budget decrement happens only on a real, effectful run** (Newton: "no push → no iteration
  consumed").
- **NEEDS_HUMAN** is a first-class terminal state, surfaced in the UI and on the target — not an
  error and not an infinite retry.

---

## 5. Multi-tenancy & isolation

- **Org = tenant.** Teams within an org; routines owned by teams; visibility controls cross-team
  exposure ([08](08-team-web-ui.md)).
- **Runs are hard-isolated**: one ephemeral sandbox per run, destroyed after. No shared mutable
  state between runs except the explicit routine `state` store and git itself.
- **Secrets are org/team-scoped** and only ever live inside a run's process memory, injected at
  start, redacted from every record.
- Mirrors Newton's own single-tenant-per-customer instinct: blast radius is contained per tenant.

---

## 6. Observability & audit (because "team exposure" demands it)

- **Live run logs** streamed to the UI (tool calls, edits, sub-agent fan-out), retained and
  searchable — GHA-style.
- **Fleet dashboard**: every routine's last run, next scheduled run, success rate, p50/p95 duration,
  spend, and current lease/budget state.
- **Audit log**: who changed what, when, with the file diff for edits.
- **Metrics**: runs/min, queue depth, runner utilization, collision-skip rate, budget-exhaustion
  rate, per-connector call volume, per-routine cost.
- **Cost accounting**: token/$ per run and per routine (the lever teams will care about given the
  routine caps story in [01](01-research.md)).

---

## 7. Deployment topology (sketch)

- **Stateless services** (gateway, matcher, dispatcher, API/web) behind a load balancer; scale
  horizontally.
- **Durable backbone**: a workflow/queue engine for the Run Orchestrator + Event Bus (Temporal-class
  or a managed queue + Postgres outbox — see [09](09-tooling-stack.md)).
- **Postgres** for registry, runs, audit, leases, budgets (leases use row locks / advisory locks;
  see [05](05-concurrency-and-collisions.md)).
- **Object store** for logs/artifacts.
- **Runner pool**: autoscaled container workers (K8s Jobs / Fargate / Firecracker microVMs for
  stronger isolation). Pull-based: a worker leases the next admitted `RunSpec`.
- **Secret store**: a real vault (AWS Secrets Manager / HashiCorp Vault), referenced by the file,
  resolved by the broker — never copied into app DBs.

The seam to hold sacred: **control plane ⟂ runner**. Everything user-facing (files, triggers, UI,
collisions, grants) is control-plane; the agent execution is a replaceable data-plane detail.
