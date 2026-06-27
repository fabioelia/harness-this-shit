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
  meta_short TEXT NOT NULL,
  lease_ref TEXT NOT NULL,
  avg TEXT NOT NULL,
  av_color TEXT NOT NULL,
  initials TEXT NOT NULL,
  ord INTEGER NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT 'claude-opus-4-8',
  repo TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT 'main',
  sinks TEXT NOT NULL DEFAULT '[]',   -- json: output sinks [{type,target}]
  chain TEXT NOT NULL DEFAULT '[]'    -- json: downstream routine slugs
);
CREATE TABLE IF NOT EXISTS connectors (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  health TEXT NOT NULL,        -- ok | degraded | off
  auth TEXT NOT NULL,
  scopes TEXT NOT NULL,
  routines INTEGER NOT NULL,
  av_color TEXT NOT NULL,
  ord INTEGER NOT NULL
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
  sinks_result TEXT NOT NULL DEFAULT '[]',
  exec_mode TEXT NOT NULL DEFAULT 'cloud',   -- cloud (remote session) | local
  prompt TEXT NOT NULL DEFAULT '',           -- resolved prompt for the cloud worker
  cloud_url TEXT NOT NULL DEFAULT '',
  cost_usd REAL,                             -- total_cost_usd from the session
  num_turns INTEGER,                         -- model turns
  session_id TEXT NOT NULL DEFAULT ''        -- claude session id (resume handle)
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
  ensure('runs', 'cost_usd', 'cost_usd REAL');
  ensure('runs', 'num_turns', 'num_turns INTEGER');
  ensure('runs', 'session_id', "session_id TEXT NOT NULL DEFAULT ''");
  const n = _db.prepare('SELECT COUNT(*) AS n FROM routines').get();
  if (fresh || n.n === 0) seed(_db);
  return _db;
}
export const all = (sql, ...p) => getDb().prepare(sql).all(...p);
export const one = (sql, ...p) => getDb().prepare(sql).get(...p);
export const run = (sql, ...p) => getDb().prepare(sql).run(...p);
