# 07 — GitHub integration (a must-have)

GitHub is both a **trigger source** and an **action target**, and it's where the collision-control
story lands hardest (PRs are the contested resource). This doc covers the integration end to end. It
leans on patterns Newton already runs in production via `gh`/the GitHub MCP and its GHA workflows.

---

## 1. Connect via a GitHub App (not PATs)

- A **GitHub App** installed on the org/selected repos is the integration unit. It gives:
  - **fine-grained, per-repo permissions** (contents, pull_requests, checks, issues, …) granted once
    at install;
  - a **webhook stream** of repo events (the trigger firehose — [04](04-triggers.md) §1.2);
  - **short-lived installation tokens** minted per run, scoped to the repos + permissions a routine
    actually needs (least privilege, OIDC-style — the GHA aspiration in [01](01-research.md) §B).
- The App has a **bot identity** (e.g. `switchboard[bot]`) so its commits/comments are attributable
  and filterable. Newton's prompts already special-case bot logins (anchored, exact-login matching)
  when filtering reviewers vs. bots — our bot must be cleanly identifiable the same way.
- **Per-host / per-tenant installs** mirror Newton's single-tenant model: webhooks and OAuth
  redirects are configured per deployment, so blast radius and credentials stay tenant-scoped.

Why not PATs: a PAT is one human's blanket access with no per-run scoping, no clean bot identity, and
no webhook stream. The App is the only model that supports least-privilege per-run tokens + events.

---

## 2. Events in (triggers)

The App's webhook stream is normalized by the Event Gateway into the canonical envelope and matched
against routines' `on:` ([04](04-triggers.md)). The full surface we expose — far beyond first-party
routines' PR/release coverage:

`pull_request` (opened/synchronize/ready_for_review/closed/labeled) · `push` · `label` ·
`issue_comment` (created/**edited** — powers checkbox-resume flows) · `pull_request_review` ·
`pull_request_review_comment` · `check_run` / `check_suite` (completed/failure) · `issues` ·
`release` · `workflow_run` · `deployment_status`.

Each binding can filter on `branches`, `paths`, `actions`, `draft`, and an `if:` guard over the
payload ([04](04-triggers.md) §2). Signature verification on every delivery; replay protection via
delivery id.

---

## 3. Actions out (what a routine may do on GitHub)

Mapped to native capabilities ([06](06-connectors-and-mcp.md)) and the GitHub MCP tools Newton
already uses. Each is a **grant**; ungranted = impossible:

| Capability | Operations | Default |
|---|---|---|
| `pr-comment` | create/upsert issue & review comments, reply in threads, resolve/unresolve threads | granted to review/triage routines |
| `open-pr` | create a branch, open a PR | granted to authoring routines |
| `push-commits` | `git push` to a PR **head** ref (never force) | granted to cleanup routines, gated by opt-in |
| `label-write` | add/remove labels | rarely granted; humans own opt-in labels |
| `check-run-write` | publish a `check_run` (status/conclusion) | granted to reviewers/scorecards |
| `merge-pr` | merge | **default-denied**, org-policy to enable |
| `git-force-push` | force push | **always denied** |

Hard rules baked in (straight from Newton's `pr-cleanup` contract): **never force-push; never
approve/merge unless explicitly granted; act only on non-draft, same-repo PRs** (fork PRs can't be
pushed to — detect and bail). These are platform-enforced, not just prompt-requested.

---

## 4. PRs as contested resources → the collision story (see [05](05-concurrency-and-collisions.md))

GitHub is where "two agents never touch the same PR" matters most. The mapping:

- **Lease resource** = `pr:<repo>#<number>` (or `branch:<repo>@<ref>`). Any routine claiming it
  excludes all others — cross-routine safety.
- **SHA barrier** = the PR's `head_sha`; once any run pushes, the SHA moves and stale siblings drop.
  This is why Newton gets "multi-voice idempotency for free."
- **Write-consent** = an opt-in label (`auto-cleanup`) the human applies; the harness refuses
  mutating runs without it and never self-applies it.
- **Budget** = per-PR iteration cap with a `loop-budget` surface comment; exhausted → `NEEDS_HUMAN`.
- **Idempotent surface** = one marker-tagged PR comment per routine, upserted (anti-spam).
- **Yield-to-human** = if a human pushed after our last action, stand down.

All declarative in the routine's `concurrency:`; the platform enforces it for every PR-touching
routine.

---

## 5. Check-runs and the merge gate (the GHA aspiration)

Routines can **emit check-runs** (`outputs.emit_check_run: "routine/<name>"`), SHA-pinned to the
commit they evaluated. That means:

- a review routine's verdict shows up as a status check on the PR, and
- the org can make it a **required status check** in branch protection — so an automation's output
  literally **gates merge**, exactly like a GHA job. (Newton's `review/claude`, `review/gpt`, and
  scorecard checks already work this way and feed the auto-cleanup barrier.)

This closes the loop: triggers (event in) → run → check-run (signal out) → merge gate / `after:`
chaining / cleanup barrier.

---

## 6. Operational realities to handle

- **Rate limits**: pool installation-token usage, back off on secondary limits, and coalesce reads
  (Newton paginates deliberately — `--paginate` — so feedback past comment #100 isn't dropped; our
  GitHub client must page fully too).
- **Webhook reliability**: at-least-once delivery → dedupe by delivery id + `dedupe_key`; reconcile
  missed events with periodic polling for critical state (Newton notes CI-success and merge-conflict
  transitions are *not* always delivered as events — so a reconciler/poller backstops the webhook
  stream).
- **Fork PRs**: read-only; never attempt pushes; detect `isCrossRepository` and bail (Newton's rule).
- **Draft/closed/merged short-circuits**: cheap early exits before doing work (Newton's "Step 0"
  bail-outs) — expressed as `if:` guards so we don't even spin a runner.
- **Attribution**: bot commits carry `Co-Authored-By`/trailers and a clear author so humans can
  filter machine vs. human activity (Newton already relies on this distinction everywhere).

---

## 7. Beyond a single repo

- A routine can target **multiple repos** (`runtime.repo: [a, b]`) or be **org-wide** (sweeps like
  Newton's PR digest that list every open PR).
- The App install defines the reachable repo set; routine `tools.scopes.github.repos` narrows it
  further per routine.
- Cross-repo routines still obey leases keyed by the specific `pr:<repo>#<n>` they touch, so breadth
  doesn't weaken collision safety.
