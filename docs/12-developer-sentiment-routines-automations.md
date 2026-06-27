# 12 — Field research: what developers love & hate about routines/automations

A second research pass (June 2026) on real developer sentiment toward **Claude Code Routines**,
**Cursor background agents/automations**, and the broader "schedule/trigger an AI agent" space — to
pressure-test the Switchboard design against what people actually complain about and praise.

> TL;DR: people love **natural-language-over-node-wiring** and **set-and-forget cloud execution**.
> They hate **usage caps**, **coarse triggers**, **no access to their real local environment**,
> **flaky/silent unreliability**, and **no observability or determinism**. Switchboard's bets line up
> with the pain — with two gaps worth closing (deeper traces; eval/CI gating).

---

## What they LIKE

1. **Natural language beats node-wiring.** The most-repeated praise: replacing "drag these 18 nodes
   together" (n8n/Zapier/Make) with "write what you want in English." Devs call the shift "not a
   small upgrade." [(MindStudio)](https://www.mindstudio.ai/blog/claude-code-routines-vs-n8n) [(Mejba)](https://www.mejba.me/blog/claude-routines-automation-platform)
2. **Set-and-forget cloud execution.** Runs server-side on Anthropic infra — "close the lid, board a
   flight," it keeps running. The native, zero-setup scheduling drew an audible "finally."
   [(OpenHelm)](https://www.openhelm.ai/blog/claude-code-routines-daily-limit) [(claudefa.st)](https://claudefa.st/blog/guide/development/routines-guide)
3. **Agentic depth, not just deterministic flows.** People value that the agent *reasons* over
   high-context tasks — "compounding engineering," autonomous CI/CD chores — rather than only firing
   fixed steps. [(aitooldiscovery)](https://www.aitooldiscovery.com/guides/claude-code-reddit)
4. **The autonomy sweet spot.** Claude Code positioned as "mid-market autonomy — not as hand-holding
   as Cursor, not as expensive as Devin, more depth than Copilot." [(aitooldiscovery)](https://www.aitooldiscovery.com/guides/claude-code-reddit)
5. **Parallelism / offload (Cursor background agents).** Kicking long tasks to async background agents
   so the human isn't blocked. [(Gallardo, Medium)](https://medium.com/@lgallard/exploring-cursor-background-agents-a-hands-on-experience-15555d206a18)

## What they HATE / struggle with

1. **Usage & daily caps — the #1 complaint.** Claude routines cap at **5 / 15 / 25 runs per day**
   (Pro/Max/Team). "A routine set to fire every four hours uses six of your five daily runs before the
   day is out." Multi-project devs exhaust quota instantly; **failed runs still count**, and
   **over-cap scheduled runs are silently skipped** → data gaps. Cursor agent mode "burns through
   premium requests," limits "tighten quarterly." Claude Code's Aug-2025 weekly caps had $200/mo users
   hitting the wall mid-week. [(OpenHelm)](https://www.openhelm.ai/blog/claude-code-routines-daily-limit) [(aitooldiscovery)](https://www.aitooldiscovery.com/guides/claude-code-reddit) [(vibecoding)](https://vibecoding.app/blog/cursor-problems-2026)
2. **Coarse, limited triggers.** Schedule (≥ **1-hour** minimum), API, and *coarse* GitHub events
   only — no sub-hour cadence, no rich event surface, no reacting to arbitrary CI events.
   [(Claude docs)](https://code.claude.com/docs/en/routines)
3. **No access to the real (local) environment.** Cloud routines "can't read `.env` files, connect to
   a local database, or interact with services running on your machine." This kills a huge class of
   *actual* dev automation. [(OpenHelm)](https://www.openhelm.ai/blog/claude-code-routines-daily-limit)
4. **Flaky / silent unreliability.** Cursor **silently reverting code** (Agent-Review / Cloud-Sync /
   Format-on-Save conflicts); **background agents failing to start or breaking org-wide**; builds
   failing on env setup. Erodes trust fast. [(vibecoding)](https://vibecoding.app/blog/cursor-problems-2026) [(forum)](https://forum.cursor.com/t/background-agents-fail-to-start/108599)
5. **Rules ignored; no determinism.** "Cursor is a predictive engine, not a policy enforcer" — rules
   get applied inconsistently or not at all, even in governed repos. The explicit wish: rules driven
   by **vanilla, non-AI programs**, applied **predictably**, with **logs showing if/how** they fired.
   [(knostic)](https://www.knostic.ai/blog/cursor-does-not-follow-rules) [(HN)](https://news.ycombinator.com/item?id=43678329)
6. **Observability gap.** Most agent failures **don't raise errors** — a 200 returns even when the
   result is wrong (wrong tool, wrong params). Devs struggle to "review long agent conversations to
   localize errors" and lack interactive debugging; the ask is traces + evals + CI gating.
   [(Sentry)](https://blog.sentry.io/ai-agent-observability-developers-guide-to-agent-monitoring/) [(Braintrust)](https://www.braintrust.dev/articles/best-ai-agent-debugging-tools-2026)
7. **Trust & safety scares.** Cursor RCE via malicious MCP file swaps post-approval; the "support bot
   went rogue" incident framed as "exactly the worst-case scenario" slowing agentic adoption.
   [(TheHackerNews)](https://thehackernews.com/2025/08/cursor-ai-code-editor-vulnerability.html) [(Fortune)](https://fortune.com/article/customer-support-ai-cursor-went-rogue/)
8. **Immature SDK / config split.** Cursor SDK: tool-call schemas "not stable," no team admin API
   keys — "promising but still-moving." Routines split config between a console and the repo (per
   [doc 01](01-research.md)). [(TheNewStack)](https://thenewstack.io/cursor-sdk-ai-agents/)

---

## How this maps to Switchboard (validation + gaps)

| Pain | Switchboard's stance |
|---|---|
| Daily caps (5/15/25), failed runs count, silent skips | Executes via headless `claude -p` / sessions, **not bound by routine daily caps**; org-governed **budgets**, not per-user walls. Skips are **observable** (run state + reason), never silent. ([05](05-concurrency-and-collisions.md)) |
| Coarse triggers (≥1h, coarse GH) | **Flexible event surface** — full GitHub/CI events (push, pull_request, check_run, check_suite, workflow_run, status, deployment_status…), sub-hour, webhooks, `after`-chaining. Already built in `app/`. ([04](04-triggers.md)) |
| **No local/real-env access** | Biggest differentiator: routines run **on your machine with your real tools** — gh authed, Slack token, local `.env`, local services. The exact thing cloud routines can't do. (`app/` runner) |
| Flaky/silent reverts, org-wide breakage | Deterministic **control plane**: the agent reasons, the harness routes + guards (leases, SHA barrier, concurrency) — "two agents never touch the same PR." ([05](05-concurrency-and-collisions.md)) |
| Rules ignored; want determinism + logs | The dispatcher/leases/budgets/`gate:` are **vanilla non-AI programs** with **observable decisions** — exactly the "predictability baked in, logs of if/how" the HN crowd asked for. |
| Observability gap | Every run is captured (output, timeline, status, the event payload) + an **audit/activity** feed. ([08](08-team-web-ui.md)) |
| Trust & safety | **Deny-by-default tool grants**, write-consent, org-policy guardrails, **kill switch**, validate. ([08](08-team-web-ui.md)) |
| Per-user, no team exposure | The whole premise — a **shared fleet UI** with roles. ([08](08-team-web-ui.md)) |
| Love: natural language | Preserved — routines are **natural instructions**; the autonomous session does the work with its granted tools (no rigid output contract). |

### Two gaps worth closing next
1. **Deeper run traces.** Today a run captures the session's final output + a coarse timeline. The
   field wants step-level traces (tool calls, params, decisions) to localize *silent* wrong-answer
   failures — the #1 observability complaint. Add a structured event stream per run (the runner
   already can via `--output-format stream-json`).
2. **Eval / CI gating of routines.** "Every resolved failure becomes a test." A routine should be
   able to carry assertions and gate itself — turning flaky agents into regression-protected ones.

### The one tension to own
The market is split between **deterministic** automation (n8n/Zapier — predictable, dumb) and
**agentic** automation (routines/Cursor — smart, flaky). Switchboard's bet is the **seam**: a
deterministic harness (events, routing, leases, guards, audit) wrapping an agentic executor (the
session does the reasoning + actions). That's precisely the "predictability baked in" devs ask for,
without giving up the natural-language depth they love.

---

### Sources
Claude routines daily-limit pain — [OpenHelm](https://www.openhelm.ai/blog/claude-code-routines-daily-limit) ·
Claude Code Reddit sentiment — [aitooldiscovery](https://www.aitooldiscovery.com/guides/claude-code-reddit) ·
Cursor problems 2026 — [vibecoding](https://vibecoding.app/blog/cursor-problems-2026) ·
Background agents fail to start — [Cursor forum](https://forum.cursor.com/t/background-agents-fail-to-start/108599) ·
Cursor SDK limitations — [The New Stack](https://thenewstack.io/cursor-sdk-ai-agents/) ·
Rules ignored — [knostic](https://www.knostic.ai/blog/cursor-does-not-follow-rules) · [HN](https://news.ycombinator.com/item?id=43678329) ·
Agent observability — [Sentry](https://blog.sentry.io/ai-agent-observability-developers-guide-to-agent-monitoring/) · [Braintrust](https://www.braintrust.dev/articles/best-ai-agent-debugging-tools-2026) ·
Safety — [TheHackerNews](https://thehackernews.com/2025/08/cursor-ai-code-editor-vulnerability.html) · [Fortune](https://fortune.com/article/customer-support-ai-cursor-went-rogue/) ·
Routines vs n8n / praise — [MindStudio](https://www.mindstudio.ai/blog/claude-code-routines-vs-n8n) · [Mejba](https://www.mejba.me/blog/claude-routines-automation-platform) · [Claude docs](https://code.claude.com/docs/en/routines)
