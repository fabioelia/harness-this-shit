# 50-iteration improvement log

Each iteration = 4 passes: (1) find friction, (2) research harness features
(observability / efficiency / reproducibility / eliminating humans-in-loop), (3) decide a
NEW direction (not already done / not similar), (4) implement. QA is deferred until
iteration 10 — features land on the **QA backlog** below as we go.

## Off-limits (already built this project — do NOT re-do or do something similar)
Triggers + grouped AND/OR filter builder (labels, check/job field, categories) · reactions
(check-aware) · chains + run lineage · agent teams + delegation (`agent-message --wait`) ·
per-routine memory · custom MCP (registry browse, OAuth via mcp-remote, token auth) ·
connector test/config · model + effort per routine · light mode · one-click sample flows ·
concurrency leases (scope + wait/drop) · SHA barrier · coalesce mode + task inbox · GitHub
webhook setup (cloudflared tunnel + per-repo install) · deterministic script routines
(compile / dynamic windows / revise-on-edit) · run traces + SSE live streaming · pick-or-type
dropdowns · Fleet inbox badge.

## Decided goals (one per iteration — never repeat)
| # | Direction | Theme | Status |
|---|-----------|-------|--------|
| 1 | Insights: cost & usage observability (spend/runs/turns over time, per-routine) | observability/efficiency | ✅ done |
| 2 | Auto-retry on failure (per-routine 0–3, backoff 5/20/60s) | eliminating-humans/resilience | ✅ done |
| 3 | Replay a run with its exact original event payload | reproducibility | ✅ done |
| 4 | Output assertions / eval-gating (harness-checked, gates chain+reactions) | reproducibility/eliminating-humans | ✅ done |
| 5 | Metric history — leading number per successful run, sparkline + delta | observability | ✅ done |
| 6 | Upcoming scheduled-runs timeline (cron projection, next 48h) | observability | ✅ done |
| 7 | Alert on failure → Slack DM/channel (after retries exhausted) | eliminating-humans | ✅ done |
| 8 | Daily spend cap — auto-pause dispatch when today's spend ≥ cap | efficiency/eliminating-humans | ✅ done |
| 9 | Orphaned-run watchdog — reap runs stuck running/waiting > 20m (boot + 5min) | resilience/observability | ✅ done |
| 10 | QA checkpoint — exercise the iter 1–9 backlog, fix bugs | quality | ✅ done — 0 bugs |
| 11 | Runs page search + status filter | observability/UX | ✅ done |
| 12 | Routine export / import (JSON bundle, slug-conflict safe) | reproducibility/portability | ✅ done |
| 13 | Dry-run preview — resolved prompt + tools + would-match, no run ($0) | efficiency/observability | ✅ done |
| 14 | Routine flow map — chain + reaction edges (fleet topology), missing-target flag | observability | ✅ done |
| 15 | Per-routine max-duration timeout override (0=default 240s, cap 1800s) | efficiency/control | ✅ done |
| 16 | Inbound delivery log — recent webhook/API events + which routines matched | observability | ✅ done |
| 17 | Routine snooze — pause triggers+schedule until a time, auto-resume | eliminating-humans/control | ✅ done |
| 18 | Duplicate a routine (server-side clone → edit) | efficiency | ✅ done |
| 19 | Activity page filter + search (state chips + text) | observability/UX | ✅ done |
| 20 | Last-failure banner on failing routines (error + link) | observability | ✅ done |
| 21 | Test-fire a synthetic event (build action/label/branch → dispatch, shows match) | efficiency | ✅ done |
| 22 | Trace filter within a run (search + type chips) | observability/UX | ✅ done |
| 23 | Per-routine environment variables (injected into session + scripts) | efficiency/flexibility | ✅ done |
| 24 | Routine tags + Fleet tag filter + row chips | organization/UX | ✅ done |
| 25 | Per-routine rate limit (max runs/hour, drops excess as skipped) | efficiency/eliminating-humans | ✅ done |
| 26 | Prompt version history + restore (snapshots on edit) | reproducibility | ✅ done |
| 27 | Live concurrency view — held leases + queued inbox tasks (fleet-wide) | observability | ✅ done |
| 28 | Daily digest to Slack (scheduled rollup: runs/spend/failures/busiest) | eliminating-humans | ✅ done |
| 29 | Circuit breaker — auto-disable after N consecutive failures (+ alert) | eliminating-humans/safety | ✅ done |
| 30 | Command palette (⌘K) — fuzzy jump to routines + pages | UX | ✅ done |
| 31 | Diff a run vs the previous run (LCS line diff + cost/turns deltas) | reproducibility | ✅ done |
| 32 | Bulk fleet ops — multi-select enable/disable/snooze/wake/delete | efficiency/UX | ✅ done |
| 33 | Missed-schedule detection — overdue cron fires with no run (26h window) | observability/eliminating-humans | ✅ done |
| 34 | Global run-output search (server-side grep across all run outputs, snippets) | observability | ✅ done |
| 35 | Per-run tool breakdown (calls + errors per tool from run_events) | observability | ✅ done |
| 36 | Export runs as CSV (all or per routine) | reproducibility/portability | ✅ done |
| 37 | Trace step timing bars (per-step duration from t_offset deltas) | observability | ✅ done |
| 38 | Routine notes / runbook (free-text ops context) | reproducibility/ops | ✅ done |
| 39 | Spend-by-model breakdown on Insights (cost/runs per model + share bars) | observability/efficiency | ✅ done |
| 40 | Edit & re-run an event (tweak a past payload, dispatch through matcher) | reproducibility | ✅ done |
| 41 | Connector usage stats (7d runs + cost attributed per connector) | observability | ✅ done |
| 42 | Pin/favorite routines (★ sorts to top of Fleet) | UX | ✅ done |
| 43 | Failing-routines nav badge (count surfaced on Fleet icon everywhere) | observability | ✅ done |
| 44 | Last-success freshness — last ✓ ago + stale (>7d) badge | observability | ✅ done |
| 45 | Keyboard shortcuts help overlay (? toggles) | UX | ✅ done |
| 46 | Single-run JSON bundle export (event+output+trace+metrics) | reproducibility | ✅ done |
| 47 | Dispatch outcome counters (full status mix over window) | observability | ✅ done |
| 48 | Auto-pause on connector down — skip (not fail) when github/slack offline | eliminating-humans/efficiency | ✅ done |
| 49 | Config lint — flags silent misconfig (no cron, dead chain/reaction, uncompiled) | eliminating-humans | ✅ done |
| 50 | Auto-generated ops report (markdown) + final QA sweep | observability/eliminating-humans | ✅ done |
| — | **QA pass** (post-loop-1): found + fixed duplicate /api/leases route crashing Insights | quality | ✅ done |
| 51 | Cost anomaly detection — flag runs costing ≫ the routine's average | observability/efficiency | ✅ done |
| 52 | Projected spend forecast ($/day + $/month at current rate) | efficiency | ✅ done |
| 53 | Failure clustering — group fails by normalized error signature | observability/eliminating-humans | ✅ done |
| 54 | Token usage capture (input/output tokens per run + Insights totals) | observability | ✅ done |
| 55 | Cancel a running run — kill the live session, free lease, no retry | control/eliminating-humans | ✅ done |
| 56 | Webhook delivery idempotency — drop repeated X-GitHub-Delivery within 10m | eliminating-humans/reliability | ✅ done |
| 57 | Run activity heatmap (day-of-week × hour) on Insights | observability | ✅ done |
| 58 | Saved Fleet views — named filter presets (apply/save/delete) | efficiency/UX | ✅ done |
| 59 | "Why it fired" — per-condition trigger/repo/filter match explanation on a run | reproducibility/observability | ✅ done |
| 60 | Loop-2 QA checkpoint — endpoints + all-page render sweep | quality | ✅ done — 0 bugs |
| 61 | Cost attribution by tag (spend/runs per routine tag) | observability/efficiency | ✅ done |
| 62 | Active window — restrict event/schedule triggers to allowed hours+weekdays | efficiency/control | ✅ done |
| 63 | Manual lease release (clear a stuck lease from the concurrency view) | control | ✅ done |
| 64 | Config-change audit log (which fields changed, enable/disable) per routine | reproducibility/observability | ✅ done |
| 65 | Dependency cycle detection (chain/reaction loops) in the linter | eliminating-humans/safety | ✅ done |
| 66 | Long-running run indicator on Fleet (run going >8m → ⏱ badge) | observability | ✅ done |
| 67 | Prompt size estimate in dry-run preview (chars + ~tokens) | efficiency | ✅ done |

