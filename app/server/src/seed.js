// Seed the Switchboard store with a realistic fleet derived from the Newton repo's
// automations/ folder (the canonical routines our design package is built on).
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

export function seed(db) {
  const now = Date.now();
  const id = (p, n) => `${p}_${n}`;

  const teams = [
    { id: 'platform', name: 'Platform', slug: 'platform', accent: '#8B7CFF' },
    { id: 'qa', name: 'QA & Automation', slug: 'qa', accent: '#2DD4BF' },
    { id: 'solutions', name: 'Solutions', slug: 'solutions', accent: '#F5B544' },
  ];
  const users = [
    { handle: 'sdbnewton', name: 'Steven Bennett', email: 'steven@newtonresearch.ai', accent: '#5B9DFF' },
    { handle: 'fabioelia', name: 'Fabio Elia', email: 'fabio@f1v.co', accent: '#8B7CFF' },
    { handle: 'danf-newton', name: 'Dan Finkel', email: 'dan@newtonresearch.ai', accent: '#3DD68C' },
    { handle: 'LeonardoCordoba', name: 'Leonardo Cordoba', email: 'leo@newtonresearch.ai', accent: '#F5B544' },
    { handle: 'clarkenheim', name: 'Charlie Clark', email: 'charlie@newtonresearch.ai', accent: '#FF8FA3' },
  ];

  const tx = db.prepare.bind(db);
  const insTeam = tx('INSERT INTO teams (id,name,slug,accent) VALUES (?,?,?,?)');
  teams.forEach(t => insTeam.run(t.id, t.name, t.slug, t.accent));
  const insUser = tx('INSERT INTO users (handle,name,email,accent) VALUES (?,?,?,?)');
  users.forEach(u => insUser.run(u.handle, u.name, u.email, u.accent));

  // ── Routines (ported from Newton automations) ───────────────────────────────
  const R = [
    {
      slug: 'pr-attention-digest', name: 'PR Attention Digest', team: 'platform', owner: 'sdbnewton',
      summary: 'Daily merge-readiness digest of every open PR, ranked closest-to-merge first, posted to #pr-digest.',
      tags: ['github', 'slack', 'digest'], model: 'claude-opus-4-8', state: 'idle', risk: 'read',
      enabled: 1, success: 0.99, runs7d: 7, avg: 142, spend: 0.41, next: now + 9 * HOUR,
      triggers: [{ type: 'schedule', label: 'cron 0 13 * * *', detail: 'daily 13:00 UTC' }],
      grants: [['mcp', 'slack'], ['capability', 'slack-post']],
      reactions: [],
      prompt: 'Post a team-wide PR merge-readiness digest to #pr-digest: every open non-draft PR as a row of objective signals (human approval, CI, scorecard, per-voice bot verdicts), ranked closest-to-merge first. Don’t manufacture a verdict — let the columns speak.',
    },
    {
      slug: 'ticket-police', name: 'Ticket Police', team: 'platform', owner: 'fabioelia',
      summary: 'Find or file a Jira ticket for a PR whose title lacks an NP-#### key — a checkbox menu on the PR, a Slack nudge, then link/create/skip.',
      tags: ['github', 'jira', 'hygiene'], model: 'claude-opus-4-8', state: 'idle', risk: 'write',
      enabled: 1, success: 0.94, runs7d: 23, avg: 88, spend: 1.12, next: now + 2 * HOUR,
      triggers: [
        { type: 'github', label: 'label: jira-ticket', detail: 'on added' },
        { type: 'github', label: 'issue_comment', detail: 'on edited — resume on checkbox tick' },
        { type: 'schedule', label: 'cron 0 */4 * * *', detail: 'REMIND sweep' },
      ],
      grants: [['mcp', 'atlassian'], ['mcp', 'slack'], ['mcp', 'github'], ['capability', 'pr-comment'], ['capability', 'open-pr'], ['capability', 'slack-post']],
      reactions: [],
      prompt: 'A PR has the jira-ticket label because its title has no NP-#### key. Drive the whole exchange through ONE PR comment rendered as a checkbox menu: post options, the author ticks one box, act on the ticked box. Slack is only a nudge that links to the comment.',
    },
    {
      slug: 'pr-cleanup-loop', name: 'PR Cleanup (auto loop)', team: 'platform', owner: 'sdbnewton',
      summary: 'Address failing AI-review findings + required-CI failures on opted-in PRs, minimally — the auto-cleanup loop, gated by the SHA barrier + per-PR budget.',
      tags: ['github', 'ci', 'loop'], model: 'claude-opus-4-8', state: 'running', risk: 'write',
      enabled: 1, success: 0.91, runs7d: 31, avg: 312, spend: 4.83, next: null,
      triggers: [{ type: 'github', label: 'check_run: review/*', detail: 'completed — gated by auto_cleanup_gate' }],
      grants: [['capability', 'push-commits']],
      reactions: [],
      prompt: 'You are running on a PR’s already-checked-out head branch. The gate has verified opt-in (auto-cleanup label), the verdict is failing, and budget remains. Make the minimal code changes that address the failing AI review findings and any failing required CI checks. Only edit files — the workflow owns git.',
    },
    {
      slug: 'gha-pr-reviewer', name: 'PR Reviewer (Claude voice)', team: 'platform', owner: 'sdbnewton',
      summary: 'Inline PR review pass — verified, actionable findings + thread triage; emits the review/claude check run that joins the cleanup barrier.',
      tags: ['github', 'review'], model: 'claude-opus-4-8-thinking-high', state: 'running', risk: 'read',
      enabled: 1, success: 0.97, runs7d: 44, avg: 205, spend: 6.10, next: null,
      triggers: [{ type: 'github', label: 'label: cursor-review', detail: 'on added — review-on-request' }],
      grants: [['capability', 'pr-comment'], ['capability', 'check-run-write']],
      reactions: [],
      prompt: 'Read the pre-fetched PR context, produce verified actionable findings + thread triage, and write review.json for posting. Surface findings the second (GPT) voice misses.',
    },
    {
      slug: 'daily-triage-pipeline', name: 'Daily Triage Pipeline', team: 'qa', owner: 'fabioelia',
      summary: 'Daily sweep of the Jira triage board: fast-tracks Sentry/Dependabot, routes real defects to recent code authors via a #dev-qa-automation thread.',
      tags: ['jira', 'slack', 'triage'], model: 'composer-2.5', state: 'idle', risk: 'read',
      enabled: 1, success: 0.96, runs7d: 7, avg: 268, spend: 0.78, next: now + 13 * HOUR,
      triggers: [{ type: 'schedule', label: 'cron 0 17 * * *', detail: 'daily 17:00 UTC' }],
      grants: [['mcp', 'atlassian'], ['mcp', 'slack'], ['capability', 'slack-read'], ['capability', 'slack-post']],
      reactions: [],
      prompt: 'Sweep the Jira triage board. Fast-track Sentry/Dependabot tickets to Leo; for real defects find recent code authors and open a routing thread in #dev-qa-automation. Hand thread-watching to the follow-up routine.',
    },
    {
      slug: 'daily-triage-followup', name: 'Daily Triage · Follow-up', team: 'qa', owner: 'fabioelia',
      summary: 'Follow-up officer for Daily Triage threads: reads replies/reactions, reflects ownership/status into Jira, stays near-silent on Slack. Never closes a ticket.',
      tags: ['jira', 'slack', 'triage'], model: 'composer-2.5', state: 'idle', risk: 'write',
      enabled: 1, success: 0.93, runs7d: 96, avg: 41, spend: 1.44, next: now + 22 * MIN,
      triggers: [
        { type: 'schedule', label: 'cron */30 9-17 * * *', detail: 'every 30m, business hours' },
        { type: 'after', label: 'after: daily-triage-pipeline', detail: 'on success' },
      ],
      grants: [['mcp', 'atlassian'], ['mcp', 'slack'], ['capability', 'slack-read']],
      reactions: [],
      prompt: 'Watch the Slack threads Triage opened in #dev-qa-automation and apply ownership/status updates back to Jira. Default to zero Slack output when nothing material changed. Backlog is the furthest transition allowed — never close a ticket.',
    },
    {
      slug: 'playwright-creator', name: 'Playwright Creator', team: 'qa', owner: 'fabioelia',
      summary: 'Weekday audit of the app vs QA’s regression sheet; writes new Playwright tests for 3–4 coverage gaps, gets them green, opens a PR, then follows it to merge.',
      tags: ['playwright', 'tests', 'github'], model: 'claude-opus-4-7-thinking-high', state: 'idle', risk: 'write',
      enabled: 1, success: 0.82, runs7d: 5, avg: 1180, spend: 3.22, next: now + 19 * HOUR,
      triggers: [{ type: 'schedule', label: 'cron 0 3 * * 1-5', detail: 'weekdays 03:00 UTC' }],
      grants: [['mcp', 'slack'], ['capability', 'slack-post'], ['capability', 'open-pr']],
      reactions: [
        { when: 'check_run ci/* → failure', do: 'fix-ci', budget: '3' },
        { when: 'pull_request_review → changes_requested', do: 'routine:pr-cleanup-loop', budget: null },
        { when: 'pull_request → merged', do: 'done', budget: null },
      ],
      prompt: 'Audit the app against QA’s regression-test sheet; identify 3–4 coverage gaps, write new Playwright tests, get them green, and open a PR. Then follow that PR per the reactive flow until it merges.',
    },
    {
      slug: 'playwright-testing', name: 'Playwright Testing', team: 'qa', owner: 'fabioelia',
      summary: 'Daily: reads the latest develop Playwright run, fixes failures that look like code drift (not real regressions), opens a PR documenting fixes + open questions.',
      tags: ['playwright', 'tests'], model: 'gpt-5.3-codex-xhigh', state: 'idle', risk: 'write',
      enabled: 1, success: 0.79, runs7d: 7, avg: 940, spend: 2.05, next: now + 16 * HOUR,
      triggers: [{ type: 'schedule', label: 'cron 0 6 * * *', detail: 'daily 06:00 UTC' }],
      grants: [['mcp', 'slack'], ['capability', 'slack-post'], ['capability', 'open-pr']],
      reactions: [
        { when: 'check_run ci/* → failure', do: 'fix-ci', budget: '2' },
        { when: 'pull_request → merged', do: 'done', budget: null },
      ],
      prompt: 'Read the latest develop Playwright run, fix failures that look like code drift (not real regressions), and open a PR documenting fixes + open questions.',
    },
    {
      slug: 'sentry-top-10-high', name: 'Sentry Top 10 High', team: 'platform', owner: 'fabioelia',
      summary: 'Daily triage of the top high-severity Sentry issues into Jira, opening fix PRs for clear-cut regressions.',
      tags: ['sentry', 'jira', 'github'], model: 'claude-opus-4-8', state: 'needs_human', risk: 'write',
      enabled: 1, success: 0.74, runs7d: 7, avg: 520, spend: 2.90, next: now + 11 * HOUR,
      triggers: [
        { type: 'schedule', label: 'cron 0 15 * * *', detail: 'daily 15:00 UTC' },
        { type: 'sentry', label: 'sentry: issue', detail: 'level error' },
      ],
      grants: [['mcp', 'sentry'], ['mcp', 'atlassian'], ['mcp', 'slack'], ['capability', 'open-pr'], ['capability', 'slack-post']],
      reactions: [
        { when: 'check_run ci/* → failure', do: 'fix-ci', budget: '3' },
        { when: 'pull_request → merged', do: 'done', budget: null },
      ],
      prompt: 'Pull the top 10 high-severity Sentry issues, triage into Jira, and open fix PRs for clear-cut regressions. Follow each PR you open until it merges.',
    },
    {
      slug: 'file-user-requests-to-jira', name: 'File User Requests → Jira', team: 'solutions', owner: 'danf-newton',
      summary: 'Triggered by messages in #user-requests: reads the thread + screenshots, classifies bug/feature/misunderstanding, replies in-thread, files a backlog ticket.',
      tags: ['slack', 'jira', 'support'], model: 'gpt-5.4-high', state: 'idle', risk: 'write',
      enabled: 1, success: 0.9, runs7d: 12, avg: 160, spend: 0.95, next: null,
      triggers: [{ type: 'slack', label: 'slack: #user-requests', detail: 'on message' }],
      grants: [['mcp', 'atlassian'], ['mcp', 'slack'], ['capability', 'slack-read'], ['capability', 'slack-post']],
      reactions: [],
      prompt: 'Read the full thread + screenshots, investigate the codebase, classify bug / feature / misunderstanding, reply in-thread, and file a backlog Jira ticket.',
    },
    {
      slug: 'freeze-analysis', name: 'Freeze Analysis', team: 'platform', owner: 'sdbnewton',
      summary: 'On a stage→main release merge, analyzes everything merged during the freeze, flags scope creep, and publishes a freeze report to Confluence.',
      tags: ['release', 'jira'], model: 'claude-opus-4-8', state: 'idle', risk: 'read',
      enabled: 1, success: 1.0, runs7d: 2, avg: 410, spend: 0.33, next: null,
      triggers: [{ type: 'github', label: 'push: main', detail: 'stage→main release merge' }],
      grants: [['mcp', 'atlassian']],
      reactions: [],
      prompt: 'Analyze everything merged into stage during the freeze, classify scope creep (esp. “New Feature Fix”), and publish a freeze report to Confluence.',
    },
    {
      slug: 'vulnerability-pass', name: 'Vulnerability Pass', team: 'platform', owner: 'fabioelia',
      summary: 'Daily dependency-vulnerability sweep; opens remediation PRs for safe bumps and reports the rest to #security.',
      tags: ['security', 'github'], model: 'claude-opus-4-8', state: 'failing', risk: 'write',
      enabled: 1, success: 0.68, runs7d: 7, avg: 360, spend: 1.70, next: now + 8 * HOUR,
      triggers: [{ type: 'schedule', label: 'cron 0 15 * * *', detail: 'daily 15:00 UTC' }],
      grants: [['mcp', 'atlassian'], ['mcp', 'slack'], ['capability', 'open-pr'], ['capability', 'slack-post']],
      reactions: [{ when: 'check_run ci/* → failure', do: 'fix-ci', budget: '2' }],
      prompt: 'Run a dependency-vulnerability sweep. Open remediation PRs for safe bumps; report the rest to #security with severity + blast radius.',
    },
    {
      slug: 'solutions-triage-blockers', name: 'Solutions Triage · Blockers', team: 'solutions', owner: 'fabioelia',
      summary: 'Weekly pass identifying customer-blocking tickets, escalating to owners on Slack and labeling them in Jira.',
      tags: ['jira', 'slack', 'triage'], model: 'composer-2.5', state: 'idle', risk: 'read',
      enabled: 1, success: 0.95, runs7d: 1, avg: 300, spend: 0.22, next: now + 3 * DAY,
      triggers: [{ type: 'schedule', label: 'cron 0 7 * * 5', detail: 'Fri 07:00 UTC' }],
      grants: [['mcp', 'atlassian'], ['mcp', 'slack'], ['capability', 'slack-post'], ['capability', 'slack-read']],
      reactions: [],
      prompt: 'Identify customer-blocking tickets, escalate to owners on Slack, and label them in Jira.',
    },
    {
      slug: 'release-preview-and-risk', name: 'Release Preview & Risk', team: 'platform', owner: 'sdbnewton',
      summary: 'On a push to stage, builds a release preview, computes a risk profile, and posts it for sign-off.',
      tags: ['release', 'jira'], model: 'claude-opus-4-8', state: 'disabled', risk: 'read',
      enabled: 0, success: 0.88, runs7d: 0, avg: 480, spend: 0.0, next: null,
      triggers: [{ type: 'github', label: 'push: stage', detail: 'release candidate' }],
      grants: [['mcp', 'atlassian']],
      reactions: [],
      prompt: 'Build a release preview for the stage push, compute a risk profile from the diff and merged tickets, and post it for sign-off.',
    },
  ];

  const insR = tx(`INSERT INTO routines
    (id,slug,name,summary,owner,team_id,tags,enabled,visibility,model,repo,branch,state,risk,file_path,success_rate,runs_7d,avg_duration_sec,spend_today,next_run_at,created_at,updated_at,prompt)
    VALUES (@id,@slug,@name,@summary,@owner,@team,@tags,@enabled,@visibility,@model,@repo,@branch,@state,@risk,@file,@success,@runs7d,@avg,@spend,@next,@created,@updated,@prompt)`);
  const insT = tx('INSERT INTO triggers (routine_id,type,label,detail) VALUES (?,?,?,?)');
  const insG = tx('INSERT INTO grants (routine_id,kind,name) VALUES (?,?,?)');
  const insReact = tx('INSERT INTO reactions (routine_id,when_label,do_label,budget) VALUES (?,?,?,?)');

  R.forEach((r, i) => {
    const rid = id('rtn', i + 1);
    insR.run({
      id: rid, slug: r.slug, name: r.name, summary: r.summary, owner: r.owner, team: r.team,
      tags: JSON.stringify(r.tags), enabled: r.enabled, visibility: 'team', model: r.model,
      repo: 'Newton-Research-Inc/newton', branch: 'develop', state: r.state, risk: r.risk,
      file: `routines/${r.slug}.routine.md`, success: r.success, runs7d: r.runs7d, avg: r.avg,
      spend: r.spend, next: r.next, created: now - 40 * DAY, updated: now - Math.floor(Math.random() * 5) * DAY,
      prompt: r.prompt,
    });
    r.triggers.forEach(t => insT.run(rid, t.type, t.label, t.detail || null));
    r.grants.forEach(g => insG.run(rid, g[0], g[1]));
    (r.reactions || []).forEach(x => insReact.run(rid, x.when, x.do, x.budget));
    r._id = rid;
  });

  // ── Runs (history per routine) ──────────────────────────────────────────────
  const insRun = tx(`INSERT INTO runs
    (id,routine_id,status,trigger_type,trigger_summary,started_at,finished_at,duration_sec,summary,decision,pushed_sha,target,tokens,cost)
    VALUES (@id,@rid,@status,@tt,@ts,@start,@fin,@dur,@summary,@decision,@sha,@target,@tokens,@cost)`);

  let runN = 0;
  const sha = () => Math.random().toString(16).slice(2, 9);
  for (const r of R) {
    const n = Math.min(8, Math.max(3, Math.round(r.runs7d / 3) + 3));
    for (let k = 0; k < n; k++) {
      runN++;
      const isLatest = k === 0;
      let status = 'succeeded';
      if (isLatest) {
        if (r.state === 'running') status = 'running';
        else if (r.state === 'needs_human') status = 'needs_human';
        else if (r.state === 'failing') status = 'failed';
      } else if (Math.random() < (1 - r.success)) {
        status = Math.random() < 0.5 ? 'failed' : 'skipped';
      }
      const start = now - (k * (DAY / 2) + Math.floor(Math.random() * 6 * HOUR));
      const dur = status === 'running' ? null : Math.round(r.avg * (0.6 + Math.random() * 0.9));
      const trig = r.triggers[0];
      const target = r.risk === 'write' && Math.random() < 0.6 ? `pr:newton#${1300 + Math.floor(Math.random() * 60)}` : null;
      insRun.run({
        id: id('run', runN), rid: r._id, status,
        tt: trig.type, ts: trig.label,
        start, fin: status === 'running' ? null : start + (dur || 0) * 1000, dur,
        summary: status === 'succeeded' ? sumFor(r, target) : status === 'failed' ? 'Required check failed; left a Needs-Attention note.' : status === 'skipped' ? 'Skipped — lease held by a sibling run on the same PR.' : status === 'needs_human' ? 'Budget exhausted (3/3) — handed off to a human.' : null,
        decision: status === 'skipped' ? 'lease-held' : status === 'needs_human' ? 'budget-exhausted' : 'admit',
        sha: status === 'succeeded' && target ? sha() : null,
        target, tokens: status === 'running' ? null : Math.round((dur || 100) * 90),
        cost: status === 'running' ? null : +(((dur || 100) * 90) / 1_000_000 * 9).toFixed(2),
      });
    }
  }

  // ── Connectors ──────────────────────────────────────────────────────────────
  const C = [
    { slug: 'github', name: 'GitHub', kind: 'mcp', status: 'connected', auth: 'GitHub App', events: ['pull_request', 'push', 'label', 'check_run', 'issue_comment', 'review'], tools: 18, routines: 6, desc: 'Repo events in, PR actions out. Per-run scoped installation tokens.' },
    { slug: 'slack', name: 'Slack', kind: 'mcp', status: 'connected', auth: 'OAuth 2.0', events: ['message', 'mention', 'reaction'], tools: 9, routines: 9, desc: 'Channel messages as triggers; post + read as capabilities.' },
    { slug: 'atlassian', name: 'Atlassian (Jira)', kind: 'mcp', status: 'connected', auth: 'OAuth 2.0', events: ['issue_transitioned'], tools: 14, routines: 8, desc: 'Jira issue search, create, transition, comment. Confluence pages.' },
    { slug: 'sentry', name: 'Sentry', kind: 'mcp', status: 'degraded', auth: 'API key', events: ['issue', 'issue_resolved'], tools: 6, routines: 1, desc: 'High-severity issue events; issue detail + resolution.' },
    { slug: 'linear', name: 'Linear', kind: 'mcp', status: 'disconnected', auth: 'OAuth 2.0', events: ['issue', 'comment'], tools: 0, routines: 0, desc: 'Not connected. Authorize to grant Linear tools to routines.' },
    { slug: 'notion', name: 'Notion', kind: 'mcp', status: 'disconnected', auth: 'OAuth 2.0', events: [], tools: 0, routines: 0, desc: 'Not connected. Bring-your-own MCP — paste a server URL or image.' },
  ];
  const insC = tx(`INSERT INTO connectors (id,slug,name,kind,status,auth_type,events,tools_count,routines_count,last_checked,description)
    VALUES (@id,@slug,@name,@kind,@status,@auth,@events,@tools,@routines,@checked,@desc)`);
  C.forEach((c, i) => insC.run({
    id: id('con', i + 1), slug: c.slug, name: c.name, kind: c.kind, status: c.status, auth: c.auth,
    events: JSON.stringify(c.events), tools: c.tools, routines: c.routines,
    checked: now - Math.floor(Math.random() * 30) * MIN, desc: c.desc,
  }));

  // ── Subscriptions (PRs that routines opened and now follow) ─────────────────
  const subs = [
    { rtn: 'playwright-creator', pr: 'newton#1351', title: 'test(regression): cover blueprint scheduling edge cases', status: 'reacting', sha: sha(), last: 'fix-ci — pushed a fix for the failing ci/build check', used: 1, max: 3, ago: 12 * MIN },
    { rtn: 'sentry-top-10-high', pr: 'newton#1349', title: 'fix(digest): guard against null chart reference in follow-ups', status: 'needs_human', sha: sha(), last: 'budget exhausted (3/3) on fix-ci — handed off', used: 3, max: 3, ago: 2 * HOUR },
    { rtn: 'playwright-testing', pr: 'newton#1347', title: 'test(e2e): repair drifted selectors on the connectors page', status: 'watching', sha: sha(), last: 'green + approved — waiting on a human merge', used: 0, max: 2, ago: 40 * MIN },
    { rtn: 'vulnerability-pass', pr: 'newton#1352', title: 'chore(deps): bump urllib3 to 2.2.3 (CVE remediation)', status: 'reacting', sha: sha(), last: 'changes_requested → delegated to pr-cleanup-loop', used: 1, max: 2, ago: 25 * MIN },
  ];
  const insS = tx(`INSERT INTO subscriptions (id,routine_id,pr_ref,pr_title,status,head_sha,last_reaction,budget_used,budget_max,updated_at)
    VALUES (@id,@rid,@pr,@title,@status,@sha,@last,@used,@max,@updated)`);
  subs.forEach((s, i) => {
    const r = R.find(x => x.slug === s.rtn);
    insS.run({ id: id('sub', i + 1), rid: r._id, pr: s.pr, title: s.title, status: s.status, sha: s.sha, last: s.last, used: s.used, max: s.max, updated: now - s.ago });
  });

  // ── Leases (active claims) ──────────────────────────────────────────────────
  const insL = tx('INSERT INTO leases (resource,routine_id,run_id,expires_at,sha) VALUES (?,?,?,?,?)');
  const cleanup = R.find(x => x.slug === 'pr-cleanup-loop');
  insL.run('pr:newton#1342', cleanup._id, null, now + 14 * MIN, sha());
  const tp = R.find(x => x.slug === 'ticket-police');
  insL.run('pr:newton#1346', tp._id, null, now + 6 * MIN, sha());

  // ── Audit ───────────────────────────────────────────────────────────────────
  const insA = tx('INSERT INTO audit (actor,action,target,detail,ts) VALUES (?,?,?,?,?)');
  const audits = [
    ['fabioelia', 'enabled', 'vulnerability-pass', 'Re-enabled after dependency-graph outage', now - 3 * HOUR],
    ['sdbnewton', 'edited', 'pr-cleanup-loop', 'Raised per-PR budget 2 → 3', now - 6 * HOUR],
    ['fabioelia', 'dispatched', 'daily-triage-pipeline', 'Manual run (inputs: dry_run=false)', now - 8 * HOUR],
    ['sdbnewton', 'granted', 'sentry-top-10-high', 'Granted connector: sentry', now - 1 * DAY],
    ['danf-newton', 'disabled', 'release-preview-and-risk', 'Paused during the stage freeze', now - 2 * DAY],
  ];
  audits.forEach(a => insA.run(...a));

  db.prepare('INSERT INTO meta (key,value) VALUES (?,?)').run('kill_switch', 'false');
  db.prepare('INSERT INTO meta (key,value) VALUES (?,?)').run('org', 'Newton Research');
}

function sumFor(r, target) {
  if (r.slug === 'pr-attention-digest') return 'Posted digest: 14 open PRs, 3 ready to merge.';
  if (r.slug === 'ticket-police') return target ? `Linked NP-${4000 + Math.floor(Math.random() * 900)} to ${target}.` : 'Posted checkbox menu; nudged author on Slack.';
  if (r.slug === 'pr-cleanup-loop') return `Fixed 2 findings + 1 required check; pushed to ${target || 'PR head'}.`;
  if (r.slug === 'gha-pr-reviewer') return 'Surfaced 4 findings (1 blocking); emitted review/claude.';
  if (r.slug.startsWith('daily-triage')) return 'Applied 3 Jira updates; 2 threads still pending.';
  if (r.slug.startsWith('playwright')) return target ? `Opened ${target} with 3 new tests, all green.` : 'Authored 3 tests; opened a PR.';
  if (r.slug === 'sentry-top-10-high') return 'Triaged 10 issues; opened 1 fix PR.';
  return 'Completed; structured summary written.';
}
