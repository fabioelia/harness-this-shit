# 11 — Reactive flows & PR subscriptions ("follow the work you create")

A routine that **opens a PR** shouldn't fire-and-forget. The moment it creates a PR for a user, it
should **subscribe to that PR's hook events** and **react** to them — *"if the `ci/build` check
fails, fix it; if a reviewer requests changes, address them; when it's green and approved, mark it
ready; when it merges, stop."* Those reactive rules are part of the routine's definition, and they
are what the routine's **flow diagram** in the UI visualizes. This doc makes that a first-class
concept.

This is not hypothetical: it's exactly the model this very harness runs on. Claude Code's
`subscribe_pr_activity` delivers PR comment/CI/review events back to the session as
`<github-webhook-activity>`, and the operating rule is *"a subscription is not finished until the PR
is MERGED or CLOSED"* — with the explicit caveat that **webhooks don't cover everything** (CI
success, new pushes, and merge-conflict transitions aren't delivered), so a scheduled self-check-in
backstops them. Switchboard productizes precisely this loop and ties it to the routine file.

---

## 1. Two levels of trigger (the key distinction)

| | **Fleet triggers — `on:`** ([04](04-triggers.md)) | **Instance subscriptions — `flow:`** (this doc) |
|---|---|---|
| Scope | *Class-level*: any event matching the filter | *Instance-level*: events on **one specific artifact this routine created/owns** (a PR number) |
| Starts | a brand-new run of the routine | a **reaction run** that continues the lifecycle of an owned PR |
| Example | "any PR labeled `cursor-review`" | "the PR **#1342 that this run just opened** got a failing `ci/*` check" |
| Lifetime | as long as the routine is enabled | from PR-open until that PR is merged/closed (then auto-unsubscribe) |

Fleet triggers answer *"what should make a routine start?"* Reactive flows answer *"now that my
routine produced a PR, what should it do as that PR lives its life?"* Both are declarative; both
live in the same `*.routine.md`.

---

## 2. The declarative shape — `flow:`

Added to the routine front matter ([02](02-routine-spec.md)). When the routine opens a PR (via the
`open-pr` capability), the harness **auto-creates a subscription** for that PR and drives these
rules:

```yaml
flow:
  # what to watch on PRs this routine opens (auto-subscribed on creation)
  subscribe:
    events: [check_run, check_suite, pull_request_review, pull_request_review_comment,
             issue_comment, status, pull_request]      # the hook events to follow
    until: [merged, closed]                             # auto-unsubscribe conditions
    reconcile: 1h                                       # poll fallback for events webhooks don't deliver
    ttl: 14d                                            # hard stop so an abandoned PR can't subscribe forever

  # reactive rules: event on the owned PR  ->  handler.  ("if X CI fails do Y")
  reactions:
    - when: { check_run: { name: "ci/*", conclusion: failure } }
      do: fix-ci                                        # a handler (see §3)
      budget: { key: "pr:${{ pr.number }}:fix-ci", max: 3, on_exhausted: needs-human }

    - when: { pull_request_review: { state: changes_requested } }
      do: address-review

    - when: { issue_comment: { author_is_human: true, mentions_bot: true } }
      do: reply-or-act

    - when:                                             # compound condition
        all:
          - check_suite: { conclusion: success }
          - pull_request: { review_decision: approved }
      do: mark-ready

    - when: { conflict: true }                          # not always webhook-delivered → caught by reconcile
      do: rebase

    - when: { pull_request: { merged: true } }
      do: done                                          # terminal handler; unsubscribe + clean up

  on_idle:                                              # nothing happened for a while
    after: 24h
    do: nudge-author                                    # e.g. ping the reviewer once (rate-limited)
```

### Reaction semantics

- **Each matched reaction spawns a reaction run** of the routine (or a named child), scoped to that
  PR, carrying `${{ pr.* }}` + the triggering `${{ event.* }}`.
- Reactions obey **all of [05](05-concurrency-and-collisions.md)**: the reaction run takes the
  `pr:<repo>#<n>` **lease** (so two reactions on the same PR serialize), the **SHA barrier** drops a
  reaction computed against a stale head, **yield-to-human** stands down if a human just acted, and
  the per-handler **budget** bounds loops. A reactive flow is "just runs," so nothing about safety is
  special-cased.
- **First-match or all-match** is configurable per flow (`mode: first | all`); default `first` so
  one event yields one reaction.
- **Idempotent status surface** ([05](05-concurrency-and-collisions.md) §3.2) means the flow keeps
  updating *one* PR comment with current state instead of spamming on every reaction.

---

## 3. Handlers — what `do:` points at

A handler is the unit of "do Y." Three forms, most-portable first:

1. **A named body section** in the same file:
   ```markdown
   ## handler: fix-ci
   Read the failing required check's logs, diagnose by reading the source it points at,
   make the minimal fix, push to the PR head. Never force-push.
   ```
2. **Another routine** (composition): `do: routine:pr-cleanup` — hand the PR to the existing cleanup
   routine. This is how the reactive flow reuses Newton's `pr-cleanup` contract instead of restating
   it.
