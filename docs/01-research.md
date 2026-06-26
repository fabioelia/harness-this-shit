# 01 — Research: the landscape we're building into

Three bodies of prior art shape this design: (A) Claude Code Routines as they exist today and where
they stop; (B) GitHub Actions, whose mental model we deliberately borrow; (C) Newton's own
`automations/` folder, which is a living proof that the "routine = Markdown file" idea works and
which canonical shape to standardize on. A short (D) covers adjacent prior art.

---

## A. Claude Code Routines today (the thing we're extending)

Routines shipped as a research preview on **April 14, 2026**. A routine is *a saved Claude Code
configuration — a prompt, one or more repositories, and a set of connectors — packaged once and run
automatically* on Anthropic-managed cloud infrastructure (so it runs with your laptop closed).

**Triggers available today (exactly three):**

| Trigger | Detail | Ceiling |
|---|---|---|
| **Scheduled** | Recurring cadence (hourly / daily / weekdays / weekly presets; custom cron via `/schedule update` in the CLI) or a one-shot future time. | **Minimum interval 1 hour** — sub-hour cron expressions are rejected. |
| **API** | HTTP `POST` to a per-routine endpoint with a bearer token. | On-demand only; you build any "real" trigger yourself upstream. |
| **GitHub** | Runs in response to repo events such as pull requests or releases. | Coarse-grained; not the full GitHub event surface, and not other SaaS events. |

**Operational limits that bite a team:**

- **Per-plan daily run caps:** Pro **5/day**, Max **15/day**, Team/Enterprise **25/day**. A team
  fleet (Newton runs ~20 automations, several every 30 min during business hours) blows past this in
  one morning.
- **Per-user ownership.** A routine belongs to the account that made it. No shared catalog, no
  team roles, no "who owns / last run / last failure" board, no audit trail.
- **Split configuration.** The *prompt* can live in your repo, but the *schedule / connectors /
  model* live in the web console. There is no single reviewable artifact that is the whole routine.
- **No cloud browser / local state** (no cookies, GUI, persistent browser) — fine for our scope but
  worth noting for parity expectations.

**The billing tailwind (June 15, 2026):** headless `claude -p` and Claude Agent SDK usage **stopped
counting against normal Claude subscription session limits**. This is strategically important: a
harness that executes routines via `claude -p` / the Agent SDK is **not** bound by the routine
daily-run caps above. Running our own runner is therefore both *more capable* and *more economical*
than driving first-party routines for a team.

> **Takeaway.** First-party routines are the right primitive for one person's nightly job. They are
> the wrong primitive for a team's operational fleet. The gaps — triggers, team exposure, single
> source of truth, collision control, MCP management — are exactly Switchboard's surface area.

