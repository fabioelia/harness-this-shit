# harness — the headless control plane

Point it at **a folder of Markdown files**. Each `*.md` with YAML front matter is a routine
(the full [docs/02 spec](../docs/02-routine-spec.md)); the front matter drives the wiring —
cron schedules, GitHub webhooks, connector events, hand-off chains, PR flow subscriptions —
and the body is the prompt a headless Claude session (`claude -p`) runs. Everything the
harness does lands in **one append-only NDJSON file: `.harness`**, in that same folder. No
database, no UI required: status, budgets, approvals, and open PR subscriptions are all
*derived* by replaying the log, so a restart loses nothing.

```
harness up ./routines        # read the folder, wire everything, stay resident
tail -f routines/.harness    # …or: harness logs ./routines -f
```

## The folder is the config

```
routines/
  pr-attention-digest.md     # a routine: front matter (triggers/grants/policy) + prompt
  ticket-police.md           # another one
  connectors.yaml            # optional: MCP/connector registry (Slack, Jira, Sentry, BYO…)
  harness.yaml               # optional: daemon config (port, tick, trace level)
  state/<slug>/memory.md     # created per routine when `state.enabled` — persistent memory
  .harness                   # THE output: append-only log of every wire/run/decision
```

Files without front matter are skipped (your README is safe). `includes:` fragments and
`extends:` templates can live in subdirectories — only top-level `.md` files are routines.

## CLI

| Command | What |
|---|---|
| `harness up [dir] [--port N]` | Load + validate + wire every trigger; resident daemon (internal cron, webhook listener, flow reconciler). |
| `harness validate [dir]` | Parse, schema-check against the full docs/02 contract, lint (unknown keys, unregistered connectors, orphan `after:` targets, lease collisions). |
| `harness list [dir]` | The fleet at a glance. |
| `harness run <slug> [dir] [-i k=v]` | Dispatch one routine now, with typed `inputs:` validation. Routes through the daemon when it's up (one lease authority), runs one-shot otherwise. |
| `harness status [dir]` | Wiring, last runs, pending approvals, needs-human budgets, open PR subscriptions, spend — replayed from `.harness`. |
| `harness logs [dir] [-f] [--run id]` | Pretty-print / follow the log. |
| `harness approve\|deny <run> [dir]` | Resolve a `policy.requires_approval` gate. |
| `harness budget-reset <key> [dir]` | Clear a needs-human iteration budget. |
| `harness connectors [dir]` | Registry + auth health (which env vars are missing, who uses what). |
| `harness stop [dir]` | Graceful shutdown (kills in-flight sessions, logs `harness.down`). |
| `harness init [dir]` | Scaffold a starter routine + `connectors.yaml`. |

## What the front matter drives (full docs/02 spec)

- **`on:` triggers** — `schedule` (5-field cron with `tz`, `every` + `jitter`, one-shot `at`,
  `missed: run_once_on_recovery`), `github` (full webhook surface with
  `actions/branches/paths/paths_ignore/name/status/conclusion/draft` filters), connector
  events (`slack:`, `sentry:`, …), generic signed `webhook:`, `manual:`, `api:`, and
  `after:` hand-off chaining. Every trigger takes guards: `if:` (sandboxed expression,
  fails closed), `gate:` (external program, exit 0 admits), `debounce:`, `dedupe_key:`.
- **`inputs:`** — typed parameters (`int`/`bool`/`string`/`choice`) for manual/API runs.
- **`tools:`** — the grant model: `mcp:` (from the connector registry → per-run
  `--mcp-config`), `capabilities:` (closed vocabulary → `--allowed-tools` patterns),
  `scopes:` (narrowing, injected as hard prompt constraints), `deny:` (→
  `--disallowed-tools` + hard constraints; `merge-pr` is default-denied). Ungranted tools
  don't exist in the session.
- **`runtime:`** — model, effort, repo checkout (`shallow`/`full`/`none`, isolated per-run
  workspace, `worktree` keeps it), `timeout`. `container`/`network` are parsed + linted but
  not enforced locally (declared for review).
- **`concurrency:`** — the guard stack: GHA-style `group` (serialize or
  `cancel_in_progress`), claim-before-act `lease` (`skip|queue|steal-if-expired|coalesce`),
  SHA `barrier` (stale work self-drops), `yield_to_human`, per-target iteration `budget`
  that terminates in an observable `needs-human` state.
- **`secrets:`** — references only (`env://`, `file://`, `vault://` with env/`harness.yaml`
  mapping); injected as env, **redacted from every `.harness` line**.
- **`state:`** — persistent per-routine memory dir the session reads/updates.
- **`outputs:`** — idempotent status surface (`pr-comment` by marker, `slack-message`
  upsert, `check-run`), `emit_check_run`, `summary: structured` result contract.
- **`policy:`** — `requires_approval` + approvers (runs park until `harness approve`),
  `max_runs_per_day`, `retry` with backoff, failure notifications to Slack.
- **`includes:` / `extends:`** — shared body fragments and front-matter template inheritance.
- **`flow:`** — after a run opens/touches a PR, subscribe to it until merged/closed and
  react: `when: {check_run: {name: "ci/*", conclusion: failure}} → do: fix-ci` runs the
  routine's `## handler: fix-ci` body section (or `routine:<slug>`, or `done`), each with
  its own budget — the whole guard stack applies to reaction runs too.

## Events in

The daemon listens on one port (default `7717`):

- `POST /webhooks/github` — point a GitHub App/repo webhook here
  (`HARNESS_GITHUB_WEBHOOK_SECRET` enables signature verification).
- `POST /webhooks/connector/<id>` — connector events; Slack Events API URL-verification is
  handled, the Slack envelope unwrapped.
- `POST /webhooks/<id>` — generic per-routine webhooks (`on: [{webhook: {id, secret}}]`),
  verified by HMAC, bearer, or `?token=`.
- `POST /api/routines/<slug>/dispatch` — the `api:` trigger (bearer `HARNESS_API_TOKEN`).

## Connectors (Slack / Jira / bring-your-own)

Builtins: `github` (gh CLI), `slack` (native `slack-post` / `slack-read` tools +
Web API, needs `SLACK_BOT_TOKEN`), `web`, `atlassian` / `jira` (Atlassian remote MCP via
`mcp-remote`). Register more in `connectors.yaml` — any MCP server definition
(stdio command or remote URL) becomes grantable as `tools.mcp: [id]` and can declare the
event types it emits for triggers. `harness connectors` shows auth health and usage.

## Try it

```bash
cd harness && npm install
node bin/harness.js validate examples/routines
node bin/harness.js up examples/routines            # wires 4 example routines
node bin/harness.js run pr-attention-digest examples/routines
```

Tests: `npm test` (27 tests; runs against a fake `claude` binary via `CLAUDE_BIN`).

## Relationship to the app/ UI

This package is the extraction of the harness out of the Switchboard reference app
(`app/server`), inverted to match the design docs: **the MD file is the source of truth**
(the app kept routines in SQLite and generated the MD). The Fleet UI remains a separate,
untouched layer; the intended phase 2 is for `app/server` to consume this package and
render `.harness` + the routines folder instead of owning its own engine.
