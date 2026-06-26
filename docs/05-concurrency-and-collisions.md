# 05 — Concurrency & collision control: "two agents never touch the same PR"

This is the requirement the user called out specifically, and it's the part Newton had to build by
hand. The good news: their hand-built solution (`scripts/auto_cleanup_gate.py` + a GHA
`concurrency:` group) is a *complete, battle-tested blueprint*. This doc generalizes it into five
declarative platform primitives enforced by the **Dispatcher**, so every routine gets safety without
re-deriving it in a prompt.

---

## 1. The failure modes we're preventing

When many event-driven agents share a repo, the dangerous overlaps are:

1. **Two runs, same target.** A `synchronize` and a `check_run` event both want to fix PR #123;
   both clone, both push → conflicting commits, doubled comments, wasted spend.
2. **Multiple "voices," same trigger.** Newton runs a Claude reviewer *and* a GPT reviewer; both
   emit `review/*` checks; both could trigger cleanup. Only one should act.
3. **Stale work.** A run computed a fix against SHA `abc`; by the time it's ready, the human pushed
   `def`. The fix is now wrong and could clobber.
4. **Runaway loops.** Review → fix → re-review → fix … forever. Cost and churn with no convergence.
5. **Stomping a human.** The agent and a human edit the same PR concurrently; the agent overwrites
   intent.
6. **Spam.** Each run posts a fresh comment instead of updating one.
7. **Deadlock.** A run crashes holding a claim; the target is stuck forever.

Newton's gate addresses every one of these. We make each a primitive.

---

## 2. The five primitives (all declarative in `concurrency:`)

### 2.1 Concurrency groups (serialize or supersede) — from GHA + Newton

```yaml
concurrency:
  group: "pr-cleanup-${{ event.pr.number }}"
  cancel_in_progress: false     # false ⇒ queue/serialize; true ⇒ cancel the in-flight run
```

Runs whose resolved `group` key collide are **serialized** (`false`, Newton's choice for cleanup —
you don't want to cancel a half-done fix) or the new one **supersedes** the old (`true`, right for
"only the latest matters," e.g. a digest). Directly mirrors GHA `concurrency:` and Newton's
`group: auto-cleanup-${PR}, cancel-in-progress: false`. Solves failure mode **1**.

### 2.2 Leases (claim-before-act) — generalizes the opt-in/act/idempotency dance

A **lease** is an exclusive, TTL'd claim on a *resource* (a PR, a ticket, a branch, a file path)
held for the duration of a run. The Dispatcher acquires it *before* admitting and releases it at
finalize.

```yaml
concurrency:
  lease:
    resource: "pr:${{ event.repo }}#${{ event.pr.number }}"
    ttl: 20m
    on_conflict: skip        # skip | queue | steal-if-expired
```

- **Acquire-before-act**: a run can't start unless it holds the lease. The *first* qualifying event
  wins; siblings see the lease held and `skip`. This is the platform version of Newton's
  *"the first event that passes acts and pushes … any sibling event fails the guard."* Solves **2**.
- **TTL + auto-expiry**: if a run crashes, the lease expires; `steal-if-expired` lets a later run
  reclaim a dead resource. Solves **7** (deadlock).
- Leases compose: a routine can hold `pr:#123` (the PR) and the dispatcher can additionally enforce a
  coarser `repo:newton` lease for routines that must never overlap repo-wide.

The difference between a *group* and a *lease*: a group serializes runs of the **same routine**; a
lease is cross-routine and cross-event — *any* routine claiming `pr:#123` excludes *any other*. That
cross-routine exclusion is what stops two *different* automations from fighting over one PR.

### 2.3 SHA barrier (stale-work protection) — Newton's "SHA guard"

```yaml
concurrency:
  barrier:
    stale_if_sha_changed: "${{ event.pr.head_sha }}"
```

At admit time *and* again just before the effectful action, the dispatcher compares the SHA the run
was computed against to the target's *current* head SHA. If it moved, the run is **dropped as
stale** (`SKIPPED: stale-sha`). This is Newton's #2 guard verbatim, and the source of its elegant
*"idempotency with multiple voices is free"* — once one run pushes, the head SHA changes and every
sibling self-invalidates. Solves **3** and reinforces **2**.