Sources:
[Claude Code Routines docs](https://code.claude.com/docs/en/routines) ·
[Introducing routines (Anthropic blog)](https://claude.com/blog/introducing-routines-in-claude-code) ·
[Routines launch coverage](https://winbuzzer.com/2026/04/16/anthropic-claude-code-routines-scheduled-ai-automation-xcxwbn/) ·
[Billing change explainer](https://genaiunplugged.substack.com/p/claude-billing-change-workarounds-free-ai-automations).

---

## B. GitHub Actions — the mental model we steal

The user explicitly wants "aspirations we can draw from GitHub Actions." GHA is the gold-standard
"event → automated work" system. The concepts worth importing wholesale:

| GHA concept | What it gives users | Switchboard equivalent |
|---|---|---|
| **`on:` triggers** | One workflow, many trigger types (push, pull_request, schedule, workflow_dispatch, repository_dispatch, issue_comment, check_run, label, …), each with filters (branches, paths, types). | The trigger taxonomy in [04](04-triggers.md). This is the direct answer to "limited trigger controls." |
| **Workflow file in-repo** | The automation is a version-controlled file reviewed via PR; history, blame, rollback come free. | The `*.routine.md` file ([02](02-routine-spec.md)). |
| **`workflow_dispatch` + inputs** | A "Run" button with typed parameters; manual + automated share one definition. | Manual dispatch with declared `inputs:` ([04](04-triggers.md), [08](08-team-web-ui.md)). |
| **Runs, jobs, steps, logs** | Every execution is a first-class object with status, timing, logs, and artifacts you can inspect and re-run. | The Run model ([03](03-architecture.md)). |
| **`concurrency:` groups** | `concurrency: { group: deploy-${{ env }}, cancel-in-progress: true|false }` serializes or cancels overlapping runs by a key. Newton already uses exactly this for PR cleanup. | Concurrency groups + leases ([05](05-concurrency-and-collisions.md)). |
| **Environments + secrets** | Scoped secrets, required reviewers, protection rules per environment. | Connector/MCP grants + secret scoping + approval gates ([06](06-connectors-and-mcp.md)). |
| **Reusable workflows / composite actions** | DRY: call a shared workflow; pass inputs. | Routine includes / shared prompt fragments ([02](02-routine-spec.md)). |
| **The Marketplace** | Discover and adopt others' automations. | A routine catalog/templates a team can fork ([08](08-team-web-ui.md), [10](10-roadmap.md)). |
| **Required status checks / branch protection** | Automation output gates merges. | Routines that emit check-runs and participate in the merge gate ([07](07-github-integration.md)). |
| **OIDC / least-privilege tokens** | Short-lived, scoped credentials per run. | Per-run scoped GitHub App installation tokens + per-routine grants ([06](06-connectors-and-mcp.md)/[07](07-github-integration.md)). |

**What we deliberately do *not* copy:** YAML-as-imperative-steps. GHA workflows are scripts;
Switchboard routines are *prompts* — the "steps" live in the Markdown body as natural-language
procedure (exactly how Newton writes them). We keep GHA's *control-plane* model (triggers, runs,
concurrency, environments) and replace its *execution* model (shell steps) with an agent loop.

---

## C. What Newton's `automations/` folder taught us

This is the most valuable input: a real team already converged on "routine = Markdown file" and ran
it in production. The folder's own `README.md` is, in effect, a v0 spec. Key findings:

### C1. The shape already exists and works

Every automation is **one `.md` file: YAML front matter (metadata + trigger + tool/MCP grants)
followed by the prompt under a `## Prompt` heading.** Newton runs ~20 of these. We are not inventing
a shape — we are **standardizing and extending** a proven one. (Full schema in [02](02-routine-spec.md).)

### C2. The substrate split is the pain — and the opportunity

Newton's README says it plainly: *"Two execution substrates share this folder"* —

- **Cursor Cloud automations** (cron/event, configured in the Cursor console), and
- **GitHub Actions automations** (`gha-*`, invoked from `.github/workflows/`).

And critically: *"The console prompt should do nothing but point at the file here* (`Read
automations/<slug>.md … and follow it exactly`)*; the real prompt is version-controlled in this
repo."* The runtime config (schedule, model, grants) lives in a console, the prompt lives in the
repo, and the front matter **mirrors** the console so the metadata is "versioned and reviewable."

That mirroring is a *workaround for not having Switchboard*. The front matter wants to be the source
of truth, but no runtime reads it — so it's duplicated by hand into a console. **Switchboard's
single biggest unlock is: the front matter stops being a mirror and becomes the actual runtime
config.** One file, no console, no drift.

### C3. The trigger vocabulary teams actually need (8 types, not 3)

Harvested from the front matter of all ~20 Newton automations:

| Trigger `type` | Example | Notes |
|---|---|---|
| `cron` | `"0 13 * * *"`, `"*/30 9-17 * * *"` | **Sub-hour** (`*/30`) and business-hours windows — both below first-party routines' floor. |
| `git-push` | push to `main` / `stage` | Branch-filtered. (Freeze Analysis, Release Preview.) |
| `git-label` | `cursor-review` / `jira-ticket` added | With `on_added: true`. The dominant event trigger. |
| `slack-message` | message in channel `C0AHK1RAH62` | Channel-scoped. (File-user-requests, ticket nudges.) |
| `check_run` | `review/*` completed | The auto-cleanup loop's trigger; gated by a script. |
| `pull_request` | `action: closed, merged: true, base: [...]` | Release-wiki summary. |
| `workflow_dispatch` | manual button | Release-wiki, GHA cleanup. |
| `manual` | `/pr-cleanup <n>`, `/pr-review <pr>` | Slash-command / by-hand. |

Plus an implicit ninth: **hand-off / chaining** — the `*-followup.md` automations
(`daily-triage-pipeline-followup`, `solutions-triage-blockers-followup`) are routines whose job is
to watch what *another* routine produced and continue it. That's "trigger: after routine X" — a
first-class need that neither GHA nor first-party routines model cleanly.

### C4. Tool & MCP grants are already declarative

Front matter declares exactly what a routine may touch:

```yaml
tools:
  mcp_servers: [Slack, Atlassian, Sentry]      # MCP servers it may use
  capabilities: [slack-read, slack-post, open-pr, pr-comment, github]  # native grants
  slack_channels: [C0...]                        # resource-scoped
```

This is already a least-privilege grant model. Switchboard turns it into managed connectors with
real credential injection (see [06](06-connectors-and-mcp.md)). Note the model is also already
**model-agnostic**: Newton's automations name `opus`, `claude-opus-4-8-thinking-high`,
`gpt-5.5-medium`, `composer-2.5`, `gpt-5.4-high`, etc. The harness must not assume one model.

### C5. Secrets are declared, never embedded

Newton's rule: *"Secrets never live in these files or in the cloud prompt."* Instead, the front
matter declares an **expectation** and the prompt reads the value from a memory store at runtime:

```yaml
memory: true
memory_expects:
  - key: SLACK_BOT_TOKEN
    where: triage-follow-up-secrets.md
    description: >-
      Slack bot token with reactions:write scope; read from memory at runtime. Never printed.
```

Switchboard formalizes this as a secret store with injection + redaction ([06](06-connectors-and-mcp.md)).

### C6. Collision control was hand-built — and is the template for our platform primitive

The `auto-cleanup` loop is the richest artifact in the repo. To let an agent safely push commits to
PRs *without* two runs (or two review "voices") fighting, Newton built a guard stack in
`scripts/auto_cleanup_gate.py` plus a GHA `concurrency:` group. Its own docstring lists the stack:

1. the completed check is a `review/*` verdict;
2. **SHA guard** — the verdict's head SHA must equal the PR's *current* head (stale verdict → drop);
3. **barrier** — every expected `review/*` verdict is present for that SHA;
4. **opt-in** — the PR carries the `auto-cleanup` label (write consent);
5. **yield** — no human pushed on top of our last fix (else stand down);
6. **budget** — per-PR iterations remaining > 0 (default 3);
7. **verdict** — at least one expected review is failing.

And the killer line: *"Idempotency with multiple voices is free: the first event that passes acts
and pushes, which changes the head SHA, so any sibling event fails the SHA guard."* Plus the GHA
side: `concurrency: { group: auto-cleanup-${PR}, cancel-in-progress: false }`.

That is *exactly* the "avoid multiple agents touching the same PR" mechanism the user asked for —
but today it's bespoke Python wired into one workflow. **Switchboard makes leases, SHA barriers,
concurrency groups, opt-in/write-consent, and iteration budgets into declarative front-matter
fields backed by a platform dispatcher.** ([05](05-concurrency-and-collisions.md) generalizes it.)

### C7. Idempotency, dedup, and "near-silent" output are recurring themes

Across the prompts: upsert a single marker-tagged PR comment (never spam), dedup multiple bot
comments by keeping the earliest, "silent runs are success," fingerprint a run to skip identical
work. These are *operational conventions* the platform should make easy (idempotency keys, a single
"routine status surface" per target, structured run summaries) — see [03](03-architecture.md)/[05](05-concurrency-and-collisions.md).

---

## D. Adjacent prior art (and why we differ)

- **n8n / Zapier / Make** — great trigger breadth and a node UI, but the unit of work is a
  data-flow graph, not an agent with a repo checkout and tools. We want agent-native, repo-native.
- **Temporal / Netflix Conductor / Spotify Maestro** — durable workflow engines; the right
  *backbone* for our run state and retries, the wrong *front door* for "edit a Markdown prompt."
  We may use one internally (see [09](09-tooling-stack.md)); we don't expose it.
- **GitHub Actions itself** — already covered; closest mental model, wrong execution unit.
- **Sweep / Devin / Cursor background agents / Copilot Workspace** — agent-runs-on-tasks products,
  but each is its own closed loop. None is an *open harness* where the team authors the routines as
  files, manages MCPs centrally, and gets a collision dispatcher across many automations.
- **Claude Code subagents & the Agent SDK** — these are our *building blocks* (the runner), not a
  competitor. Newton's `.claude/agents/*` show how rich a single routine's internal fan-out can be.

> **Net:** the novel, defensible combination is **(routine-as-Markdown) × (broad triggers like GHA)
> × (a collision dispatcher) × (central MCP management) × (a team UI)**, with Claude Code as the
> runner. No existing product sits in that exact intersection.
