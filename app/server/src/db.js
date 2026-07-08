// Switchboard data store — Node's built-in SQLite (no native deps).
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { seed } from './seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.SWITCHBOARD_DB || join(__dirname, '..', 'switchboard.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS routines (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  owner TEXT NOT NULL,
  team TEXT NOT NULL,
  triggers TEXT NOT NULL,      -- json array
  connectors TEXT NOT NULL,    -- json array
  state TEXT NOT NULL,
  last_ago TEXT NOT NULL,
  last_status TEXT NOT NULL,
  next TEXT NOT NULL,
  success INTEGER,             -- nullable
  spend TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  avg TEXT NOT NULL,
  av_color TEXT NOT NULL,
  initials TEXT NOT NULL,
  ord INTEGER NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT 'claude-opus-4-8',
  repo TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT 'main',
  chain TEXT NOT NULL DEFAULT '[]',   -- json: downstream routine slugs
  schedule TEXT NOT NULL DEFAULT '',  -- 5-field cron for the schedule trigger
  filters TEXT NOT NULL DEFAULT '{}', -- json: event sub-filters
  reactions TEXT NOT NULL DEFAULT '[]', -- json: [{source,kind,when,run}] follow-the-work
  effort TEXT NOT NULL DEFAULT '',      -- session reasoning effort (low|medium|high|xhigh|max), '' = CLI default
  memory INTEGER NOT NULL DEFAULT 0,    -- 1 = grant a persistent memory.md the session can read/update
  concurrency TEXT NOT NULL DEFAULT '{}', -- json: { scope, onConflict }
  retries INTEGER NOT NULL DEFAULT 0      -- auto-retry failed runs (0-3)
);
CREATE TABLE IF NOT EXISTS watches (
  id TEXT PRIMARY KEY,
  origin_run TEXT NOT NULL DEFAULT '',
  origin_routine TEXT NOT NULL DEFAULT '',
  target_slug TEXT NOT NULL,
  source TEXT NOT NULL,            -- github | timeout | …
  kind TEXT NOT NULL,             -- checks | review | merge | after
  when_cond TEXT NOT NULL,        -- success | failure | any | approved | … | duration
  entity TEXT NOT NULL DEFAULT '{}', -- json: { repo, pr } | { duration_ms }
  status TEXT NOT NULL DEFAULT 'open', -- open | fired | dropped | expired
  detail TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
  fire_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_watches_status ON watches(status);
CREATE TABLE IF NOT EXISTS leases (
  key TEXT PRIMARY KEY,             -- concurrency group: <slug>@pr:<repo>#<n> | <slug>@repo:<r> | routine:<slug>
  run_id TEXT NOT NULL,
  routine_slug TEXT NOT NULL,
  head_sha TEXT NOT NULL DEFAULT '',
  acquired_at INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS run_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_slug TEXT NOT NULL,
  lease_key TEXT NOT NULL,                -- the concurrency key the task belongs to
  summary TEXT NOT NULL,                  -- human handoff line shown to the running agent
  payload TEXT NOT NULL DEFAULT '{}',     -- the coalesced event
  origin_run TEXT NOT NULL DEFAULT '',    -- the run whose dispatch was coalesced
  handled_by TEXT NOT NULL DEFAULT '',    -- run that claimed it ('' = pending)
  created_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_run_tasks_key ON run_tasks(routine_slug, lease_key, handled_by);
CREATE TABLE IF NOT EXISTS mcp_servers (
  name TEXT PRIMARY KEY,
  config TEXT NOT NULL,            -- json server def: {command,args,env} (stdio) | {type,url,headers} (http/sse)
  auth TEXT NOT NULL DEFAULT '{}', -- json: { scheme, header, token }
  created_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time TEXT NOT NULL,
  text TEXT NOT NULL,
  state TEXT NOT NULL,
  ord INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  routine_slug TEXT NOT NULL,
  status TEXT NOT NULL,
  ago TEXT NOT NULL,
  dur TEXT NOT NULL,
  trigger TEXT NOT NULL,
  ord INTEGER NOT NULL,
  output TEXT NOT NULL DEFAULT '',
  event TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0,
  prompt TEXT NOT NULL DEFAULT '',           -- resolved session prompt (for the trace)
  cost_usd REAL,                             -- total_cost_usd from the session
  num_turns INTEGER,                         -- model turns
  session_id TEXT NOT NULL DEFAULT '',       -- claude session id (resume handle)
  dur_ms INTEGER,
  model_used TEXT NOT NULL DEFAULT '',
  in_tokens INTEGER,
  out_tokens INTEGER
);
CREATE TABLE IF NOT EXISTS run_events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id   TEXT NOT NULL,
  seq      INTEGER NOT NULL,                 -- monotonic order within the run
  t_offset INTEGER NOT NULL,                 -- ms since run start
  type     TEXT NOT NULL,                    -- system | text | tool_use | tool_result | result
  tool     TEXT,                             -- tool name (tool_use / tool_result)
  ok       INTEGER,                          -- nullable; 0/1 for tool_result.is_error
  payload  TEXT NOT NULL                     -- redacted + truncated JSON
);
CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id, seq);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

let _db;
export function getDb() {
  if (_db) return _db;
  const fresh = !existsSync(DB_PATH);
  _db = new DatabaseSync(DB_PATH);
  _db.exec('PRAGMA journal_mode = WAL;');
  _db.exec(SCHEMA);
  // Guarded migration: CREATE TABLE IF NOT EXISTS won't add columns to an existing db.
  const cols = (t) => new Set(_db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
  const ensure = (t, name, ddl) => { if (!cols(t).has(name)) _db.exec(`ALTER TABLE ${t} ADD COLUMN ${ddl}`); };
  ensure('routines', 'concurrency', "concurrency TEXT NOT NULL DEFAULT '{}'");
  ensure('routines', 'retries', 'retries INTEGER NOT NULL DEFAULT 0');
  ensure('mcp_servers', 'auth', "auth TEXT NOT NULL DEFAULT '{}'");
  ensure('runs', 'dur_ms', 'dur_ms INTEGER');
  ensure('runs', 'model_used', "model_used TEXT NOT NULL DEFAULT ''");
  ensure('runs', 'in_tokens', 'in_tokens INTEGER');
  ensure('runs', 'out_tokens', 'out_tokens INTEGER');
  const n = _db.prepare('SELECT COUNT(*) AS n FROM routines').get();
  if (fresh || n.n === 0) seed(_db);
  return _db;
}
export const all = (sql, ...p) => getDb().prepare(sql).all(...p);
export const one = (sql, ...p) => getDb().prepare(sql).get(...p);
export const run = (sql, ...p) => getDb().prepare(sql).run(...p);
