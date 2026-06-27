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
| A — Fleet board | `/` | Icon rail, 6-cell stat strip, filter bar, dense routine table |
| D — Routine detail | `/routines/:slug` | Front-matter contract, reactive flow, live lease & budget, owned PRs, recent runs |
| E — Run detail | `/runs/:id` | Execution timeline, dispatcher decision, outputs & effects, lease & barrier |
| F — Connectors | `/connectors` | MCP registry table (health, auth, scopes, used-by) |
| + Runs · Audit · Config | `/runs` `/activity` `/settings` | Run log, live activity feed, team roles + org policy |

## Run it

```bash
cd app
npm run install:all     # installs server + web deps
npm run dev             # api on :4317, web on :5317 (Vite proxies /api → :4317)
```

Then open **http://localhost:5317**. The SQLite DB (`server/switchboard.db`) is created and seeded
on first boot from the Newton repo's real automations; delete it to reseed.

Run the two processes separately if you prefer:

```bash
npm --prefix server run start     # API  → http://localhost:4317
npm --prefix web run dev          # web  → http://localhost:5317
```

## What's implemented

- **Fleet board** — every routine as a live row: status signal, team, write/lease/watching
  indicators, trigger chips, last run, 7-day success meter, next run, enable toggle, run-now.
  Fleet stat strip (running / needs-human / runs today / avg success / active leases / spend).
- **Routine detail** — the **flow diagram** (triggers → run → follows-PR → reactive branches), the
  **concurrency & collisions** guard stack, **owned PRs** with live budget bars, grants, recent
  runs, and the generated **`.routine.md`** (source of truth).
- **Runs** — fleet-wide execution log with the dispatcher's decision (lease-held, budget-exhausted…).
- **Connectors** — MCP / native connectors with status, auth, emitted events, BYO-MCP.
- **Activity** — the audit trail. **Settings** — team roles + org policy guardrails.
- **Live controls** — enable/disable, run-now, and the org-wide **kill switch** all mutate the DB.

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
    src/{index,db,seed}.js
  web/      Vite + React + TS
    src/
      components/{sb (design-system primitives), AppShell, ui/*}
      pages/{FleetPage, RoutineDetailPage, RunsPage, RunDetailPage, ConnectorsPage, ActivityPage, SettingsPage}
      lib/{api, utils}, types.ts
```
