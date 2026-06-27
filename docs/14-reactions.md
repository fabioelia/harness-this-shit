# 14 — Reactions: "follow the work you create"

A routine doesn't end when its session does. The thing it touched — a PR, a deploy, a
Slack thread, a Jira ticket — keeps **emitting state over time**. A **reaction** lets a
routine watch that downstream state and invoke a follow-up routine when a condition is met.

> Example: a routine fires on a push and opens/identifies PR #42. PR #42 then runs CI.
> A reaction `github:checks:failure → triage-ci` watches #42's checks and, when they
> finish red, fires the `triage-ci` routine with the failing checks as context.

This is different from `chain` (which fires *immediately* on the upstream run's success).
A reaction fires **later**, when an **external condition on a specific entity** becomes true.

---

## The general model

A reaction is a **watch** on an entity:

```
reaction = { on: { source, kind, when }, run: <routine> }
watch    = reaction + resolved entity + lifecycle state
```

- **source** — where the entity lives (`github`, `ci`, `slack`, `jira`, `sentry`, `timeout`).
- **kind** — what to watch (`checks`, `review`, `merge`, `comment`, `transition`, `reply`, `after`…).
- **when** — the condition that fires (`success`, `failure`, `any`, `approved`,
  `changes_requested`, `resolved`, a duration…).
- **entity** — the concrete thing, resolved when the originating routine runs
  (`{repo, pr}`, `{thread_ts}`, `{issue_key}`, `{duration_ms}`).

Two ways the harness learns the entity's state — a **source adapter** implements one:

1. **Poll** (default for a local harness, no public webhook needed): the watcher loop
   periodically asks the source for the entity's state (`gh pr view … --json
   statusCheckRollup`) and evaluates `when`. This is how the CI-checks example works
   *without* GitHub being able to reach your laptop.
2. **Match** (when events already flow in): an incoming webhook/event is matched to an
   open watch by entity + condition, firing it immediately.

Lifecycle: `open → fired | dropped | expired`.
- **fired** — condition met → the target routine is invoked.
- **dropped** — the condition can no longer be met (watching for `success` but checks went red).
- **expired** — gave up after a bounded number of polls / a TTL (so a stuck PR doesn't poll forever).

---

## What "reactions" look like across sources

| Source | kind | `when` examples | How the adapter checks |
|---|---|---|---|
| **github** | `checks` | success / failure / any | `gh pr view N --json statusCheckRollup` |
| github | `review` | approved / changes_requested / any | `gh pr view N --json reviews` |
| github | `merge` | merged / closed | `gh pr view N --json state,mergedAt` |
| github | `comment` | any / matches-pattern | `gh pr view N --json comments` |
| **ci/cd** | `deploy` | success / failure | `deployment_status` webhook or a status poll |
| **slack** | `reply` | any / from-human | `conversations.replies` on the posted `thread_ts` |
| slack | `reaction` | ✅ / 👀 added | `reactions.get` on the message |
| **jira** | `transition` | In Review / Done | poll issue status |
| jira | `comment` | any | poll issue comments |
| **sentry** | `issue` | resolved / regressed | poll issue state |
| **timeout** | `after` | 30m / 4h / 1d | wall-clock — fires if nothing else resolved it first |

`timeout` is the universal one: *"if the PR isn't reviewed within 4h, escalate"* — a
reaction whose condition is the absence of another. It pairs with the others: arm a
`review:approved` watch **and** a `timeout:4h → ping-team` watch; whichever fires first wins.

---

## Implementation in Switchboard (v1)

- **Declared on the routine**: `reactions: [{ source, kind, when, run }]` (a new field, round-tripped into the `.routine.md`).
- **Entity resolution**: when the routine runs, the harness resolves the PR from the
  trigger event (`pull_request.number` + repo, or the pushed branch via `gh pr list --head`)
  and creates one **watch** per reaction. `timeout` reactions need no entity.
- **Watcher loop**: a dependency-free poller (every ~45s) walks open watches and calls the
  source adapter. **Implemented now:** `github:checks`, `github:review`, `github:merge`,
  and `timeout`. Other rows in the table above are scaffolded behind the same adapter
  interface (`poll(entity) → state`, `evaluate(state, when) → fire|keep|drop`).
- **Firing**: the target routine runs with a `reaction` event carrying the entity +
  observed state (`{event:'reaction', source, kind, when, pull_request, checks, upstream}`),
  and is subject to the same **cycle/depth guard** as chains, so reactions can't loop forever.
- **Observability**: watches are listed at `/api/watches` and surfaced on the routine
  detail + Activity (created / fired / dropped / expired), so you can see exactly what the
  system is waiting on and why it acted.

### Why poll-first matters here
The whole product thesis is *runs on your machine with your real tools*. Polling means a
reaction works the moment you grant `github` — no inbound webhook, no public URL, no GitHub
App. When you *do* expose the webhook receiver, the same watches resolve via match instead,
for free.
