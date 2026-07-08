// Connector grants → the concrete MCP config + tool allowlist a run gets
// (docs/06 §4): granted MCP servers become an --mcp-config file scoped to that
// run; granted capabilities become --allowed-tools patterns; deny: becomes
// --disallowed-tools. Least privilege is structural — ungranted tools don't exist.
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CAPABILITIES } from './schema.js';

// Native connectors are enforced without an MCP server; anything else granted
// via tools.mcp must resolve to a registry entry with a server config.
export const NATIVE = new Set(['github', 'slack', 'web', 'webfetch']);

const isMcpRemote = (def) => def?.command === 'npx' && Array.isArray(def?.args) && def.args.includes('mcp-remote');

export function buildMcpConfig(routine, registry, { runId, auth = {} }) {
  const servers = {};
  const missing = [];
  for (const id of routine.tools.mcp) {
    if (NATIVE.has(id)) continue;
    const c = registry[id];
    if (!c || (c.kind ?? 'mcp') !== 'mcp' || !(c.config?.command || c.config?.url || c.url || c.command)) {
      missing.push(id);
      continue;
    }
    let def = structuredClone(c.config ?? (c.url ? { type: c.transport === 'http' ? 'http' : 'sse', url: c.url, headers: c.headers } : { command: c.command, args: c.args, env: c.env }));
    // stored auth (UI-managed token) injected at run time — never written to the registry file
    const a = auth[id];
    if (a?.token) {
      const value = a.scheme === 'raw' ? a.token : `Bearer ${a.token}`;
      if (isMcpRemote(def)) def.args = [...def.args, '--header', `${a.header || 'Authorization'}: ${value}`];
      else if (def.url) def.headers = { ...(def.headers || {}), [a.header || 'Authorization']: value };
      else def.env = { ...(def.env || {}), [a.header || 'API_KEY']: a.token };
    }
    // "${VAR}" placeholders in env values resolve from the harness's environment
    if (def.env) for (const [k, v] of Object.entries(def.env)) {
      def.env[k] = String(v).replace(/\$\{(\w+)\}/g, (_, n) => process.env[n] ?? '');
    }
    servers[id] = def;
  }
  if (!Object.keys(servers).length) return { path: null, servers, missing };
  const dir = mkdtempSync(join(tmpdir(), `harness-${runId}-`));
  const path = join(dir, 'mcp.json');
  writeFileSync(path, JSON.stringify({ mcpServers: servers }, null, 2));
  return { path, servers, missing };
}

// Compose the run's tool allowlist from grants (docs/06 §4). Read-only repo
// tools ride along whenever there's a checkout or state dir to read.
export function allowedTools(routine, { hasWorkspace = false } = {}) {
  const allow = new Set();
  const grants = [];
  if (hasWorkspace) ['Read', 'Glob', 'Grep', 'Bash(git status:*)', 'Bash(git log:*)', 'Bash(git diff:*)', 'Bash(git show:*)'].forEach((t) => allow.add(t));
  if (routine.state.enabled) ['Read', 'Write', 'Edit', 'Glob', 'Grep'].forEach((t) => allow.add(t));
  for (const id of routine.tools.mcp) {
    if (id === 'github') { allow.add('Bash(gh:*)'); grants.push({ grant: 'mcp:github', tools: ['Bash(gh:*)'] }); }
    else if (id === 'slack') { allow.add('Bash(slack-post:*)'); grants.push({ grant: 'mcp:slack', tools: ['Bash(slack-post:*)'] }); }
    else if (id === 'web' || id === 'webfetch') { allow.add('WebFetch'); allow.add('WebSearch'); grants.push({ grant: 'mcp:web', tools: ['WebFetch', 'WebSearch'] }); }
    else { allow.add(`mcp__${id}__*`); grants.push({ grant: `mcp:${id}`, tools: [`mcp__${id}__*`] }); }
  }
  for (const cap of routine.tools.capabilities) {
    const spec = CAPABILITIES[cap];
    if (!spec) continue;
    spec.tools.forEach((t) => allow.add(t));
    grants.push({ grant: `capability:${cap}`, tools: spec.tools });
  }
  // deny: hard prohibitions — mapped to disallowed tool patterns AND (in prompt.js)
  // to hard-constraint lines, since flag-level patterns are prefix matches only.
  const deny = new Set();
  const DENY_MAP = {
    'git-force-push': ['Bash(git push --force:*)', 'Bash(git push -f:*)'],
    'merge-pr': ['Bash(gh pr merge:*)'],
    'pr-comment': ['Bash(gh pr comment:*)'],
    'label-write': ['Bash(gh pr edit:*)', 'Bash(gh issue edit:*)', 'Bash(gh label:*)'],
    'open-pr': ['Bash(gh pr create:*)'],
    'push-commits': ['Bash(git push:*)'],
  };
  for (const d of routine.tools.deny) (DENY_MAP[d] ?? []).forEach((t) => deny.add(t));
  if (!routine.tools.capabilities.includes('merge-pr')) deny.add('Bash(gh pr merge:*)'); // default-denied
  return { allow: [...allow], deny: [...deny], grants };
}

// Static connector check for `harness connectors` / lint: is everything a
// routine grants actually registered + authenticated?
export function connectorHealth(registry, { env = process.env } = {}) {
  return Object.values(registry).map((c) => {
    const needs = (c.auth?.env ?? []).filter((n) => !n.endsWith('?'));
    const missing = needs.filter((n) => !env[n]);
    return { id: c.id, kind: c.kind ?? 'mcp', detail: c.detail ?? '', events: c.events ?? [], ok: !missing.length, missing };
  });
}