Optional companion — the **completion barrier**: wait until *all* expected signals for a SHA are
present before acting (Newton waits for both `review/claude` and `review/gpt`):

```yaml
concurrency:
  barrier:
    await_all: ["review/claude", "review/gpt"]   # don't act until every voice has reported on this SHA
```

### 2.4 Yield to humans — Newton's "yield" guard

```yaml
concurrency:
  yield_to_human: true
```

Before acting, check whether a human has acted on the target *after the agent's last action* (e.g.
pushed a commit on top of the agent's last fix). If so, **stand down** (`SKIPPED: yielded`). The
machine never argues with a human who just took the wheel. Solves **5**. (Newton: *"no human has
pushed on top of our last fix (else stand down)"*.)

### 2.5 Iteration budgets — Newton's per-PR budget

```yaml
concurrency:
  budget:
    key: "pr:${{ event.pr.number }}"
    max_iterations: 3
    on_exhausted: needs-human
```

A per-target counter, decremented **only on an effectful run** (Newton: "no push → no iteration
consumed"). At zero, the dispatcher stops admitting and the target enters the observable
`NEEDS_HUMAN` terminal state. Bounds the review→fix→re-review loop. Solves **4**. The budget is
**observable** (a `loop-budget` surface on the target, exactly like Newton's `<!-- loop-budget -->`
comment), so an exhausted-but-still-failing loop is visible, not silent.

---

## 3. Supporting mechanisms (not in `concurrency:`, but part of the safety story)

### 3.1 Write-consent / opt-in (the `auto-cleanup` label, generalized)

A routine that *mutates* a shared target should require explicit consent. Newton models this as the
`auto-cleanup` label (human-applied; an agent must never self-apply). In Switchboard this is a
**grant precondition** on the trigger:

```yaml
on:
  - github:
      event: check_run
      requires_optin: { label: auto-cleanup }   # the PR must carry this label to admit a mutating run
```

The harness enforces "never act on a target without consent" centrally, and the audit log records
who granted it. Read-only routines (reviewers, digests) need no opt-in; write routines do.

### 3.2 Idempotent status surfaces (anti-spam) — Newton's marker-comment convention

```yaml
outputs:
  status_surface: { type: pr-comment, marker: "<!-- auto-cleanup-summary -->" }
```

The harness owns the upsert: find the one comment carrying the marker and update it, else create it.
Manual and automated runs share the marker, so they update the *same* surface. One comment per
target, never spam. Solves **6**. The same idea covers a single Slack thread, a single check-run, etc.

### 3.3 Dedupe keys & debounce (from [04](04-triggers.md))

A force-push fires a storm; `debounce` + `dedupe_key` collapse it to one `RunRequest` before the
dispatcher even looks — cheap defense ahead of the leases.

---

## 4. The Dispatcher algorithm

For each `RunRequest` (one matched routine + event), evaluated in a single serializable transaction:

```
admit(req):
  if not req.routine.enabled:                      return SKIP("disabled")
  if req.trigger.requires_optin and not present:   return SKIP("no-consent")
  if req.trigger.gate and gate_exit != 0:          return SKIP("gate-rejected")

  # policy
  if over_rate_cap(req.routine):                   return SKIP("rate-capped")
  if req.routine.requires_approval and not approved:return QUEUE_FOR_APPROVAL

  # collision control (the heart)
  grp = resolve(req.concurrency.group)
  if grp active:
     if cancel_in_progress: cancel(active_run(grp)) # supersede
     else:                  return QUEUE(grp)        # serialize

  if barrier.await_all and not all_present(sha):    return SKIP("awaiting-barrier")
  if barrier.stale_if_sha_changed != current_head:  return SKIP("stale-sha")
  if yield_to_human and human_acted_since_last():   return SKIP("yielded")

  if budget.remaining(key) <= 0:                    return TERMINAL(NEEDS_HUMAN)

  lease = try_acquire(req.concurrency.lease)         # atomic
  if lease is None:
     switch on_conflict:
        skip:             return SKIP("lease-held")
        queue:            return QUEUE(lease.resource)
        steal_if_expired: if expired: lease = steal() else return SKIP("lease-held")

  return ADMIT(holding=lease)                         # → Run Orchestrator
```

Finalize (always, even on crash via the lease TTL):

```
finalize(run):
  if run.was_effectful: budget.decrement(run.budget_key)   # only real work costs budget
  upsert_status_surface(run)                                # idempotent
  emit_check_run(run) if configured                         # joins the merge gate
  release_lease(run.lease)
  emit downstream `after:` events
  audit(run)
```

Two properties fall out for free, exactly as Newton observed:
- **Multi-voice idempotency**: whoever acquires the lease first acts and pushes; the push moves the
  head SHA, so any sibling that somehow got past the lease still fails the SHA barrier.
- **Crash safety**: the lease TTL guarantees no resource is locked forever; `steal-if-expired`
  reclaims it.

---

## 5. Implementation notes (leases that actually hold under load)

- **Backed by Postgres**, not Redis-as-truth: a `leases` table with `UNIQUE(resource)`, `holder_run`,
  `expires_at`, `sha`. Acquire = `INSERT … ON CONFLICT DO NOTHING` (or `UPDATE … WHERE expires_at <
  now()` for steal). The whole `admit()` runs in a `SERIALIZABLE` transaction (or behind a Postgres
  **advisory lock** keyed by a hash of the group/resource) so two dispatcher replicas can't both
  admit. This is the standard "exactly-one-wins" pattern and is robust under horizontal scaling.
- **Heartbeats**: a long run renews its lease (`expires_at = now()+ttl`) periodically; if the runner
  dies, renewals stop and the lease lapses at TTL.
- **Ordering**: the Event Bus keys by `resource` so events about one PR are processed in order,
  which makes the SHA/yield checks meaningful.
- **Observability**: every `SKIP`/`TERMINAL` reason is recorded and surfaced (UI + on-target),
  honoring Newton's "terminal states are observable, not hidden in labels."

---

## 6. Worked example — the review→cleanup loop, with all five primitives

Two reviewers (`review/claude`, `review/gpt`) and one cleanup routine on PR #1342, head SHA `abc`:

1. Both reviewers run (read-only; no lease needed) and each emits a `review/*` check on `abc`.
2. The second check completion fires the cleanup routine **twice** (one event per check). For each:
   - `requires_optin: auto-cleanup` — PR has the label ✓.
   - `barrier.await_all: [review/claude, review/gpt]` — both present on `abc` ✓.
   - `barrier.stale_if_sha_changed: abc` == current head `abc` ✓.
   - `yield_to_human` — no human pushed since ✓.
   - `budget` — 3 remaining ✓.
   - `lease pr:#1342` — **the first event acquires it; the second sees it held → SKIP("lease-held").**
3. The admitted run fixes files, pushes a commit → head SHA becomes `def`, budget → 2, status
   comment upserted, lease released.
4. The push re-triggers review on `def`. If the new verdict still fails and budget remains, the loop
   advances; when it passes, it converges (no-op); if budget hits 0 while still failing →
   `NEEDS_HUMAN`, surfaced on the PR. No collision, no spam, no runaway, no human stomping —
   **and not a line of bespoke Python in the routine.**

This is Newton's `auto_cleanup_gate.py` behavior, now a property of the platform that *any* routine
inherits by filling in `concurrency:`.

---

## 7. Cross-routine & fleet-level guarantees

- **Cross-routine exclusion**: because leases are keyed by *resource* (not routine), `ticket-police`
  and `pr-cleanup` both claiming `pr:#1342` are mutually exclusive — different automations can't
  collide on one PR either.
- **Global safety valves** (org policy): max concurrent runs per repo, max concurrent
  PR-mutating runs, a kill-switch per routine and org-wide (instant disable). A bad routine can be
  stopped fleet-wide from the UI in one click ([08](08-team-web-ui.md)).
- **Dry-run mode**: `inputs.dry_run` / a global flag makes a run compute and report *without* the
  effectful step — safe rehearsal before granting write consent.
