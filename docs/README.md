# Switchboard design docs — index

The shared understanding behind Switchboard: what we're building, the canonical
shapes, and the tools. Read top-to-bottom for the full story, or jump in via the
table below. See the [root README](../README.md) for the one-paragraph version and
the runnable [`app/`](../app) slice.

| # | Doc | What it covers |
|---|-----|----------------|
| 01 | [Research: the landscape we're building into](01-research.md) | Where Claude routines fall short and what real teams need |
| 02 | [The canonical routine file (`*.routine.md`)](02-routine-spec.md) | The version-controlled Markdown contract: front matter + prompt |
| 03 | [Architecture](03-architecture.md) | Control plane, event bus, dispatcher, runtime |
| 04 | [Triggers](04-triggers.md) | The broad `on:` taxonomy that answers "limited trigger controls" |
| 05 | [Concurrency & collision control](05-concurrency-and-collisions.md) | Leases, concurrency groups, SHA barriers — "two agents never touch the same PR" |
| 06 | [Connectors & MCP management](06-connectors-and-mcp.md) | Central registry for connectors and MCP grants |
| 07 | [GitHub integration](07-github-integration.md) | Forwarding GitHub events and owning PRs |
| 08 | [The team web service & UI](08-team-web-ui.md) | The shared catalog, ownership, audit trail |
| 09 | [Tooling & stack](09-tooling-stack.md) | The tools and stack the reference app is built on |
| 10 | [Roadmap, open questions, risks](10-roadmap.md) | Where this goes next and what's unresolved |
| 11 | [Reactive flows & PR subscriptions](11-reactive-flows-and-pr-subscriptions.md) | "Follow the work you create" |
| 12 | [Field research: developer sentiment](12-developer-sentiment-routines-automations.md) | What developers love & hate about routines/automations |
| 13 | [Incorporating the research: agent-driven plan](13-incorporation-plan.md) | Turning the research into a build plan |
| 14 | [Reactions](14-reactions.md) | "Follow the work you create" (reactions model) |
| 15 | [Learnings from Newton's `automations/`](15-newton-automations-learnings.md) | How Switchboard should evolve from what already works |
| 16 | [50-iteration improvement log](16-iteration-log.md) | The running iteration log |
