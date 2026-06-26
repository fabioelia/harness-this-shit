# 10 — Roadmap, open questions, risks

A phased plan that delivers a usable slice early and lands the three pillars
([README](../README.md)) in order of leverage. Each phase is shippable and demoable on its own.

---

## Phase 0 — The contract (1–2 weeks)

**Goal:** pin the thing everything else depends on.

- Author the **`*.routine.md` JSON-Schema** (front matter) from [02](02-routine-spec.md).
- Build the **parser + validator** (schema + grant lint + `${{ }}` reference checks).
- **Port 3–5 Newton automations** to the spec as fixtures (`pr-attention-digest`, `ticket-police`,
  `gha-pr-cleanup`) to prove the shape carries real automations. This is also the test corpus.
- Deliverable: a CLI that validates a folder of routine files and prints the parsed fleet. No runtime
  yet — but the contract is real and reviewable.

## Phase 1 — Walking skeleton: one trigger, one run, one screen (3–4 weeks)

**Goal:** a routine file actually runs and you can watch it.

- **Routine Registry** syncing one git repo's `routines/*.routine.md`.
- **Scheduler** (cron/at) + **manual dispatch** triggers only.
- **Run Orchestrator** + a single **runner** that clones a repo and executes the prompt via
  `claude -p` with no MCPs yet (native `web-fetch` + read-only git).
- **Minimal UI:** fleet list, routine detail, **Run now**, live run log, run history.
- Deliverable: schedule or click-run a routine; see it execute live. Pillar 1 (file-powered) landed.

## Phase 2 — Triggers breadth + the dispatcher (4–6 weeks) ← the differentiators

**Goal:** the two things first-party routines can't do — broad triggers and collision safety.

- **GitHub App** + Event Gateway + the full GitHub trigger surface ([04](04-triggers.md)/[07](07-github-integration.md)).
- **Trigger Matcher** + canonical Event envelope + `if:` guards + `gate:` hook + debounce/dedupe.
- **The Dispatcher**: concurrency groups, **leases**, **SHA barrier**, **yield-to-human**,
  **iteration budgets**, write-consent ([05](05-concurrency-and-collisions.md)).
- **Idempotent status surfaces** (marker-comment upsert).
- **Subscription Manager + reactive flows** ([11](11-reactive-flows-and-pr-subscriptions.md)):
  auto-subscribe to PRs a routine opens, match `flow.reactions` ("if `ci/*` fails → do Y"), spawn
  PR-scoped reaction runs, and **reconcile** the events webhooks miss (CI-success, conflicts) by
  polling. (The flow-diagram *visualization* lands with the richer UI in Phase 4.)
- Deliverable: stand up the `pr-cleanup` loop with two review voices and prove "two agents never
  touch the same PR" — the Newton guard stack, now declarative — **and** an authoring routine that
  opens a PR, follows it, and auto-fixes its failing CI. Pillars 2 & 3 landed.

## Phase 3 — Connectors & MCP management (3–4 weeks)

**Goal:** "trivial to manage and control MCPs."

- **Connector Registry** + **Secret Broker** (vault-backed, redaction).
- Catalog connectors (Slack, Jira/Atlassian, Sentry, GitHub) with guided OAuth; **BYO-MCP**
  onboarding (URL/image → connection test → tool inventory → grant).
- Per-tool allow/deny + scopes; connector health; **connectors as event sources** (Slack/Sentry
  triggers).
- Deliverable: add an MCP from the UI, grant it to a routine, see it used in a run with secrets
  redacted. The full Newton automation set is now expressible.

## Phase 4 — Team exposure & governance (3–4 weeks)

**Goal:** the "team interface" and the controls that make it trustworthy.

- **Auth/SSO**, teams/members, **RBAC** ([08](08-team-web-ui.md)).
- **Edit-as-commit** (form + raw editor; commit or PR), live lint.
- **Audit log**, **approvals** (`requires_approval`), **kill switches** (per-routine + org-wide),
  cost/health dashboards.
- Deliverable: a team self-serves the whole fleet — see, edit, control, govern — over the same files.

