# Switchboard — reference implementation

A working slice of the [Switchboard design](../docs) — the **Fleet** console for a team's Claude
Code routines, built on a real component-library design system. This is the app the
`Switchboard Fleet` design maps to.

> The design file was authored in Claude Design (`Switchboard Fleet.dc.html`). It couldn't be
> imported in the headless build environment (the design MCP needs an interactive `/design-login`),
> so the UI here is built faithfully from our own design spec — [`docs/08-team-web-ui.md`](../docs/08-team-web-ui.md)
> §1.1 specifies the Fleet board — and reconciles cleanly when the design is later synced.

## Stack

| Layer | Choice |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Styling / design system | Tailwind CSS + Radix UI primitives (shadcn-style), `class-variance-authority` |
| Fonts (self-hosted) | Space Grotesk (display) · Inter (UI) · JetBrains Mono (data) via `@fontsource` |
| Data | TanStack Query |
| Backend | Express + **`node:sqlite`** (Node's built-in SQLite — zero native deps) |
| Icons | lucide-react |

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

The component library lives in `web/src/components/ui/` (Button, Badge, Card, Switch, Tabs, Tooltip,
DropdownMenu, Avatar, …) layered on Radix primitives, with tokens defined in `web/tailwind.config.js`
(a control-room palette: signal colors kept distinct from the iris brand accent). The signature
element is the **patch-bay status signal** (`web/src/components/status.tsx`) — a live indicator that
encodes a routine's real-time state.

## Layout

```
app/
  server/   Express + node:sqlite API
    src/{index,db,seed}.js
  web/      Vite + React + TS
    src/
      components/{ui/*, status, FlowDiagram, RoutineRow, StatStrip, AppShell, …}
      pages/{FleetPage, RoutineDetailPage, RunsPage, ConnectorsPage, ActivityPage, SettingsPage}
      lib/{api, format, utils}, types.ts
```