## QA backlog — loop 2 (test at iteration 60)
- [x] (iter 54) usage captured from result event; in/out (incl cache) summed; run detail + insights show tokens; null for old runs.
- [x] (iter 55) cancel kills the child session, marks failed + frees lease, labels "canceled by user", and does NOT retry/alert even with retries set.
- [x] (iter 56) a repeated x-github-delivery id within 10m is dropped (logged as dup, no dispatch); distinct ids + missing id pass through.
- [ ] (iter 62) event/schedule run outside window → skipped; manual/replay/rerun bypass; midnight-wrap windows; day filter; blank = always.
- [x] (iter 59) match explain re-evaluates trigger/repo/each filter condition against the run event; ✓/✗ correct; fired flag matches dispatcher.
- [x] (iter 51) /api/anomalies flags runs > 3× routine avg (needs ≥4 samples); ratio + avg correct; Insights card renders/empties.

## QA backlog (test at iteration 10)
- [x] (iter 1) /api/insights aggregates cost/turns/latency/failRate correctly over the day window; per-routine sort; page renders + empty-data state; day toggle (7/14/30) refetches.
- [x] (iter 2) verified (script path: failing script → "retry 1/1" → stops at cap) A failed agent run AND a failed script run each auto-retry up to `retries` with backoff, label "retry N/M", then stop; success on a retry doesn't keep retrying; retries=0 never retries; coalesced/skipped runs don't retry.
- [x] (iter 3) POST /api/runs/:id/replay re-executes with the run's stored event verbatim (a PR-event run replays the same PR payload, not a manual event); replayed run shows "⟲ replay of <id>" + links back; respects kill switch.
- [x] (iter 5) non-numeric output → card hidden verified; numeric trend pending real data /api/routines/:slug/metric parses the leading number from each succeeded run's output; sparkline + delta render; non-numeric outputs → card hidden.
- [x] (iter 6) /api/schedule projects correct next fire times from each cron (weekday ranges, steps); sorted; window cap; Insights card renders.
- [~] (iter 7) deferred — needs a configured Slack target + a real final failure to send alert fires only on FINAL failure (not before retries), resolves owner default, posts via slack-post (@user + #channel), logs send/error; disabled = silent.
- [x] (iter 8) cap blocks dispatchEvent + scheduler + manual dispatch/replay/recompile once today's spend ≥ cap; cap=0 unbounded; insights shows today/cap/over; midnight resets (today window).
- [x] (iter 4) each assertion type (contains/not_contains/matches/max_cost/max_turns/min_length/no_tool_errors) evaluates correctly; a failed assertion gates chain+reactions (downstream doesn't fire) but doesn't change run status; assertions only eval on a successful session; empty assertions = no verdict; run card renders pass/fail.

## Per-iteration notes
### Iteration 1
- **Friction**: Fleet shows one lump "spend $X" but there's no way to see cost/runs/latency
  *over time* or *per routine* — you can't tell which routine is expensive, slow, or
  failing, or whether spend is trending up. No usage/efficiency observability.
- **Research**: LLM-harness observability converges on per-run cost + token + latency
  capture rolled into trend dashboards (LangSmith/Helicone/Langfuse style); "cost per
  outcome" and regressions over time are the signal teams act on. We already capture
  cost_usd / num_turns / dur_ms per run — just not surfaced as trends.
- **Decision**: Build an **Insights** view — daily spend/run/failure series + a per-routine
  cost/latency/turns/fail-rate table. Pure observability, distinct from everything built.
