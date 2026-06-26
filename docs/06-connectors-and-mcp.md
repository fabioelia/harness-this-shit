# 06 — Connectors & MCP management

The ask: *"support the connectors support and make it trivial to manage and control other MCPs."*
Newton already has the bones of this — its `memory` app models `DataConnector` / `DataResource` /
`DataSource` (UI label: "Connector"), it runs its own MCP servers in `apps/mcps/`, and its
automations declare `tools.mcp_servers` + `capabilities` grants. Switchboard turns those bones into a
managed, self-serve product: **a connector is a checkbox on a routine, not a console expedition.**

---

## 1. What a "connector" is

A **connector** is a named, org-registered capability a routine can be *granted*. Two kinds:

1. **MCP connectors** — a Model Context Protocol server (Slack, Atlassian/Jira, Sentry, GitHub,
   Linear, Notion, a customer's internal API…). Granting it makes that server's tools available to
   the agent during a run. These are the "other MCPs" the user wants to manage.
2. **Native capabilities** — first-class harness abilities the runner enforces directly without an
   MCP: `slack-post`, `open-pr`, `pr-comment`, `push-commits`, `web-fetch`, etc. (Newton's
   `capabilities:` list.) These are a closed, audited vocabulary.

Both are referenced from the routine's `tools:` block ([02](02-routine-spec.md) §2.4) and are
**deny-by-default**: the agent sees exactly what's granted, nothing else.

---

## 2. The connector registry (org-level)

A single place where the team manages every connector once, and routines reference them by id:

```
Connector
  id: slack                      # referenced as tools.mcp: [slack]
  kind: mcp | native
  transport: stdio | http | sse  # how the MCP server is launched/reached
  source: builtin | url | image  # builtin catalog · remote MCP URL · container image to run
  auth: { type: oauth2 | api_key | app_token | none, ... }
  events: [message, mention, reaction]   # event types it can publish (feed triggers — see 04)
  health: { status, last_checked }
  default_scopes: { channels: [...], repos: [...] }
  owner_team, visibility
```

The registry is itself declarable-as-data (a `connectors/*.yaml` checked into a config repo) **and**
editable in the UI — same "file is truth, UI is a structured editor" principle as routines, so
connector config is reviewable and versioned too.

### Built-in catalog + bring-your-own

- **Catalog connectors**: a curated set (Slack, GitHub, Jira/Atlassian, Sentry, Linear, Notion, …)
  with pre-wired OAuth and known tool surfaces — one-click "Connect."
- **Bring-your-own MCP**: paste a remote MCP server URL or point at a container image (Newton runs
  its own in `apps/mcps/`). The harness launches/reaches it in the runner sandbox, introspects its
  tool list, and lets you grant it. This is the "trivial to manage *other* MCPs" path.

---

## 3. "Trivial to manage and control MCPs" — the concrete UX

From the connectors page, a team can:

- **Add an MCP** in three forms: pick from catalog · paste a remote URL · supply a container image +
  launch command. The harness validates by **starting it in a throwaway sandbox and listing its
  tools** (a connection test), showing the discovered tool inventory.
- **Authenticate** via a guided OAuth flow (catalog) or by storing an API key/token into the secret
  store (BYO). Tokens live in the vault, never in the registry row.
- **Scope** it: default channels/repos/projects, and a per-tool **allow/deny** (e.g. expose Slack
  `chat.postMessage` but not `admin.*`). Newton already scopes by `slack_channels`; we generalize to
  per-tool gating.
- **Control** it: enable/disable globally (kill a misbehaving MCP across every routine at once),
  see **health** (last successful call, error rate), **rotate** credentials, and read an **audit**
  of which routines used it and what tools they called.
- **Grant** it to routines: the routine's `tools.mcp: [...]` is the grant; the UI shows, per
  connector, the list of routines that hold it (and warns if a routine requests a connector that
  isn't connected/authorized yet — a static check, no run required).

### MCP hygiene we inherit from Newton

Newton's repo encodes hard-won MCP conventions worth baking into the platform:

- **Canonical tool naming** (a prek hook enforces it) — the registry can lint BYO MCP tool names.
- **Annotations / gating / output schemas / envelope policy / redaction** — Newton's `mcp-auditor`
  agent checks exactly these. The harness should surface the same checks when onboarding an MCP
  (an automated "connector scorecard").
- **OAuth redirects are per-host** (Newton is single-tenant per customer) — our connector OAuth
  must be tenant-aware for the same reason.

---

## 4. How grants reach the running agent

At run start the runner:

1. Reads the routine's `tools` block (resolved + validated against the registry).
2. For each granted **MCP connector**: starts/connects the server in the sandbox, injects its
   credentials from the **Secret Broker**, and registers it so Claude Code's tool surface includes
   exactly those tools — filtered by the per-connector allow/deny and `scopes`.
3. For each granted **native capability**: flips the corresponding runner permission (e.g.
   `push-commits` → git push to the head ref is allowed; `merge-pr` stays denied) and exposes the
   matching tool.
4. Everything else is unavailable. The agent literally cannot call a tool it wasn't granted —
   least privilege is structural, not prompt-enforced.

This is the security boundary: grants are enforced by *what tools exist in the run*, not by asking
the model nicely.

---

## 5. Secrets (the Secret Broker)

Newton's rule — *secrets are never in the file* — is the law. The mechanism:

- A routine **declares** a secret as a reference (`from: vault://team/slack/bot-token`) and what it's
  for; it never contains a value ([02](02-routine-spec.md) §2.7).
- The **Secret Broker** resolves references at run start, injects values as env vars into the
  sandbox process, and registers them with the log pipeline for **redaction** (any occurrence in
  stdout/logs/summaries is masked).
- Backing store is a real vault (AWS Secrets Manager / HashiCorp Vault). Newton's local dev even
  emulates Secrets Manager (the `floci` service) precisely because connectors/MCP secrets must live
  in a manager, not the DB — we adopt the same posture (vault in prod, emulator in dev).
- **Rotation** updates the vault; references don't change; the next run picks up the new value.
- Secret access is **audited** (which run read which reference, when).

OAuth tokens obtained by the connector flow are stored the same way — the registry holds a reference,
the vault holds the token, runs get short-lived injected copies.

---

## 6. Connectors as event sources (closing the loop with triggers)

A connector doesn't only provide *tools*; it can also publish *events* that feed triggers
([04](04-triggers.md) §1.3). The registry's `events: [...]` declares what a connector can emit; a
routine's `on:` references them:

```yaml
# connector registry
id: sentry
events: [issue, issue_resolved]

# routine
on:
  - sentry: { event: issue, level: error }
```

This is how the harness grows trigger coverage *by adding connectors* rather than by shipping new
core code — the open-ended extensibility that keeps "limited trigger controls" from ever recurring.

---

## 7. Why this is materially better than first-party routines' "connectors"

First-party routines let you attach connectors, but: there's no team registry, no central
auth/rotation/health, no per-tool gating, no BYO-MCP onboarding flow, no connector-as-event-source,
and no audit of which routine called which tool. Switchboard makes connectors a **governed, shared,
self-serve fleet asset** — which is exactly what "team exposure" means for integrations.
