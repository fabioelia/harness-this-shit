// Three real developer flows you can load with one click. Each is a genuine,
// runnable routine/agent definition — not fake data. `__REPO__` is replaced with
// the user's repo at load time. These showcase triggers, tools, agents, reactions,
// chains, schedule, and memory working together the way a team would actually use them.

export const SAMPLE_AGENTS = [
  {
    name: 'reviewer',
    summary: 'senior code reviewer — risks, bugs, and concrete suggestions',
    role:
      'You are a senior code reviewer. Given a pull request, read the diff with `gh pr diff <n> --repo <repo>` and review it. Report the top concrete risks, likely bugs, and specific suggestions — terse, prioritized, no praise padding. Cite file:line where you can.',
    connectors: ['github'],
    model: 'claude-opus-4-8',
    memory: false,
  },
  {
    name: 'oncall',
    summary: 'answers questions about recent CI / deploy health',
    role:
      'You are the on-call engineer. Answer questions about recent CI and deploy health using the gh CLI (gh run list, gh run view, gh pr checks). Be concrete: name the failing job, the commit, and the likely cause. Keep answers short.',
    connectors: ['github'],
    model: 'claude-opus-4-8',
    memory: true,
  },
];

// scenario tag is just for the loader's response summary
export const SAMPLE_ROUTINES = [
  // ── Scenario 1: PR review & CI triage (triggers + tools + agent + reactions) ──
  {
    scenario: 'PR review & CI triage',
    name: 'PR Review',
    slug: 'pr-review',
    summary: 'Reviews opened PRs, posts risks to Slack, and follows their CI.',
    owner: 'platform', team: 'platform',
    triggers: ['pull_request'],
    filters: { actions: ['opened', 'synchronize', 'reopened'], branches: [], mode: 'and' },
    connectors: ['github', 'slack', 'team'],
    model: 'claude-opus-4-8',
    repo: '__REPO__',
    prompt:
      'When a pull request is opened or updated, review it: run `gh pr diff <number> --repo <repo>` to read the change, then post a concise review to Slack #dev-ai-slop — the PR title, a one-line risk summary, and the 2–3 most important things to check. For a deep line-by-line review, delegate to the `reviewer` agent with `agent-message reviewer "review PR #<n> in <repo>"`.',
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
    summary: 'On a failing PR check, finds the cause and posts a triage note.',
    owner: 'platform', team: 'platform',
    triggers: ['manual'],
    connectors: ['github', 'slack'],
    model: 'claude-opus-4-8',
    repo: '__REPO__',
    prompt:
      "A CI check failed on the pull request in the trigger event (see event.pull_request and event.checks). Use gh to read the failing run's logs (`gh run list`, `gh run view <id> --log-failed`), identify the most likely cause, and post a short triage to Slack #dev-ai-slop: which check failed, the probable cause, and a suggested next step.",
    reactions: [], chain: [],
  },
  {
    scenario: 'PR review & CI triage',
    name: 'Merge Ready',
    slug: 'merge-ready',
    summary: 'When a PR is approved, posts a ready-to-merge note.',
    owner: 'platform', team: 'platform',
    triggers: ['manual'],
    connectors: ['slack'],
    model: 'claude-haiku-4-5-20251001',
    repo: '__REPO__',
    prompt:
      "The pull request in the trigger event was just approved. Post a brief 'ready to merge ✅' note to Slack #dev-ai-slop with the PR title and URL from event.pull_request.",
    reactions: [], chain: [],
  },

  // ── Scenario 2: Nightly flaky-test watch (schedule + memory + gh + slack) ──
  {
    scenario: 'Nightly flaky-test watch',
    name: 'Flaky Test Watch',
    slug: 'flaky-watch',
    summary: 'Each morning, flags newly-flaky tests and remembers known ones.',
    owner: 'platform', team: 'quality',
    triggers: ['schedule'],
    schedule: '0 8 * * 1-5',
    connectors: ['github', 'slack'],
    model: 'claude-opus-4-8',
    memory: true,
    repo: '__REPO__',
    prompt:
      'Review the most recent CI runs in the repo with `gh run list --repo <repo> --limit 30 --json ...`. Identify tests/jobs that failed and then passed on a re-run (flaky). Read memory.md for already-known flaky tests. Post only the NEW flaky tests to Slack #dev-ai-slop, and append them to memory.md (under "## Known flaky") so you never re-report the same one. If nothing new, do nothing.',
    reactions: [], chain: [],
  },

  // ── Scenario 3: Release notes → announce (release trigger + chain) ──
  {
    scenario: 'Release notes → announce',
    name: 'Release Notes',
    slug: 'release-notes',
    summary: 'On a release, drafts notes from merged PRs, then chains to announce.',
    owner: 'platform', team: 'platform',
    triggers: ['release'],
    connectors: ['github'],
    model: 'claude-opus-4-8',
    repo: '__REPO__',
    prompt:
      'A release was published (see event.release). Use gh to list the pull requests merged since the previous release (`gh pr list --repo <repo> --state merged --base main --json number,title,mergedAt`) and draft concise release notes grouped into Features / Fixes / Other. Output just the notes — they are handed to the next routine.',
    chain: ['announce'],
    reactions: [],
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
      'Post the release notes provided in event.upstream.output to Slack #dev-ai-slop with a short celebratory intro line. Keep the formatting clean.',
    reactions: [], chain: [],
  },
];
