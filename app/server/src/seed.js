// Seed data ported 1:1 from Switchboard Fleet.dc.html (support.js base()/renderVals()).
const OWNERS = {
  fabio: { color: '#d98a5c', initials: 'FE' },
  steven: { color: '#c9a24a', initials: 'ST' },
  maya: { color: '#6fae9a', initials: 'MA' },
  leo: { color: '#7f9bd1', initials: 'LE' },
  dan: { color: '#c98fb0', initials: 'DA' },
  priya: { color: '#b59ad6', initials: 'PR' },
};
const AVG = {
  'pr-attention-digest': '48s', 'ticket-police': '1m 12s', 'pr-cleanup': '3m 05s',
  'sentry-triage': '1m 40s', 'flaky-test-hunter': '2m 30s', 'dependency-bumper': '2m 50s',
  'stale-pr-sweeper': '22s', 'release-notes-drafter': '1m 20s', 'changelog-police': '38s',
  'incident-commander': '—', 'design-review-router': '35s', 'standup-digest': '1m 05s',
};

const ROUTINES = [
  { slug: 'pr-attention-digest', name: 'PR Attention Digest', summary: 'Daily merge-readiness digest of every open PR, posted to #pr-digest.', owner: 'steven', team: 'platform', triggers: ['schedule'], connectors: ['slack'], state: 'idle', lastAgo: '2h ago', lastStatus: 'success', next: 'in 9h', success: 100, spend: '$1.20', enabled: 1, metaShort: 'next in 9h', leaseRef: '' },
  { slug: 'ticket-police', name: 'Ticket Police', summary: 'Find or file a Jira ticket for a PR whose title lacks an NP-#### key.', owner: 'fabio', team: 'platform', triggers: ['label', 'comment', 'schedule'], connectors: ['jira', 'slack', 'github'], state: 'running', lastAgo: 'now', lastStatus: 'running', next: 'on event', success: 94, spend: '$6.40', enabled: 1, metaShort: 'running · newton#4830', leaseRef: '' },
  { slug: 'pr-cleanup', name: 'PR Cleanup (auto loop)', summary: 'Address failing AI-review findings + required-CI failures on opted-in PRs.', owner: 'steven', team: 'platform', triggers: ['check_run'], connectors: ['github'], state: 'lease', lastAgo: '6m ago', lastStatus: 'running', next: 'on event', success: 88, spend: '$14.80', enabled: 1, metaShort: 'lease pr:#4821 · 2/3', leaseRef: 'pr:newton#4821' },
  { slug: 'sentry-triage', name: 'Sentry Triage', summary: 'Triage new error-level Sentry issues, open a ticket and page the on-call.', owner: 'maya', team: 'infra', triggers: ['sentry'], connectors: ['sentry', 'slack', 'jira'], state: 'needs_human', lastAgo: '11m ago', lastStatus: 'needs_human', next: 'on event', success: 76, spend: '$4.10', enabled: 1, metaShort: 'budget exhausted', leaseRef: '' },
  { slug: 'flaky-test-hunter', name: 'Flaky Test Hunter', summary: 'Detect newly-flaky tests from completed CI check-runs and quarantine them.', owner: 'leo', team: 'infra', triggers: ['check_run'], connectors: ['github', 'slack'], state: 'running', lastAgo: 'now', lastStatus: 'running', next: 'on event', success: 82, spend: '$7.90', enabled: 1, metaShort: 'running · review/unit', leaseRef: '' },
  { slug: 'dependency-bumper', name: 'Dependency Bumper', summary: 'Weekly grouped dependency bumps with changelog links in a single PR.', owner: 'dan', team: 'platform', triggers: ['schedule'], connectors: ['github'], state: 'queued', lastAgo: '3h ago', lastStatus: 'success', next: 'in 2d', success: 91, spend: '$3.30', enabled: 1, metaShort: 'queued behind lease', leaseRef: '' },
  { slug: 'stale-pr-sweeper', name: 'Stale PR Sweeper', summary: 'Nudge or close pull requests with no activity for fourteen days.', owner: 'dan', team: 'platform', triggers: ['schedule'], connectors: ['github', 'slack'], state: 'idle', lastAgo: '3h ago', lastStatus: 'success', next: 'in 21h', success: 97, spend: '$0.90', enabled: 1, metaShort: 'next in 21h', leaseRef: '' },
  { slug: 'release-notes-drafter', name: 'Release Notes Drafter', summary: 'Draft release notes from merged PRs on every tagged release.', owner: 'priya', team: 'web', triggers: ['release'], connectors: ['github', 'notion'], state: 'idle', lastAgo: '1d ago', lastStatus: 'success', next: 'on event', success: 100, spend: '$2.10', enabled: 1, metaShort: 'on release tag', leaseRef: '' },
  { slug: 'changelog-police', name: 'Changelog Police', summary: 'Require a changelog entry on every PR to main; comment when missing.', owner: 'leo', team: 'web', triggers: ['push'], connectors: ['github'], state: 'failing', lastAgo: '8m ago', lastStatus: 'failing', next: 'on event', success: 61, spend: '$5.50', enabled: 1, metaShort: 'ungranted pr-comment', leaseRef: '' },
  { slug: 'incident-commander', name: 'Incident Commander', summary: 'Spin up an incident channel and timeline when PagerDuty pages.', owner: 'maya', team: 'infra', triggers: ['webhook'], connectors: ['pagerduty', 'slack'], state: 'disabled', lastAgo: '—', lastStatus: 'disabled', next: '—', success: null, spend: '$0.00', enabled: 0, metaShort: 'disabled', leaseRef: '' },
  { slug: 'design-review-router', name: 'Design Review Router', summary: 'Route needs-design PRs to the right reviewer in the #design channel.', owner: 'priya', team: 'web', triggers: ['label'], connectors: ['slack', 'figma'], state: 'idle', lastAgo: '40m ago', lastStatus: 'success', next: 'on event', success: 96, spend: '$1.70', enabled: 1, metaShort: 'on label add', leaseRef: '' },
  { slug: 'standup-digest', name: 'Daily Standup Digest', summary: 'Summarize yesterday’s merged work into a morning standup post.', owner: 'priya', team: 'web', triggers: ['schedule'], connectors: ['slack', 'github'], state: 'idle', lastAgo: '5h ago', lastStatus: 'success', next: 'in 14h', success: 99, spend: '$1.10', enabled: 1, metaShort: 'next in 14h', leaseRef: '' },
];

