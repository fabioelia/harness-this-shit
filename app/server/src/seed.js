// The store ships with ONE real, working routine — print the PR title on a push —
// and nothing else. No fabricated fleet/connectors/runs.
const PRINT_PR_TITLE = {
  slug: 'print-pr-title',
  name: 'Print PR Title',
  summary: 'On a push to a PR branch, print the title of the associated pull request.',
  owner: 'fabio',
  team: 'platform',
  triggers: ['push', 'pull_request'],
  connectors: ['github'],
  prompt:
    'You are a Switchboard routine that fires on a GitHub push / pull_request event. The trigger event payload is provided as JSON (enriched with live GitHub data when available). Print ONLY the title of the pull request — the value of pull_request.title. Output just that title text on one line, with no preamble, quotes, or markdown.',
  model: 'claude-opus-4-8',
  repo: 'fabioelia/harness-this-shit',
  branch: 'main',
  sinks: [{ type: 'stdout' }, { type: 'slack', target: '#dev-ai-slop' }],
  chain: [],
};

export function seed(db) {
  const r = PRINT_PR_TITLE;
  db.prepare(
    `INSERT INTO routines
      (slug,name,summary,owner,team,triggers,connectors,state,last_ago,last_status,next,success,spend,enabled,meta_short,lease_ref,avg,av_color,initials,ord,prompt,model,repo,branch,sinks,chain)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    r.slug, r.name, r.summary, r.owner, r.team,
    JSON.stringify(r.triggers), JSON.stringify(r.connectors),
    'idle', 'never', 'idle', 'on event', null, '$0.00', 1, '', '', '—',
    '#5b9ee6', 'FA', 0,
    r.prompt, r.model, r.repo, r.branch, JSON.stringify(r.sinks), JSON.stringify(r.chain)
  );
  db.prepare('INSERT INTO meta (key,value) VALUES (?,?)').run('kill_switch', 'false');
  db.prepare('INSERT INTO meta (key,value) VALUES (?,?)').run('wordmark', 'Switchboard');
}
