# Switchboard — a team harness for Claude Code routines

> **Status:** Design package plus a working implementation with **one engine and two front
> doors**. [`docs/`](docs) holds the shared understanding (what we're building and why, the
> canonical shape, the tools). [`harness/`](harness) is the **engine + headless CLI**: it reads
> a folder of front-matter `.md` routines, wires cron/webhooks/MCPs per the
> [docs/02 spec](docs/02-routine-spec.md), and logs everything to that folder's single
> `.harness` file. [`app/`](app) is the **Fleet console** — the web UI, whose Express server
> embeds the same harness engine and edits the same `.md` files (no database). Point both at
> one folder and they stay in agreement. "Switchboard" is a working codename — rename freely.

## Try the headless harness

```bash
cd harness && npm install
node bin/harness.js validate examples/routines    # schema-check + lint the fleet
node bin/harness.js up examples/routines          # wire triggers, stay resident
tail -f examples/routines/.harness                # the single log of everything
```

The MD folder is the entire config — front matter drives triggers, grants, concurrency,
policy; the body is the prompt run through headless `claude -p`. Slack and Jira are wired
via the connector registry (`connectors.yaml` + builtins). See [`harness/README.md`](harness/README.md).

## Try the app (web UI)

```bash
cd app && npm run install:all && npm run dev      # web → http://localhost:5317
```

A pixel-close recreation of the **Switchboard Fleet** Claude Design file: the dense Fleet table,
routine detail (front-matter contract, reactive flow, live leases), run detail (timeline,
dispatcher decision, outputs), and the connectors registry — all wired to a SQLite store and
live controls (toggles, run-now, kill switch). See [`app/README.md`](app/README.md).

## The one-paragraph version

