// The store starts empty — no fabricated content. Real routines come from
// *.routine.md files in connected repos; connectors are added by the team.
// Only org-level meta is initialized.
export function seed(db) {
  db.prepare('INSERT INTO meta (key,value) VALUES (?,?)').run('kill_switch', 'false');
  db.prepare('INSERT INTO meta (key,value) VALUES (?,?)').run('wordmark', 'Switchboard');
}