3. **An inline prompt** for one-liners: `do: { prompt: "Comment 'rebased onto develop' and resolve the conflict thread." }`.

Handlers inherit the routine's `tools`/grants by default, narrowable per handler. A handler that
pushes needs `push-commits`; one that only comments needs `pr-comment`.

---

## 4. Lifecycle (subscription state machine)

```
   routine run opens PR #N
            │  (open-pr capability used)
            ▼
   SUBSCRIBE(pr:#N)  ──auto, on PR creation──►  records owner_routine, owner_run, head_sha
            │
            ▼
   ┌─────────────► WATCHING ◄───────────── reconcile poll (every `reconcile`, catches missed events)
   │                 │
   │        hook event on pr:#N (or poll delta)
   │                 ▼
   │           match `reactions`
   │                 │ (matched)
   │                 ▼
   │        spawn REACTION RUN  ──(lease pr:#N · SHA barrier · budget · yield)──►  acts, may push/comment
   │                 │
   └─────────────────┘  (push moves head_sha → subscription updates; siblings self-invalidate)

   terminal:  pr merged/closed  → UNSUBSCRIBE, run `done` handler, release leases
              ttl exceeded       → UNSUBSCRIBE, mark needs-human (stale PR)
              budget exhausted   → stop reacting on that handler, surface NEEDS_HUMAN on the PR
```

- **Auto-subscribe on creation:** the runner detects the `open-pr` action and registers a
  `Subscription{ pr, owner_routine, owner_run, head_sha, events, until, ttl }` — the user gets the
  follow for free, exactly as the goal asks ("if the process were to create any PRs … it should be
  able to subscribe to hook events").
- **Reconcile fallback:** because CI-success / new-push / merge-conflict transitions aren't reliably
  delivered as webhooks (documented harness behavior), the Subscription Manager polls the PR on the
  `reconcile` cadence and synthesizes the missing events. The flow doesn't go deaf on the events that
  matter most.
- **Auto-unsubscribe:** merged/closed (or TTL) ends the subscription — no lingering watchers.

---

## 5. How it funnels into the management / flow diagram

The reactive rules turn a routine from "a prompt with triggers" into **a stateful flow**, and the UI
([08](08-team-web-ui.md)) renders it as a diagram — the management surface the user asked for:

```
  [trigger: cron weekdays 03:00]
            │
            ▼
     ( run: author tests ) ──opens──► ┌───────────── PR #N ─────────────┐
                                      │  subscription: WATCHING          │
                                      │                                  │
                ci/* fails ──────────►│  ▸ fix-ci      (budget 2/3)      │
                changes_requested ───►│  ▸ address-review                │
                green + approved ────►│  ▸ mark-ready                    │
                conflict ────────────►│  ▸ rebase                        │
                merged ──────────────►│  ▸ done  → UNSUBSCRIBE  ✅        │
                                      └──────────────────────────────────┘
```

What the diagram makes legible at a glance — and what's impossible to see today:

- the **triggers** that start it, the **run** that produces a PR, and the **reactive branches** that
  follow that PR;
- **live state per owned PR**: which PRs this routine currently watches, what each is waiting on,
  remaining per-handler budget, and any `NEEDS_HUMAN` stall;
- **which reaction fired when** (the activity timeline), so "why did it push again?" is answerable.

The routine detail page gains an **"Owned PRs / subscriptions"** panel: every PR this routine opened,
its subscription status, the last reaction, and the budget/lease state — the operational view of a
routine that babysits its own work.

---

## 6. Composition & edge cases

- **One routine, many PRs:** each opened PR gets its own independent `Subscription` row and its own
  `pr:#N` lease/budget, so a routine that opens five PRs follows five lifecycles without them
  interfering.
- **Subscriptions outlive the opening run:** the run that opened the PR finishes; the subscription
  persists in the control plane and spawns fresh reaction runs on later events. (Durable — survives
  restarts; [03](03-architecture.md).)
- **Human takes over:** `yield_to_human` means if the author pushes their own fix, the flow stands
  down rather than fighting them.
- **Cross-routine hand-off:** `do: routine:pr-cleanup` lets the watcher delegate the actual fixing to
  the shared cleanup routine; the lease keyed on `pr:#N` keeps the two from overlapping.
- **Stop following:** disabling the routine or an explicit "unsubscribe" control ([08](08-team-web-ui.md))
  ends all its subscriptions; merged/closed do so automatically.
- **Don't re-subscribe to PRs you didn't open** unless explicitly told: subscriptions default to
  artifacts the routine *created*; watching arbitrary PRs is a separate, explicit `on:` trigger.

---

## 7. Why this is the missing piece

- **First-party routines** can open a PR but have no notion of then following it and reacting — the
  loop ends at creation.
- **GitHub Actions** can trigger on `check_run`/`pull_request_review`, but a workflow has no built-in
  identity tie between "the PR I opened" and "the events I should now handle"; you wire it up by hand
  with labels and conditionals.
- **Switchboard** makes "follow the work you create, and react per these rules" a declared property
  of the routine, enforced with the same lease/budget/SHA machinery as everything else, and
  **visualized as the routine's flow** — which is exactly the management/flow-diagram concept the
  user wants this to funnel into.