const CONNECTORS = [
  { code: 'GH', name: 'GitHub', kind: 'App', health: 'ok', auth: 'App install · Newton-Research-Inc', scopes: 'contents:write, pull_requests:write, checks:read', routines: 9, av: '#7f9bd1' },
  { code: 'SL', name: 'Slack', kind: 'MCP', health: 'ok', auth: 'OAuth · Newton workspace', scopes: 'chat:write, reactions:write, channels:read', routines: 5, av: '#c9a24a' },
  { code: 'JR', name: 'Atlassian / Jira', kind: 'MCP', health: 'ok', auth: 'OAuth · newton.atlassian.net', scopes: 'issues:write, issues:read', routines: 2, av: '#6fae9a' },
  { code: 'SE', name: 'Sentry', kind: 'MCP', health: 'degraded', auth: 'OAuth · newton org · token expiring', scopes: 'issue:read, event:read', routines: 1, av: '#b59ad6' },
  { code: 'NO', name: 'Notion', kind: 'MCP', health: 'ok', auth: 'OAuth · Release space', scopes: 'pages:write', routines: 1, av: '#cdc7ba' },
  { code: 'FG', name: 'Figma', kind: 'MCP', health: 'ok', auth: 'Token · design org', scopes: 'files:read', routines: 1, av: '#d98a5c' },
  { code: 'PD', name: 'PagerDuty', kind: 'Webhook', health: 'off', auth: 'Not connected · install required', scopes: '—', routines: 1, av: '#5d594f' },
];

const ACTIVITY = [
  ['14:32:07', 'ticket-police upserted PR comment · newton#4830', 'success'],
  ['14:31:50', 'flaky-test-hunter started · check_run review/unit', 'running'],
  ['14:30:12', 'sentry-triage → NEEDS_HUMAN · budget exhausted', 'needs_human'],
  ['14:29:40', 'pr-cleanup acquired lease · pr:newton#4821', 'lease'],
  ['14:28:55', 'standup-digest posted digest · #standup', 'success'],
  ['14:27:31', 'changelog-police failed · ungranted pr-comment', 'failing'],
  ['14:25:09', 'dispatcher skipped pr-cleanup · stale-sha', 'queued'],
  ['14:23:48', 'stale-pr-sweeper nudged 3 stale PRs', 'success'],
  ['14:21:16', 'design-review-router routed · newton#4827', 'success'],
];

