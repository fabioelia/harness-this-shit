// Real developer flows + a capable agent team you can load with one click (and that a
// fresh install seeds by default). Every entry is a genuine, runnable definition — not
// fake data. `__REPO__` is replaced with the target repo at seed/load time. Together they
// exercise triggers, filters, tools, agent delegation, reactions, chains, schedule,
// memory and per-PR concurrency the way a team would actually wire them up.

export const DEFAULT_REPO = 'fabioelia/harness-this-shit';
export const SLACK = '#dev-ai-slop';

// ── Agent team — each is multi-tool, opinionated, and most carry memory so they get
//    sharper over time. Routines delegate to them with `agent-message <name> "…"`. ──
export const SAMPLE_AGENTS = [
  {
    name: 'reviewer',
    summary: 'staff-level code reviewer — bugs, security, perf, test gaps',
    role:
      'You are a staff software engineer doing code review. Read the PR with `gh pr diff <n> --repo <repo>` and `gh pr view <n>`. Review for: correctness bugs, security issues (injection, authz, secrets), performance traps, missing test coverage, and breaking changes. Use WebFetch/WebSearch to confirm library behavior or check CVEs when relevant. Report a prioritized list (P0/P1/P2) citing file:line, each with a concrete fix — no praise padding, no restating the diff. As you learn this repo’s conventions (naming, error handling, test patterns), record them in memory.md and apply them next time.',
    connectors: ['github', 'web'],
    model: 'claude-opus-4-8',
    effort: 'high',
    memory: true,
  },
  {
    name: 'oncall',
    summary: 'incident responder — correlates CI/deploy failures to causes',
    role:
      'You are the on-call engineer. Diagnose CI and deploy health with the gh CLI (`gh run list`, `gh run view <id> --log-failed`, `gh pr checks`). Correlate a failure to the commit/PR that introduced it, and use the web to check dependency status pages or known incidents. State the failing job, the suspected commit, the likely cause, and the smallest next step — concisely. Post material findings to Slack ' + SLACK + '. Keep a running memory.md of recurring failures and their fixes so repeat incidents are resolved instantly.',
    connectors: ['github', 'slack', 'web'],
    model: 'claude-opus-4-8',
    effort: 'high',
    memory: true,
  },
  {
    name: 'researcher',
    summary: 'deep researcher — libraries, errors, best practices, with sources',
    role:
      'You are a research engineer. Given a question (a library choice, an error, an API, a best practice), investigate with WebSearch/WebFetch and the repo (`gh search`, code in the repo) and return a tight, sourced answer: the recommendation, the 2–3 facts that justify it (each with a link), and the trade-offs. Prefer primary sources (official docs, changelogs, RFCs, advisories). Never hand-wave — if you are unsure, say what you would need to confirm.',
    connectors: ['web', 'github'],
    model: 'claude-opus-4-8',
    effort: 'high',
    memory: false,
  },
  {
    name: 'release-manager',
    summary: 'owns the release cut — notes, blockers, coordination',
    role:
      'You are the release manager. When a release is cut, assemble the change set (`gh pr list --repo <repo> --state merged --base main --json number,title,labels,mergedAt`), draft clean notes grouped Features / Fixes / Internal, and flag anything risky (migrations, breaking changes, reverted PRs). Delegate deep questions to the `researcher` agent. Track release cadence and recurring follow-ups in memory.md so each release runs smoother than the last.',
    connectors: ['github', 'slack', 'team'],
    model: 'claude-opus-4-8',
    effort: 'medium',
    memory: true,
  },
];

