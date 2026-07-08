# Switchboard — reference implementation

A working slice of the [Switchboard design](../docs) — the **Fleet** console for a team's Claude
Code routines, built on a real component-library design system. This is the app the
`Switchboard Fleet` design maps to.

> The design was authored in Claude Design as `Switchboard Fleet.dc.html` and delivered as a
> handoff bundle. This UI is a faithful, pixel-close recreation of that file — exact tokens (warm
> brown-black surfaces `#100e0a`/`#16130f`/`#1a1712`, blue accent `#5b9ee6`), Hanken Grotesk +
> JetBrains Mono, the 64px icon rail, the dense Fleet table, and the component primitives
> (badge/toggle/dot/spark/success-bar) ported 1:1 from the design's runtime.

## Stack

| Layer | Choice |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Styling / design system | Tailwind CSS + Radix UI primitives, tokens from the `.dc.html` |
| Fonts (self-hosted) | Hanken Grotesk (UI/display) · JetBrains Mono (data) via `@fontsource` |
| Data | TanStack Query |
| Backend | Express + **`node:sqlite`** (Node's built-in SQLite — zero native deps) |
| Icons | inline SVG (matched to the design) |

## Frames implemented (from `Switchboard Fleet.dc.html`)

| Frame | Route | What |
|---|---|---|
| A — Fleet board | `/` | Icon rail, stat strip, filter bar, dense routine table |
| D — Routine detail | `/routines/:slug` | Front-matter contract, reactive flow, live lease, recent runs |
| E — Run detail | `/runs/:id` | Execution timeline, dispatcher decision, outputs, lineage |
| F — Connectors | `/connectors` | MCP registry table (health, auth, scopes, used-by) |
| + Runs · Activity · Settings | `/runs` `/activity` `/settings` | Run log, live activity feed, identities + org policy |

## Run it

```bash
cd app
npm run install:all     # installs server + web deps
npm run dev             # api on :4317, web on :5317 (Vite proxies /api → :4317)
```

Then open **http://localhost:5317**. The SQLite DB (`server/switchboard.db`) is created and seeded
on first boot with runnable example routines; delete it to reseed.

Run the two processes separately if you prefer:

```bash
npm --prefix server run start     # API  → http://localhost:4317
npm --prefix web run dev          # web  → http://localhost:5317
```

## What's implemented

The three Switchboard pillars, and deliberately little else:

- **Routines as Markdown** — every routine is a front-matter contract (triggers, tool grants,
  runtime, concurrency) + a prompt body. The generated **`.routine.md`** is viewable per routine;
  create/edit covers triggers (schedule cron, GitHub events, manual), event filters, connectors,
  model/effort, repo targeting, chains, reactions, memory, retries, and concurrency policy.
- **Triggers & runs** — a real cron scheduler, a GitHub webhook receiver (HMAC-verified) plus a
  generic `/api/events/:type` ingress, manual dispatch, and a full run model: live step-level
  trace (SSE), cost/turns/tokens, the dispatcher's match explanation, lineage (what triggered
  this run, what it triggered), cancel + replay.
- **A dispatcher that prevents collisions** — per-entity leases (PR / repo / routine scope) with
  wait / drop / **coalesce** conflict policies, a task inbox that hands overlapping events to the
  agent already holding the lease, a SHA barrier so stale work stands down, and a watchdog that
  reaps stuck runs.
- **Reactive flows** — `chain:` (run B after A succeeds) and `react:` (watch the PR that A touched
  and fire B when its checks finish / review lands / it merges, or after a timeout).
- **Connectors** — live gh + Slack status, custom MCP servers (paste a config, a remote URL, or
  search the MCP registry), per-server auth tokens and OAuth via `mcp-remote`, connectivity tests.
- **Fleet controls** — enable/disable, run-now, and the org-wide **kill switch** all mutate the DB.
  **Settings** — identities + org policy guardrails injected into every session prompt.

## Design system

Tokens live in `web/tailwind.config.js`, lifted verbatim from the `.dc.html` (warm brown-black
surfaces, blue `#5b9ee6` accent, the signal palette: success/running/needs-human/failing/lease/
disabled). The reusable primitives are in `web/src/components/sb.tsx` — `Dot`, `Pill`/`StatePill`,
`Spark` (14-bar history), `Sbar` (success meter), `Avatar`, `Toggle`, `Chip` — each a 1:1 port of
the design's `support.js` render helpers, so the app and the mock share one component vocabulary.

## Layout

```
app/
  server/   Express + node:sqlite API
    src/{index,db,seed,samples,runner,integrations}.js
    tools/{slack-post,inbox}   scripts granted to sessions by name
  web/      Vite + React + TS
    src/
      components/{sb (design-system primitives), AppShell, ui/*}
      pages/{FleetPage, NewRoutinePage, RoutineDetailPage, RunsPage, RunDetailPage, ConnectorsPage, ActivityPage, SettingsPage}
      lib/{api, format, utils}, types.ts
```
