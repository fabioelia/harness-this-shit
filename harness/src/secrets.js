// Secret resolution (docs/02 §2.7, docs/06 §5): routines declare REFERENCES,
// never values. The local harness resolves three schemes:
//   env://VAR              → process env
//   file://path            → file contents (relative to the routines dir)
//   vault://team/app/key   → mapped env var VAULT_TEAM_APP_KEY, or the
//                            `secrets:` map in harness.yaml ({ "vault://…": "env://…" })
// Every resolved value is registered with the log for redaction before any run.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function resolveSecretRef(from, { dir = '.', mapping = {} } = {}) {
  let ref = String(from);
  if (mapping[ref]) ref = String(mapping[ref]);          // harness.yaml indirection
  if (ref.startsWith('env://')) {
    const name = ref.slice(6);
    return { value: process.env[name] ?? null, via: `env ${name}` };
  }
  if (ref.startsWith('file://')) {
    const p = resolve(dir, ref.slice(7));
    try { return { value: readFileSync(p, 'utf8').trim(), via: `file ${ref.slice(7)}` }; }
    catch { return { value: null, via: `file ${ref.slice(7)} (unreadable)` }; }
  }
  if (ref.startsWith('vault://')) {
    const name = ref.slice(8).replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
    const candidates = [`VAULT_${name}`, name];
    for (const c of candidates) if (process.env[c] != null) return { value: process.env[c], via: `env ${c} (vault mapping)` };
    return { value: null, via: `vault://… (set VAULT_${name} or map it in harness.yaml secrets:)` };
  }
  // bare env var name as a convenience
  if (/^[A-Z][A-Z0-9_]*$/.test(ref)) return { value: process.env[ref] ?? null, via: `env ${ref}` };
  return { value: null, via: 'unrecognized scheme' };
}

// Resolve a routine's declared secrets → { env: {NAME: value}, resolved: [{name, via, ok}] }.
// Missing secrets are reported, not fatal — the dispatcher decides whether to skip.
export function resolveSecrets(routine, { dir, mapping, log } = {}) {
  const env = {}, report = [];
  for (const s of routine.secrets) {
    const { value, via } = resolveSecretRef(s.from, { dir, mapping });
    if (value != null) { env[s.name] = value; log?.redactSecret(value); }
    report.push({ name: s.name, via, ok: value != null });
  }
  return { env, report };
}