// ── Routines — four cohesive scenarios. `scenario` is just for the loader summary. ──
export const SAMPLE_ROUTINES = [
  // ── Scenario 1: PR review & CI triage (filters + agent delegation + reactions + per-PR lease) ──
  {
    scenario: 'PR review & CI triage',
    name: 'PR Review',
    slug: 'pr-review',
    summary: 'Reviews opened/updated PRs, delegates a deep pass, and follows their CI.',
    owner: 'platform', team: 'platform',
    triggers: ['pull_request'],
    filters: { actions: ['opened', 'synchronize', 'reopened'], branches: [], mode: 'and' },
    connectors: ['github', 'slack', 'team'],
    model: 'claude-opus-4-8', effort: 'high',
    concurrency: { scope: 'pr', onConflict: 'wait' },
    repo: '__REPO__',
    prompt:
      'A pull request was opened or updated (see event.pull_request). 1) Read it: `gh pr diff <number> --repo <repo>`. 2) Delegate a deep review to the team: `agent-message reviewer "Review PR #<number> in <repo> — prioritized risks with file:line and fixes"`. 3) Post a concise summary to Slack ' + SLACK + ' — the PR title + link, a one-line risk read, and the reviewer’s top 2–3 P0/P1 items. Keep it skimmable. (A per-PR lease means two pushes to the same PR never review it at once.)',
    reactions: [
      { source: 'github', kind: 'checks', when: 'failure', check: '', run: 'ci-triage' },
      { source: 'github', kind: 'review', when: 'approved', run: 'merge-ready' },
    ],
    chain: [],
  },
  {
    scenario: 'PR review & CI triage',
    name: 'CI Triage',
    slug: 'ci-triage',
    summary: 'On a failing PR check, finds the root cause and posts a triage note.',
    owner: 'platform', team: 'platform',
    triggers: ['manual'],
    connectors: ['github', 'slack', 'team'],
    model: 'claude-opus-4-8', effort: 'high',
    concurrency: { scope: 'pr', onConflict: 'drop' },
    repo: '__REPO__',
    prompt:
      "A CI check failed on the PR in the trigger event (event.pull_request, event.checks). Find the failing run (`gh run list --repo <repo>`, `gh run view <id> --log-failed`), identify the root cause, and — if it's non-obvious — `agent-message oncall \"diagnose <failing job> on PR #<n> in <repo>\"`. Post a tight triage to Slack " + SLACK + ': which check failed, the probable cause (with the offending file/commit), and the smallest next step.',
    reactions: [], chain: [],
  },
  {
    scenario: 'PR review & CI triage',
    name: 'Merge Ready',
    slug: 'merge-ready',
    summary: 'When a PR is approved, posts a ready-to-merge note.',
    owner: 'platform', team: 'platform',
    triggers: ['manual'],
    connectors: ['github', 'slack'],
    model: 'claude-haiku-4-5-20251001',
    repo: '__REPO__',
    prompt:
      "The PR in the trigger event was approved. Confirm its checks are green (`gh pr checks <n> --repo <repo>`), then post a brief 'ready to merge ✅' note to Slack " + SLACK + ' with the PR title and URL. If checks are not green, say what is still pending instead.',
    reactions: [], chain: [],
  },

  // ── Scenario 2: Nightly flaky-test watch (schedule + memory) ──
  {
    scenario: 'Nightly flaky-test watch',
    name: 'Flaky Test Watch',
    slug: 'flaky-watch',
    summary: 'Each morning, flags newly-flaky tests and remembers known ones.',
    owner: 'platform', team: 'quality',
    triggers: ['schedule'], schedule: '0 8 * * 1-5',
    connectors: ['github', 'slack'],
    model: 'claude-opus-4-8', effort: 'medium',
    memory: true,
    repo: '__REPO__',
    prompt:
      'Scan the most recent CI runs (`gh run list --repo <repo> --limit 40 --json databaseId,conclusion,headSha,name`). Identify jobs that failed and then passed on a re-run of the same SHA (flaky). Read memory.md for tests already known to be flaky. Post only NEW flaky tests to Slack ' + SLACK + ' with how often each flaked, and append them to memory.md under "## Known flaky" with the date — never re-report a known one. If nothing new, do nothing.',
    reactions: [], chain: [],
  },

  // ── Scenario 3: Release notes → announce (release trigger + agent + chain) ──
  {
    scenario: 'Release notes → announce',
    name: 'Release Notes',
    slug: 'release-notes',
    summary: 'On a release, the release-manager drafts notes, then chains to announce.',
    owner: 'platform', team: 'platform',
    triggers: ['release'],
    connectors: ['github', 'team'],
    model: 'claude-opus-4-8', effort: 'medium',
    repo: '__REPO__',
    prompt:
      'A release was published (event.release). Hand it to the team: `agent-message release-manager "Draft release notes for <tag> in <repo> — Features / Fixes / Internal, and flag risky changes"`. Return exactly the notes the release-manager produces — they are passed to the next routine via upstream.output.',
    chain: ['announce'], reactions: [],
  },
  {
    scenario: 'Release notes → announce',
    name: 'Announce',
    slug: 'announce',
    summary: 'Posts the upstream release notes to Slack.',
    owner: 'platform', team: 'platform',
    triggers: ['manual'],
    connectors: ['slack'],
    model: 'claude-haiku-4-5-20251001',
    repo: '__REPO__',
    prompt:
      'Post the release notes in event.upstream.output to Slack ' + SLACK + ' with a short celebratory intro line and clean formatting. Lead with the headline features.',
    reactions: [], chain: [],
  },

  // ── Scenario 4: Weekly dependency & security audit (schedule + web + agent + memory + issue) ──
  {
    scenario: 'Dependency & security audit',
    name: 'Dependency Audit',
    slug: 'dep-audit',
    summary: 'Weekly: checks deps for advisories/outdated, files an issue, remembers findings.',
    owner: 'platform', team: 'security',
    triggers: ['schedule'], schedule: '0 9 * * 1',
    connectors: ['github', 'web', 'team'],
    model: 'claude-opus-4-8', effort: 'high',
    memory: true,
    repo: '__REPO__',
    prompt:
      "Audit this repo's dependencies. Read the manifest/lockfile (`gh api repos/<repo>/contents/package.json` or the repo's equivalent) and check GitHub security advisories (`gh api repos/<repo>/dependabot/alerts` if available). For anything flagged, `agent-message researcher \"is <pkg>@<ver> affected by <advisory/CVE>, and what is the fixed version — with sources\"`. Compare against memory.md so you only report what's new or changed. Open or update a single tracking issue titled \"Security: dependency audit\" (`gh issue list/create/comment --repo <repo>`) with a prioritized table, and record the current state in memory.md. If nothing actionable, note the clean run in memory and stop.",
    reactions: [], chain: [],
  },
];
