// The .harness file: one append-only NDJSON log per routines folder — the single
// place every wiring action and run outcome lands. It is both the audit trail and
// the wiring record: status/state are DERIVED by replaying it (event sourcing),
// so the harness writes exactly one artifact into your directory.
import { appendFileSync, readFileSync, existsSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { iso } from './util.js';

export const LOG_NAME = '.harness';
export const logPath = (dir) => join(dir, LOG_NAME);

export class HarnessLog {
  constructor(dir, { mirror = null } = {}) {
    this.path = logPath(dir);
    this.mirror = mirror;          // optional (line) => void, e.g. pretty console output
    this.secrets = new Set();      // values to redact — registered before any run starts
  }

  redactSecret(value) {
    if (value && String(value).length >= 6) this.secrets.add(String(value));
  }

  redact(s) {
    let out = String(s);
    for (const v of this.secrets) out = out.split(v).join('***');
    // belt-and-braces for token shapes that were never registered
    return out
      .replace(/xox[abpsr]-[A-Za-z0-9-]{10,}/g, 'xox…***')
      .replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, 'gh…***')
      .replace(/sk-[A-Za-z0-9-]{20,}/g, 'sk-***')
      .replace(/(Bearer\s+)[A-Za-z0-9._-]{12,}/gi, '$1***');
  }

  append(ev, data = {}) {
    const entry = { t: iso(), ev, ...data };
    const line = this.redact(JSON.stringify(entry));
    try { appendFileSync(this.path, line + '\n'); } catch (e) { console.error(`[harness] cannot write ${this.path}: ${e.message}`); }
    this.mirror?.(JSON.parse(line));
    return entry;
  }
}

// Replay the log into an array of entries (bad lines skipped, never fatal).
export function replay(dir) {
  const p = logPath(dir);
  if (!existsSync(p)) return [];
  const out = [];
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* torn/foreign line */ }
  }
  return out;
}

// Follow the log (for `harness logs -f`): emits parsed entries as they land.
export function follow(dir, onEntry, { fromEnd = true } = {}) {
  const p = logPath(dir);
  let pos = fromEnd && existsSync(p) ? readFileSync(p, 'utf8').length : 0;
  let buf = '';
  const tick = () => {
    if (!existsSync(p)) return;
    const text = readFileSync(p, 'utf8');
    if (text.length <= pos) { pos = Math.min(pos, text.length); return; }
    buf += text.slice(pos);
    pos = text.length;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      try { onEntry(JSON.parse(line)); } catch { /* skip */ }
    }
  };
  const timer = setInterval(tick, 500);
  return () => clearInterval(timer);
}
