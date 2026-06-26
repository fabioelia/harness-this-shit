# 09 — Tooling & stack: the tools we'd want

The user asked to "figure out the tools we'd want." This is a concrete recommendation, with the
build-vs-buy reasoning. The bias: **buy/borrow the hard infra (durable execution, secrets,
isolation, auth), build the differentiators (routine spec, dispatcher, UI).**

---

## 1. The execution engine — Claude Code, headless

- **Runner:** [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk) or headless `claude -p`.
  Model-agnostic via the routine's `runtime.model`. Post-June-2026 these don't draw down
  subscription session caps ([01](01-research.md)), so the harness isn't throttled by routine limits.
- **MCP:** the official **Model Context Protocol SDK** to launch/connect granted MCP servers in the
  runner and filter their tool surface to the grant. Newton's `apps/mcps/` (FastMCP) shows the
  server side; we're the client/orchestrator side.
- **Why not roll our own agent loop:** Claude Code already does tool use, subagent fan-out, file
  editing, and is what the user trusts for routines. Wrapping it keeps us in the control-plane
  business, not the inference business.

## 2. Runner isolation — ephemeral sandboxes

- **Per-run container** destroyed after: **Kubernetes Jobs** or **AWS Fargate** for a managed start;
  **Firecracker microVMs** (or gVisor) when stronger isolation is warranted (untrusted prompts +
  network + write access to repos is real attack surface).
- Toolchain baked into runner images (uv, node20, `gh`, ripgrep…), one image per `runtime.container`
  profile. Newton's Cloud-Agent deltas (sudo Docker, node20, corepack, fuse-overlayfs) are a useful
  reference for what a real runner image must carry.
- **Network egress allowlist** per run (the routine's `runtime.network.egress`).

## 3. Control-plane backbone — durable execution + queue

The Run Orchestrator and Event Bus must survive restarts and never lose/duplicate a run. Two viable
paths:

| Option | Use it if |
|---|---|
| **Temporal** (or Restate / Inngest) | You want durable workflows, retries, timers, and signals out of the box. The Run lifecycle ([03](03-architecture.md) §4), the scheduler's durable timers, and `after:` signals map cleanly onto Temporal primitives. **Recommended** — it removes a whole class of "did this run twice?" bugs. |
| **Postgres outbox + a queue** (SQS / NATS / Redis Streams) + app-level state machine | You want fewer moving parts and are comfortable owning retry/timeout logic. Lighter to start; more to maintain as concurrency grows. |

**Leases/budgets live in Postgres regardless** (advisory locks / `SELECT … FOR UPDATE` / `INSERT …
ON CONFLICT`), because the dispatcher's "exactly one wins" needs a transactional store, not a cache
([05](05-concurrency-and-collisions.md) §5). Redis is fine as a cache/rate-limiter, **not** as the
lease source of truth.

## 4. Datastore

- **PostgreSQL** — registry index, runs, audit, leases, budgets, concurrency groups. The one
  must-have; everything transactional lives here.
- **Object storage (S3/MinIO)** — run logs, artifacts, large diffs. (Newton already runs MinIO
  locally — same shape.)
- **Redis** — caches, rate limiting, ephemeral pub/sub for live log streaming to the UI.

## 5. Secrets — buy, don't build

- **AWS Secrets Manager** or **HashiCorp Vault** as the backing store; the Secret Broker
  ([06](06-connectors-and-mcp.md)) resolves references and injects + redacts. Newton's prod uses AWS
  Secrets Manager (with `floci` emulating it locally) — adopting the same removes a security-critical
  build.

## 6. GitHub integration

- A **GitHub App** + a webhook receiver. Library support: Octokit (TS) / PyGithub or `gh` for the
  Python side, plus a JWT→installation-token minter for per-run scoped tokens. Newton already drives
  GitHub via `gh` and the GitHub MCP — both are reusable patterns.

## 7. Web app

- **Frontend:** React + TypeScript (Vite or Next.js). Newton is React 19 / Vite / TS — **matching it
  maximizes team familiarity and component reuse.**
- **API:** REST + webhooks; GraphQL optional for the dashboard's read models. Live run logs over
  WebSocket/SSE.
- **Markdown/front-matter editor:** CodeMirror/Monaco for the body; a schema-driven form (e.g.
  JSON-Schema → form) for the front matter so the editor and the validator share one contract.

## 8. Auth & RBAC

- **Auth0** (Newton's choice) or Clerk/WorkOS for SSO/OIDC + org/team mapping. Don't build identity.
- RBAC ([08](08-team-web-ui.md)) enforced in the API; roles derived from IdP groups + the routine's
  `owner`/`team` fields.

## 9. The contract artifacts (what we *do* build first)

These are the crown jewels and should be hand-built and owned:

1. **The `*.routine.md` JSON-Schema** — pins the front-matter contract shared by validator, UI form,
   and runtime. (Phase 0; see [10](10-roadmap.md).)
2. **The Dispatcher** — concurrency groups, leases, SHA barrier, budgets, gates
   ([05](05-concurrency-and-collisions.md)). The defensible core.
3. **The Trigger Matcher + Event envelope** — the uniform `${{ event.* }}` model ([04](04-triggers.md)).
4. **The connector registry + grant enforcement** ([06](06-connectors-and-mcp.md)).
5. **The team UI** ([08](08-team-web-ui.md)).

## 10. Observability

- **OpenTelemetry** traces across gateway→matcher→dispatcher→runner; metrics to Prometheus/Grafana or
  Datadog. The fleet/cost dashboards ([03](03-architecture.md) §6) read from these + the run store.

## 11. Two coherent stack choices

| | **Stack A — "Newton-native" (recommended)** | **Stack B — "TS-everywhere"** |
|---|---|---|
| Backend | Python + Django/DRF, RQ or Temporal-py | Node + TypeScript, Temporal-ts / Inngest |
| Frontend | React 19 + Vite + TS | Next.js + TS |
| DB / store | Postgres + Redis + MinIO/S3 | same |
| Secrets | AWS Secrets Manager (+ floci local) | same |
| Auth | Auth0 | Auth0 / Clerk |
| Runner | `claude -p` in K8s/Fargate sandboxes | same |
| Why | Mirrors Newton → reuse, familiarity, the team already operates this exact stack | One language end-to-end; tighter MCP-SDK/runner story in TS |

**Recommendation:** **Stack A.** It matches the environment the routines already live in, lets us
lift Newton's patterns (worktrees, `gh`, Secrets-Manager, Auth0, MinIO) directly, and keeps the
team on tools they operate daily. Pair it with **Temporal** for the durable backbone unless we
deliberately choose the lighter Postgres-outbox path for the MVP.
