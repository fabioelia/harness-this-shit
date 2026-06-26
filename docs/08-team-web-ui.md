# 08 — The team web service & UI

The ask: *"a web service where users can see all the automations that exist, update them, adjust
them + control them"* with *"basic user / team interface."* This is the "no team exposure" fix.
Today Newton's automations are only visible to whoever reads the repo or has Cursor-console access;
there's no shared, governed surface. Switchboard *is* that surface.

The guiding principle from [02](02-routine-spec.md): **the file is the source of truth; the UI is a
structured editor and control panel over those files.** Every UI write is a git commit; every UI
control (enable, run, grant, kill) is an audited action.

---

## 1. Surfaces (what the team sees)

### 1.1 Fleet dashboard (the home screen — "see all the automations")

A single board of every routine the team can see:

- name · summary · owner · team · tags · **enabled toggle**
- **last run** (status + when) · **next scheduled run** · success rate (e.g. 7d) · avg duration · spend
- **current state**: idle / running / queued / `NEEDS_HUMAN` / holding-lease-on `pr:#123`
- trigger summary (the `on:` types as chips) and connector chips
- filter/search by team, tag, trigger type, connector, health, owner

This is the thing that doesn't exist today: one place where the whole team sees what automations
exist, who owns them, and whether they're healthy.

### 1.2 Routine detail

- Rendered front matter (triggers, grants, concurrency, secrets-as-references, policy) + the prompt
  body, with the **raw `*.routine.md`** one click away and a link to its git history/blame.
- **Run history** for this routine with per-run status and links to logs.
- Controls: **Run now** (renders `inputs:` as a form — the `workflow_dispatch` button), **Enable/
  Disable**, **Edit**, **Duplicate/Fork**, **Validate** (schema + grant lint), **Kill switch**.
- Live **lease/budget** panel: what it's currently claiming, remaining iteration budget per target.
- **Flow diagram** — the routine rendered as a graph: triggers → run → (opens PR) → the reactive
  branches from its `flow.reactions` ("`ci/*` fails → fix-ci", "changes-requested → address",
  "merged → done"). This is the management/flow view of the routine, not just its text
  ([11](11-reactive-flows-and-pr-subscriptions.md) §5).
- **Owned PRs / subscriptions** panel — every PR this routine has opened and is now following: its
  subscription status (watching / reacting / done), what it's waiting on, the last reaction fired,
  and per-handler budget/lease state. The operational view of a routine that babysits its own work.

### 1.3 Run detail (the inspectable execution — GHA's job-log energy)

- Streamed, structured timeline: tool calls, file edits, sub-agent fan-out, MCP calls, the effectful
  actions (commit pushed, comment posted), with **secrets redacted**.
- Final **structured summary** (the routine's declared output shape), the diff it produced, links to
  the PR/comment/check-run it touched.
- The **dispatcher decision** that admitted or skipped it, with reason (`lease-held`, `stale-sha`,
  `budget-exhausted`, `yielded`…) — so "why didn't my routine run?" is always answerable.
- **Re-run** (same inputs) and **cancel**.

### 1.4 Editor (update / adjust them)

- A **structured form** for front matter (typed fields, dropdowns for triggers/connectors,
  validation inline) **plus** a raw Markdown editor for the body — your choice per edit.
- Saving **commits to the repo** (directly on a branch the team configures, or via a PR for
  change-controlled teams). The diff is shown before commit. This keeps UI edits reviewable and
  reversible — no hidden console state.
- Live lint: unknown connector, ungranted capability requested, two routines claiming the same lease
  key, malformed cron, secret reference that doesn't resolve.

### 1.5 Connectors page

Manage MCPs/capabilities for the team ([06](06-connectors-and-mcp.md)): add/auth/scope/test/rotate/
disable a connector, see its health and which routines hold it. The "trivial to manage MCPs" home.

### 1.6 Runs & activity feed

Org-wide stream of recent runs and events (what fired, what ran, what it did), filterable — the
operational pulse of the fleet.

### 1.7 Audit log

Every state change: enable/disable, edits (with diff), manual dispatches, grant changes, secret
rotations, lease steals, approvals. Required for "team exposure" to be trustworthy.

### 1.8 Settings

Teams & members, roles, default branch/commit policy for UI edits, org policy (rate caps, denied
capabilities, approval requirements), the GitHub App install, the kill switches.

---

## 2. Users, teams, roles (the "user / team interface")

Keep it basic but real:

| Role | Can |
|---|---|
| **Viewer** | See routines, runs, logs (secrets redacted). No control. |
| **Operator** | Viewer + run-now, enable/disable, cancel, re-run, acknowledge `NEEDS_HUMAN`. |
| **Maintainer** | Operator + edit routines (commit), manage connectors, grant capabilities within policy. |
| **Admin** | Maintainer + teams/members, org policy, GitHub App, secret store, kill switches. |

- **Teams own routines** (the front-matter `team:` field). Visibility (`private`/`team`/`org`)
  controls cross-team exposure. A routine's `owner`/`maintainers` get edit rights without extra
  grants — mapping the front matter directly to access.
- **Auth**: SSO/OIDC (Auth0-style — Newton already standardizes on Auth0), so team membership flows
  from the identity provider.
- Ownership in the file (`owner`, `maintainers`, `team`) and ownership in the product are the **same
  data** — no second place to keep in sync.

---

## 3. Control actions (control them)

- **Enable / Disable** a routine (instant; disabled routines never fire).
- **Run now** with typed inputs; **Cancel** a run; **Re-run**.
- **Approve** a run that's gated by `policy.requires_approval` (like a GHA environment reviewer).
- **Acknowledge / hand-off** a `NEEDS_HUMAN` target.
- **Kill switch**: per-routine and **org-wide emergency stop** — halt everything in one click (a bad
  routine pushing junk to PRs must be stoppable instantly, fleet-wide; see [05](05-concurrency-and-collisions.md) §7).
- **Grant / revoke** connectors and capabilities (within org policy), with the change audited.

---

## 4. Discovery & reuse (the GitHub-Marketplace aspiration)

- **Templates / catalog**: starter routines (PR cleanup, ticket police, daily digest, Sentry triage)
  a team can **fork** into their repo and tweak — the file is portable, so this is just "copy a
  `*.routine.md` and open it in the editor."
- **`extends` / `includes`** ([02](02-routine-spec.md) §2.11) surfaced in the UI so shared standards
  ("all our PR workers behave like this") are visible and enforced.

---

## 5. The view that answers the user's real questions

The dashboard is designed around the questions a team actually asks, which today have no good home:

- *What automations do we even have?* → the fleet board.
- *Who owns this one and is it healthy?* → owner + success-rate + health.
- *Why did it (not) run?* → the dispatcher-decision panel on each run.
- *What is it allowed to touch?* → the grants/connectors panel.
- *Is something about to stomp my PR?* → the lease/budget panel + activity feed.
- *How do I change what it does?* → edit the file in the UI; it commits; it's reviewed.
- *Make it stop, now.* → kill switch.

That set — visibility, ownership, control, safety — is exactly the "team exposure" that first-party
routines lack, delivered over the same Markdown files the team already version-controls.
