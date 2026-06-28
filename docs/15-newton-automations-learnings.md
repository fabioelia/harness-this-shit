# Learnings from Newton's `automations/` (and how Switchboard should evolve)

Newton-Research-Inc/newton `automations/` is a mature, production version of exactly what
Switchboard is building: one markdown file per automation (front matter + `## Prompt`),
run on two substrates (Cursor Cloud cron/event automations + GitHub Actions `gha-*`).
23 live automations. This is the most relevant prior art we have — below is what
validates our design, what we're missing, and concrete adoptions.

## What validates Switchboard's design

- **One file per automation = our `.routine.md`.** Front matter (name, summary, owner,
  model, trigger, tools, repo, branch, memory) + a `## Prompt` body. Same shape we built.
- **Triggers**: cron, git-push (branch), git-label, slack-message, check-run-completed.
  We have most of these.
- **Memory** per automation, owner per automation, model per automation.
- **Reactions / follow-ups**: they pair a main automation with a "FOLLOW UP" that runs
  every 30 min to chase state. Our event-driven reactions + watches do this better than
  polling — but the *concept* is identical and heavily used, so it's clearly core.

## What we should adopt (gaps), highest-leverage first

### 1. Deterministic scripts do the facts; the agent only orchestrates
The strongest pattern across their best automations (PR Digest, GHA reviewer/scorecard).
The data-gathering and rendering are **versioned, unit-tested scripts**
(`collect_pr_attention_data.sh`, `render_pr_digest.py`, `post_pr_review.py`); the prompt
says *"do NOT run your own gh queries or hand-format tables — collect → render → post."*
The agent reasons over **pre-fetched files** (`.cursor-review/pr.diff`, metadata, threads)
with *"no git, no gh"* in-session. Wins: far less hallucination/flakiness, fewer tool
calls, and a much smaller prompt-injection surface (the agent reads files, doesn't roam).
→ Switchboard should let a routine ship helper scripts and pre-fetch context, so the
session orchestrates deterministic steps instead of improvising `gh` every run.

### 2. Review quality — ours (pr-review) is naive next to theirs
- **Ensemble, independent passes**: inline reviewer + scorecard + GPT reviewer, each a
  separate pass with *no memory of the others*, each emitting a **check-run**; a digest
  folds them. Independence beats one-voice review.
- **Verify-before-flag**: *"search the codebase to confirm every finding; silence beats
  false positives; a `red`/`error` without file:line evidence is downgraded."* Kills the
  plausible-but-wrong findings our single-pass reviewer will produce.
- **Calibrated severity rubric** (versioned `guides/pr-review.md`): a real
  correctness/security/race bug is `error` (blocks the verdict); mis-tagging it `warning`
  lets the PR go "falsely green." Severity is tied to a gate.
- **Idempotent, stateful thread triage**: re-verify open threads each run, never re-raise
  a dismissed finding, read the **current** file (never the stale comment snapshot),
  never auto-dismiss a human-authored thread. Lets a reviewer run repeatedly without spam.
- **Structured JSON output** (`review.json`/`scorecard.json`) consumed by a deterministic
  poster (inline comments, with off-diff-line 422 handling). Not freeform prose.

### 3. Human-in-the-loop via a PR-comment checkbox menu (ticket-police)
The cleanest approval-gate pattern I've seen and exactly the "dual-channel plan/act"
defense the 2026 security research calls for — implemented with GitHub's native UI:
the routine posts options as a **task-list checkbox menu** in one idempotent
`<!-- ticket-police -->` PR comment; the author ticks a box; the routine resumes on the
comment `edited` event and acts on the ticked box. The comment is both the choice and the
continuation signal. Slack is only a nudge with a link. One routine owns the whole flow
(label fires it; a cron branch does the reminder sweep) — it branches on trigger type and
bails out early when the check is moot (merged/closed/draft/already done).
→ Switchboard should support: a routine that posts an interactive PR comment and a
reaction on `comment edited` to continue — turning "reactions" into real human gates.

### 4. Memory as a resolved-ID cache (solves our `@fabio` problem)
Triage automations cache `accountId`, active `sprintId`, Slack `channel ids`, and a
**git-email → Slack-handle map** in memory ("Learnings"), resolved once and reused. They
also note Slack mentions must be `<@USER_ID>` (the bare `@handle` doesn't notify) — the
exact issue we just hit. → Cache the `@fabio → U06G2FP0NLF` (and email→id) map in routine
memory instead of resolving every run.

### 5. Finer-grained capability grants (least privilege)
They split tools far more than our coarse `github`/`slack`: `slack-read`, `slack-post`,
`open-pr`, `pr-comment` are distinct grants, plus `memory_expects` (declare a secret
*expectation* in front matter — never the secret — and read it from memory at runtime).
→ Split our `github` into `pr-read`/`pr-comment`/`open-pr` and `slack` into
`slack-read`/`slack-post`; add a `memory_expects` block.

### 6. Output discipline (cheap, high-impact prompt hygiene)
- **Objective signals, never a manufactured verdict** (the digest is facts; the reader
  concludes). Avoids the agent inventing confidence.
- **Fail loud, never guess/fallback** (script failed → post one message with the error and
  stop). 
- **Persona + values** ("terse, respectful of developer focus; do not over-post; do not
  assign blame; route information"). Our prompts are mechanical by comparison.

## New automations worth seeding (their catalog)

PR Digest (daily merge-readiness board), Ticket Police (label → file/link Jira + checkbox
menu + reminder), Sentry Top-10 (Sentry MCP → file Jira + slack), Vulnerability Pass
(daily → one PR resolving vuln tickets, semantic title with all keys), Daily Triage
(Jira board → route defects to recent code authors via git blame → Slack thread),
Freeze Analysis / Release Preview-and-Risk (push to main/stage → risk report).

## Smaller notes

- **Thin-pointer prompts**: cloud/GHA prompt is just `Read automations/<slug>.md and follow
  it exactly` — the real prompt is version-controlled and reviewed. Our `.routine.md` is
  already the source of truth; worth keeping that property if we ever add a console.
- **Multi-provider by automation**: they pick `opus`, `gpt-5.5-medium`, `composer-2.5`,
  `claude-opus-4-8-thinking-high` per job. We're Claude-only — fine, but model-per-routine
  (which we have) is the right unit.
- **"Don't bulk-load this folder"**: operational prompts are parked outside every
  auto-load path; agents read only the one file they're working on.
