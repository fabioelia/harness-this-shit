// Small shared primitives: ids, durations, globs, deep ops. No deps.

export const now = () => Date.now();
export const iso = (t = now()) => new Date(t).toISOString();
export const rid = (prefix = 'run') => `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "30m" / "45s" / "2h" / "14d" / bare number (minutes) → ms. null on garbage.
export function durationMs(s) {
  if (s == null || s === '') return null;
  if (typeof s === 'number') return s * 60_000;
  const m = String(s).trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|m|min|mins|h|hr|hrs|d|day|days)?$/i);
  if (!m) return null;
  const n = +m[1], u = (m[2] || 'm').toLowerCase();
  if (u === 'ms') return n;
  if (u.startsWith('s')) return n * 1000;
  if (u.startsWith('h')) return n * 3_600_000;
  if (u.startsWith('d')) return n * 86_400_000;
  return n * 60_000;
}

export const fmtDur = (ms) => (ms == null ? '…' : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);

// Glob → RegExp. Supports *, **, ?, {a,b}. Used for branches/paths/check names.
export function globToRe(glob) {
  let re = '';
  const g = String(glob);
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { re += '.*'; i++; if (g[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = g.indexOf('}', i);
      if (end < 0) { re += '\\{'; continue; }
      re += '(' + g.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('|') + ')';
      i = end;
    } else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
export const globMatch = (glob, value) => globToRe(glob).test(String(value));
export const anyGlob = (globs, value) => (Array.isArray(globs) ? globs : [globs]).some((g) => globMatch(g, value));

export const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

// Dotted-path lookup: get({a:{b:1}}, 'a.b') → 1. Array indices allowed: 'x.0.y'.
export function get(obj, path) {
  let cur = obj;
  for (const part of String(path).split('.')) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

export function deepMerge(base, over) {
  if (Array.isArray(base) || Array.isArray(over) || typeof base !== 'object' || typeof over !== 'object' || !base || !over) {
    return over === undefined ? base : over;
  }
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = deepMerge(base[k], v);
  return out;
}

export const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const truncate = (s, n) => (String(s).length > n ? String(s).slice(0, n) + '…' : String(s));
