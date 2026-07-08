---
name: PR Attention Digest
summary: Daily merge-readiness digest of open PRs to the team Slack channel.
owner: steven
team: platform
tags: [github, slack, digest]
on:
  - schedule: { cron: "0 13 * * 1-5", tz: UTC, missed: run_once_on_recovery }
  - manual: {}
tools:
  mcp: [github, slack]
  capabilities: [slack-post]
  scopes:
    slack: { channels: ["#pr-digest"] }
runtime:
  model: claude-opus-4-8
  repo: fabioelia/harness-this-shit
  branch: main
  checkout: none
  timeout: 6m
outputs:
  status_surface: { type: slack-message, channel: "#pr-digest" }
policy:
  retry: { max: 1, backoff: exponential }
  notify: { on: [failure], channel: "slack://#harness-alerts" }
secrets:
  - name: SLACK_BOT_TOKEN
    from: env://SLACK_BOT_TOKEN
    description: "Posts the digest; injected as env, redacted in all logs."
---
## Prompt

Post a team-wide PR merge-readiness digest to the #pr-digest Slack channel: every open
non-draft PR in ${{ runtime.repo.0 }} as a row of objective signals (human approval, CI,
mergeability), ranked closest-to-merge first. Don't manufacture a verdict — let the
columns speak. If there are no open PRs, say so in one friendly line.
