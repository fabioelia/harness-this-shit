// Switchboard data store — built on Node's built-in SQLite (no native deps).
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { seed } from './seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.SWITCHBOARD_DB || join(__dirname, '..', 'switchboard.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  accent TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  handle TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  accent TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS routines (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  owner TEXT NOT NULL,
  team_id TEXT NOT NULL,
  tags TEXT NOT NULL,            -- json array
  enabled INTEGER NOT NULL,
  visibility TEXT NOT NULL,
  model TEXT NOT NULL,
  repo TEXT NOT NULL,
  branch TEXT NOT NULL,
  state TEXT NOT NULL,           -- idle | running | queued | needs_human | failing | disabled
  risk TEXT NOT NULL,           -- read | write
  file_path TEXT NOT NULL,
  success_rate REAL NOT NULL,
  runs_7d INTEGER NOT NULL,
  avg_duration_sec INTEGER NOT NULL,
  spend_today REAL NOT NULL,
  next_run_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  prompt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS triggers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id TEXT NOT NULL,
  type TEXT NOT NULL,           -- schedule | github | slack | sentry | manual | api | after | webhook
  label TEXT NOT NULL,
  detail TEXT
);

CREATE TABLE IF NOT EXISTS grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id TEXT NOT NULL,
  kind TEXT NOT NULL,           -- mcp | capability
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id TEXT NOT NULL,
  when_label TEXT NOT NULL,
  do_label TEXT NOT NULL,
  budget TEXT
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  routine_id TEXT NOT NULL,
  status TEXT NOT NULL,          -- succeeded | failed | running | queued | skipped | needs_human | canceled
  trigger_type TEXT NOT NULL,
  trigger_summary TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  duration_sec INTEGER,
  summary TEXT,
  decision TEXT,                 -- dispatcher decision / skip reason
  pushed_sha TEXT,
  target TEXT,                   -- e.g. pr:newton#1342
  tokens INTEGER,
  cost REAL
);

CREATE TABLE IF NOT EXISTS connectors (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,            -- mcp | native
  status TEXT NOT NULL,          -- connected | degraded | disconnected
  auth_type TEXT NOT NULL,
  events TEXT NOT NULL,          -- json array
  tools_count INTEGER NOT NULL,
  routines_count INTEGER NOT NULL,
  last_checked INTEGER NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  routine_id TEXT NOT NULL,
  pr_ref TEXT NOT NULL,          -- newton#1342
  pr_title TEXT NOT NULL,
  status TEXT NOT NULL,          -- watching | reacting | done | needs_human
  head_sha TEXT NOT NULL,
  last_reaction TEXT,
  budget_used INTEGER NOT NULL,
  budget_max INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS leases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource TEXT NOT NULL,
  routine_id TEXT NOT NULL,
  run_id TEXT,
  expires_at INTEGER NOT NULL,
  sha TEXT
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  detail TEXT,
  ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

let _db;

export function getDb() {
  if (_db) return _db;
  const fresh = !existsSync(DB_PATH);
  _db = new DatabaseSync(DB_PATH);
  _db.exec('PRAGMA journal_mode = WAL;');
  _db.exec(SCHEMA);
  const count = _db.prepare('SELECT COUNT(*) AS n FROM routines').get();
  if (fresh || count.n === 0) {
    seed(_db);
  }
  return _db;
}

// Small helpers
export function all(sql, ...params) {
  return getDb().prepare(sql).all(...params);
}
export function one(sql, ...params) {
  return getDb().prepare(sql).get(...params);
}
export function run(sql, ...params) {
  return getDb().prepare(sql).run(...params);
}
