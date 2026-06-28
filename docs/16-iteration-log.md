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

## QA backlog (test at iteration 10)
- [ ] (iter 1) /api/insights aggregates cost/turns/latency/failRate correctly over the day window; per-routine sort; page renders + empty-data state; day toggle (7/14/30) refetches.
- [ ] (iter 2) A failed agent run AND a failed script run each auto-retry up to `retries` with backoff, label "retry N/M", then stop; success on a retry doesn't keep retrying; retries=0 never retries; coalesced/skipped runs don't retry.
- [ ] (iter 3) POST /api/runs/:id/replay re-executes with the run's stored event verbatim (a PR-event run replays the same PR payload, not a manual event); replayed run shows "⟲ replay of <id>" + links back; respects kill switch.
- [ ] (iter 5) /api/routines/:slug/metric parses the leading number from each succeeded run's output; sparkline + delta render; non-numeric outputs → card hidden.
- [ ] (iter 6) /api/schedule projects correct next fire times from each cron (weekday ranges, steps); sorted; window cap; Insights card renders.
- [ ] (iter 7) alert fires only on FINAL failure (not before retries), resolves owner default, posts via slack-post (@user + #channel), logs send/error; disabled = silent.
- [ ] (iter 8) cap blocks dispatchEvent + scheduler + manual dispatch/replay/recompile once today's spend ≥ cap; cap=0 unbounded; insights shows today/cap/over; midnight resets (today window).
- [ ] (iter 4) each assertion type (contains/not_contains/matches/max_cost/max_turns/min_length/no_tool_errors) evaluates correctly; a failed assertion gates chain+reactions (downstream doesn't fire) but doesn't change run status; assertions only eval on a successful session; empty assertions = no verdict; run card renders pass/fail.

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