[Claude Code Routines](https://code.claude.com/docs/en/routines) let you save a prompt + repos +
connectors and run it on a schedule, an API call, or a GitHub event. It's great — but it's
**single-player** (per-user, daily run caps), **thin on triggers** (3 types, 1-hour minimum
cadence), and its config is **split** between a web console and your repo. Real teams outgrow it
fast: the Newton repo already runs ~20 automations needing *eight* trigger types, sub-hour cadence,
shared ownership, and a hand-built gate so two agents never fight over the same PR. **Switchboard is
the harness that closes that gap**: a web service where a team sees, edits, and controls every
automation; each one is a single version-controlled Markdown file; triggers are first-class and
broad (the way GitHub Actions' `on:` is); connectors/MCPs are managed centrally; and a dispatcher
guarantees that two agents never touch the same task or PR at once.

## The problem, concretely

The user already lives this. They love routines but hit three walls:

1. **Limited trigger controls.** Claude routines fire on *schedule / API / GitHub PR-or-release*
   only, with a **1-hour minimum** interval and **per-plan daily run caps** (5 / 15 / 25). Newton's
   real automations need: cron down to 30 min, Slack messages, label-added, check-run-completed,
   PR-comment-edited, "after another routine finished" (hand-off), and manual slash-commands. (See
   [`docs/01-research.md`](docs/01-research.md) for the side-by-side.)
2. **No team exposure.** Routines are owned by one person's account. There's no shared catalog the
   team can browse, no "who owns this / when did it last run / why did it fail," no role-based
   control, no audit trail. Today Newton fakes team visibility by checking prompts into
   `automations/` and pasting pointers into a Cursor Cloud console — a workaround, not a product.
3. **No collision control.** Nothing stops two routines (or two runs of one) from grabbing the same
   PR and pushing conflicting commits. Newton had to *hand-build* a guard stack
   (`scripts/auto_cleanup_gate.py` + GitHub Actions concurrency groups + a SHA barrier) to make one
   automation safe. That should be a platform primitive, not per-automation plumbing.

## What we're building (the three pillars)

| Pillar | What it means | Borrowed from |
|---|---|---|
| **1. The routine *is* a Markdown file** | One `*.routine.md` per automation: YAML front matter (triggers, tools, MCP/connector grants, concurrency, owner) + the prompt body. The file is the single source of truth; the web UI and the runtime both read it. Git is the system of record. | Newton's `automations/` folder — this shape already works; we standardize and extend it. |
| **2. Triggers & runs, like GitHub Actions** | A broad `on:` trigger taxonomy, an event bus, a run model with logs/status/artifacts, manual dispatch with inputs, environments/secrets, reusable building blocks, and a "marketplace" of shareable routines. | GitHub Actions' mental model (`on:`, jobs, runs, concurrency, environments, the Marketplace). |
| **3. A dispatcher that prevents collisions** | A central scheduler that leases work. Per-resource concurrency groups, claim-before-act leases on PRs/tickets/branches, a SHA barrier so stale work self-drops, and per-target iteration budgets. Two agents can never iterate the same PR. | Newton's `auto_cleanup_gate.py` guard stack, generalized into a platform service. |

Wrapped around all three: a **web service with a team UI**, **GitHub integration as a first-class
citizen**, and **central connector/MCP management** so adding "this routine may use Slack + Sentry"
is a checkbox, not a console expedition.

## How Switchboard relates to Claude Code

Switchboard does **not** replace Claude Code — it *harnesses* it. Claude Code (headless `claude -p`
/ the Claude Agent SDK) is the execution engine that actually runs each routine's prompt in a
sandboxed clone of the repo. Switchboard is the **control plane** around it: triggers, scheduling,
team UI, secrets/MCP wiring, concurrency/leasing, GitHub plumbing, observability, and audit. Think
"GitHub Actions for Claude routines," where the routine definition is a Markdown file instead of a
YAML workflow, and the runner is Claude Code instead of a shell.

> Note (June 2026): headless `claude -p` and Agent SDK usage no longer count against normal
> subscription session limits — which is exactly why running routines through the harness on
> `claude -p` sidesteps the per-plan daily-run caps that make first-party routines impractical for a
> team. See [`docs/01-research.md`](docs/01-research.md).

## Reading order

| Doc | What's in it |
|---|---|
| [`docs/01-research.md`](docs/01-research.md) | Claude routines today & their limits; GitHub Actions concepts worth stealing; what Newton's `automations/` folder taught us; prior art. |
| [`docs/02-routine-spec.md`](docs/02-routine-spec.md) | **The core.** The canonical `*.routine.md` schema — front matter + body — generalized and extended from Newton's automations, with ported examples. |
| [`docs/03-architecture.md`](docs/03-architecture.md) | System components, control/data plane split, the execution substrate, data model, run lifecycle, deployment. |
| [`docs/04-triggers.md`](docs/04-triggers.md) | The full trigger taxonomy and the event bus that feeds it. |
| [`docs/05-concurrency-and-collisions.md`](docs/05-concurrency-and-collisions.md) | Leases, concurrency groups, the SHA barrier, claim protocol, iteration budgets — how two agents never collide. |
| [`docs/06-connectors-and-mcp.md`](docs/06-connectors-and-mcp.md) | The connector/MCP registry, grants, secrets, OAuth, "make it trivial to manage MCPs." |
| [`docs/07-github-integration.md`](docs/07-github-integration.md) | The GitHub App, event ingestion, PR ownership, write-consent model. |
| [`docs/08-team-web-ui.md`](docs/08-team-web-ui.md) | The web service: surfaces, RBAC, what the team actually sees and does. |
| [`docs/09-tooling-stack.md`](docs/09-tooling-stack.md) | Recommended tech stack, build-vs-buy, and the tools we'll want. |
| [`docs/10-roadmap.md`](docs/10-roadmap.md) | A phased build plan, open questions, and risks. |
| [`docs/11-reactive-flows-and-pr-subscriptions.md`](docs/11-reactive-flows-and-pr-subscriptions.md) | When a routine **opens a PR**, it subscribes to that PR's hook events and reacts per declared rules ("if CI check X fails, do Y") — and that becomes the routine's flow diagram. |

## Mapping the ask → the design

Every line of the original goal has a home:

- *"harness on top of Claude Code that serves as the harness for routines"* → [03 Architecture](docs/03-architecture.md) (Claude Code as runner; Switchboard as control plane).
- *"web service where users can see / update / adjust / control all automations"* → [08 Team Web UI](docs/08-team-web-ui.md).
- *"everything powered via the MD file… canonical shape from Newton automations"* → [02 Routine Spec](docs/02-routine-spec.md).
- *"support connectors… trivial to manage and control other MCPs"* → [06 Connectors & MCP](docs/06-connectors-and-mcp.md).
- *"basic user / team interface"* → [08 Team Web UI](docs/08-team-web-ui.md) (RBAC + teams).
- *"GitHub integration is a must"* → [07 GitHub Integration](docs/07-github-integration.md).
- *"avoid multiple agents touching / iterating the same tasks / PRs"* → [05 Concurrency & Collisions](docs/05-concurrency-and-collisions.md).
- *"routines that open PRs should subscribe to hook events and react ('if CI X fails, do Y'), funneling into the routine's flow diagram"* → [11 Reactive Flows & PR Subscriptions](docs/11-reactive-flows-and-pr-subscriptions.md).
- *"aspirations from GitHub Actions"* → [01 Research §GitHub Actions](docs/01-research.md) + threaded through 03/04/05/06/11.
- *"limited trigger controls"* → [04 Triggers](docs/04-triggers.md).
- *"no team exposure"* → [08 Team Web UI](docs/08-team-web-ui.md).