const RUNS = [
  { id: 'run_8f3a2', slug: 'pr-cleanup', status: 'running', ago: 'now', dur: '1m 42s', trigger: 'check_run review/unit' },
  { id: 'run_8f1c0', slug: 'pr-cleanup', status: 'success', ago: '24m ago', dur: '2m 18s', trigger: 'check_run review/lint' },
  { id: 'run_8e9b4', slug: 'pr-cleanup', status: 'success', ago: '1h ago', dur: '3m 05s', trigger: 'check_run review/unit' },
  { id: 'run_8e22a', slug: 'pr-cleanup', status: 'needs_human', ago: '3h ago', dur: '4m 30s', trigger: 'budget exhausted' },
  { id: 'run_8df11', slug: 'pr-cleanup', status: 'success', ago: '5h ago', dur: '1m 50s', trigger: 'check_run review/type' },
  { id: 'run_8d8c2', slug: 'pr-cleanup', status: 'failing', ago: '8h ago', dur: '0m 38s', trigger: 'check_run review/unit' },
  { id: 'run_7c5e1', slug: 'ticket-police', status: 'running', ago: 'now', dur: '1m 02s', trigger: 'label jira-ticket' },
  { id: 'run_7b2a0', slug: 'flaky-test-hunter', status: 'running', ago: 'now', dur: '0m 41s', trigger: 'check_run review/unit' },
  { id: 'run_6a991', slug: 'sentry-triage', status: 'needs_human', ago: '11m ago', dur: '1m 40s', trigger: 'sentry issue' },
  { id: 'run_690f3', slug: 'changelog-police', status: 'failing', ago: '8m ago', dur: '0m 38s', trigger: 'push main' },
  { id: 'run_5d7c8', slug: 'standup-digest', status: 'success', ago: '5h ago', dur: '1m 05s', trigger: 'schedule cron' },
  { id: 'run_5c2b1', slug: 'design-review-router', status: 'success', ago: '40m ago', dur: '0m 35s', trigger: 'label needs-design' },
];

export function seed(db) {
  const insR = db.prepare(`INSERT INTO routines
    (slug,name,summary,owner,team,triggers,connectors,state,last_ago,last_status,next,success,spend,enabled,meta_short,lease_ref,avg,av_color,initials,ord)
    VALUES (@slug,@name,@summary,@owner,@team,@triggers,@connectors,@state,@lastAgo,@lastStatus,@next,@success,@spend,@enabled,@metaShort,@leaseRef,@avg,@avColor,@initials,@ord)`);
  ROUTINES.forEach((r, i) =>
    insR.run({
      ...r, triggers: JSON.stringify(r.triggers), connectors: JSON.stringify(r.connectors),
      avg: AVG[r.slug], avColor: OWNERS[r.owner].color, initials: OWNERS[r.owner].initials, ord: i,
    })
  );
  const insC = db.prepare('INSERT INTO connectors (code,name,kind,health,auth,scopes,routines,av_color,ord) VALUES (?,?,?,?,?,?,?,?,?)');
  CONNECTORS.forEach((c, i) => insC.run(c.code, c.name, c.kind, c.health, c.auth, c.scopes, c.routines, c.av, i));
  const insA = db.prepare('INSERT INTO activity (time,text,state,ord) VALUES (?,?,?,?)');
  ACTIVITY.forEach((a, i) => insA.run(a[0], a[1], a[2], i));
  const insRun = db.prepare('INSERT INTO runs (id,routine_slug,status,ago,dur,trigger,ord) VALUES (?,?,?,?,?,?,?)');
  RUNS.forEach((r, i) => insRun.run(r.id, r.slug, r.status, r.ago, r.dur, r.trigger, i));
  db.prepare('INSERT INTO meta (key,value) VALUES (?,?)').run('kill_switch', 'false');
  db.prepare('INSERT INTO meta (key,value) VALUES (?,?)').run('wordmark', 'Switchboard');
}

export { OWNERS };