## Phase 5 — Reuse & scale (ongoing)

- `after:` chaining/pipelines; `extends`/`includes`; a **template catalog** (Marketplace energy).
- Multi-repo / org-wide routines; runner autoscaling; stronger isolation (microVMs).
- Reconcilers/pollers backstopping webhook gaps; cost controls; analytics.

---

## Milestone → pillar → original-ask map

| Phase | Lands | Answers |
|---|---|---|
| 0–1 | Pillar 1 (file-powered routines) | "everything powered via the MD file"; "see/run automations" |
| 2 | Pillars 2 & 3 (triggers + dispatcher) + reactive PR flows | "limited trigger controls"; "avoid multiple agents touching the same PR"; "subscribe to hook events on PRs it opens, react (if CI X fails do Y)"; "aspirations from GitHub Actions" |
| 3 | Connectors/MCP | "support connectors… trivial to manage MCPs" |
| 4 | Team UI/governance | "no team exposure"; "user/team interface"; "update/adjust/control" |

---

## Open questions (decisions to make before/early in build)

1. **Runner economics & limits.** Exactly how `claude -p` usage meters under the team's plan at fleet
   scale — validate the "no session-cap" assumption against current billing before committing volume.
2. **Edit-as-commit policy.** Default to committing UI edits straight to a branch, or always via PR?
   (Trades velocity vs. change-control; likely a per-team setting.)
3. **Gate extensibility.** How much guard logic stays declarative (`if:`/`concurrency:`) vs. arbitrary
   `gate:` programs? Newton's gate is ~Python; do we sandbox arbitrary gate scripts, or offer a
   constrained expression+plugin model?
4. **Multi-runner / model routing.** Per-routine model is in the spec; do we also support non-Claude
   runners day one, or keep the runner seam clean and add later?
5. **Temporal vs. Postgres-outbox** for the backbone ([09](09-tooling-stack.md)) — pick by team
   appetite for an external dependency vs. owning retry/timer logic.
6. **Hosting model.** Single multi-tenant SaaS vs. per-tenant deploys (Newton's instinct is
   per-customer isolation; that shapes secrets, webhooks, and the GitHub App story).
7. **Relationship to first-party routines.** Pure replacement, or can Switchboard *also* drive a
   first-party routine as one execution backend? (Lets users start on routines and graduate.)

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Agent does damage with write access** (bad push, wrong comment) | Deny-by-default grants; opt-in write-consent; never-force-push/never-merge as platform rules; dry-run; kill switch; per-target budgets; full audit. |
| **Collision logic is subtly wrong** (the core promise) | Lift Newton's proven guard stack 1:1; transactional leases in Postgres; the SHA barrier as the backstop ("first push invalidates siblings"); heavy tests on the dispatcher with the ported fixtures. |
| **Secret leakage** | References-only in files; vault-backed broker; redaction in every log/summary; access auditing; never persist values in run records. |
| **Prompt-injection via event payloads** (PR/issue/comment text is attacker-controllable) | Treat event content as untrusted; least-privilege tool grants bound blast radius; sensitive actions gated by consent + budgets; egress allowlists. |
| **Webhook gaps** (CI-success/merge transitions not always delivered) | Reconciler/poller backstops the event stream for critical state (Newton's documented gap). |
| **Runaway cost** | Per-routine/day caps, budgets, org rate limits, cost dashboard, kill switch. |
| **Scope creep vs. GHA/n8n** | Stay in the niche: agent-native, repo-native, Markdown-defined routines with a collision dispatcher — the one intersection nobody else occupies ([01](01-research.md) §D). |

## What "done with the design" means

This package answers every line of the original goal ([README](../README.md) map): the canonical
file shape (from Newton's real automations), the broad trigger model (GHA-inspired), the collision
dispatcher (Newton's gate, generalized), connector/MCP management, GitHub integration, and the team
web service. The recommended next concrete step is **Phase 0**: write the JSON-Schema and port a
handful of Newton automations onto it — turning this understanding into the one artifact everything
else is built against.
