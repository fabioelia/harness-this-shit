---
name: Jira Intake from Slack
summary: Turn a #bugs Slack message into a triaged Jira ticket.
owner: fabio
team: support
on:
  - slack: { event: message, channel: C0BUGS }
  - webhook: { id: bug-intake, secret: env://BUG_INTAKE_SECRET }
  - api: {}
tools:
  mcp: [atlassian, slack]
  capabilities: [slack-post]
runtime:
  timeout: 5m
policy:
  requires_approval: true
  approvers: [fabio, steven]
  max_runs_per_day: 25
---
## Prompt

A bug report just arrived (Slack message or webhook payload — see the trigger). Extract
what/where/severity, search Jira for duplicates, and either link the duplicate back to
the reporter or file a new ticket in project NP with a crisp title, repro steps, and the
reporter tagged. Reply in the originating channel with the ticket link.
