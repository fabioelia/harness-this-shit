// The store ships with ONE real, working routine — print the PR title on a push —
// and nothing else. No fabricated fleet/connectors/runs.
const PRINT_PR_TITLE = {
  slug: 'print-pr-title',
  name: 'Print PR Title',
  summary: 'On a push to a PR branch, print the title of the associated pull request.',
  owner: 'fabio',
  team: 'platform',
  triggers: ['push', 'pull_request'],
  connectors: ['github', 'slack'],
  prompt:
    'When a pull request is opened or a commit is pushed to its branch, find the title of the associated pull request and post it to the Slack channel #dev-ai-slop. If Slack is not available, report the title as your result instead.',
  model: 'claude-opus-4-8',
  repo: 'fabioelia/harness-this-shit',
  branch: 'main',
  chain: [],
};

export function seed(db) {
  const r = PRINT_PR_TITLE;
  db.prepare(
    `INSERT INTO routines
      (slug,name,summary,owner,team,triggers,connectors,state,last_ago,last_status,next,success,spend,enabled,meta_short,lease_ref,avg,av_color,initials,ord,prompt,model,repo,branch,chain)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    r.slug, r.name, r.summary, r.owner, r.team,
    JSON.stringify(r.triggers), JSON.stringify(r.connectors),
    'idle', 'never', 'idle', 'on event', null, '$0.00', 1, '', '', '—',
    '#5b9ee6', 'FA', 0,
    r.prompt, r.model, r.repo, r.branch, JSON.stringify(r.chain)
  );
  db.prepare('INSERT INTO meta (key,value) VALUES (?,?)').run('kill_switch', 'false');
  db.prepare('INSERT INTO meta (key,value) VALUES (?,?)').run('wordmark', 'Switchboard');
}
