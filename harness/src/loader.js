// Load a folder of routine .md files into validated Routine objects.
// The folder IS the config: *.md with front matter are routines, connectors.yaml
// is the connector registry, harness.yaml is harness config, .harness is the log.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import YAML from 'yaml';
import { parseRoutineFile, splitFrontMatter, parseBody } from './frontmatter.js';
import { normalizeRoutine, lintFleet } from './schema.js';
import { deepMerge } from './util.js';

// Built-in connector catalog (docs/06 §2) — overridable/extendable via connectors.yaml.
// Secrets are env-var NAMES, resolved at run start and never logged.
export const BUILTIN_CONNECTORS = {
  github: { id: 'github', kind: 'native', events: ['pull_request', 'push', 'label', 'issue_comment', 'issues', 'pull_request_review', 'check_run', 'check_suite', 'release', 'workflow_run', 'deployment_status', 'status'], auth: { env: ['GH_TOKEN?'] }, detail: 'gh CLI (uses your gh auth)' },
  slack: { id: 'slack', kind: 'native', events: ['message', 'mention', 'reaction'], auth: { env: ['SLACK_BOT_TOKEN'] }, detail: 'slack-post tool + Web API' },
  web: { id: 'web', kind: 'native', events: [], auth: { env: [] }, detail: 'WebFetch / WebSearch' },
  atlassian: { id: 'atlassian', kind: 'mcp', transport: 'stdio', events: ['issue_created', 'issue_transitioned', 'comment_added'], config: { command: 'npx', args: ['-y', 'mcp-remote', 'https://mcp.atlassian.com/v1/sse'] }, auth: { env: [] }, detail: 'Atlassian remote MCP (Jira + Confluence, OAuth on first run)' },
  jira: { id: 'jira', kind: 'mcp', transport: 'stdio', events: ['issue_created', 'issue_transitioned', 'comment_added'], config: { command: 'npx', args: ['-y', 'mcp-remote', 'https://mcp.atlassian.com/v1/sse'] }, auth: { env: [] }, detail: 'alias of atlassian' },
};

export function loadConnectors(dir) {
  const registry = { ...BUILTIN_CONNECTORS };
  for (const f of ['connectors.yaml', 'connectors.yml']) {
    const p = join(dir, f);
    if (!existsSync(p)) continue;
    const doc = YAML.parse(readFileSync(p, 'utf8')) ?? {};
    const list = Array.isArray(doc) ? doc : Array.isArray(doc.connectors) ? doc.connectors : Object.entries(doc).map(([id, v]) => ({ id, ...v }));
    for (const c of list) {
      if (!c?.id) continue;
      registry[c.id] = { kind: 'mcp', events: [], auth: { env: [] }, ...registry[c.id], ...c };
    }
    break;
  }
  return registry;
}

export function loadConfig(dir) {
  const defaults = { port: 7717, model: '', tick_seconds: 20, flow_tick_seconds: 45, dedupe_window: '1h', secrets: {} };
  for (const f of ['harness.yaml', 'harness.yml']) {
    const p = join(dir, f);
    if (existsSync(p)) return { ...defaults, ...(YAML.parse(readFileSync(p, 'utf8')) ?? {}) };
  }
  return defaults;
}

const isRoutineCandidate = (name) => /\.md$/i.test(name) && !/^readme\.md$/i.test(name);

// extends: inherit front matter from a template file (per-field override);
// includes: body fragments stitched in before the prompt. Both resolved relative
// to the routine's own file, one level of extends (a template may not extend).
function resolveMeta(meta, filePath, errors) {
  if (!meta?.extends) return meta;
  const tplPath = resolve(dirname(filePath), String(meta.extends));
  try {
    const { meta: tplMeta } = splitFrontMatter(readFileSync(tplPath, 'utf8'));
    if (tplMeta?.extends) errors.push(`extends: template ${meta.extends} may not itself extend`);
    const merged = deepMerge(tplMeta ?? {}, meta);
    delete merged.extends;
    return merged;
  } catch (e) {
    errors.push(`extends: cannot read ${meta.extends} — ${e.message}`);
    return meta;
  }
}

function resolveIncludes(routine, body, filePath, errors) {
  if (!routine.includes.length) return body;
  const parts = [];
  for (const inc of routine.includes) {
    try {
      const raw = readFileSync(resolve(dirname(filePath), inc), 'utf8');
      parts.push(splitFrontMatter(raw).body.trim()); // fragments may carry their own front matter; only the body is stitched
    } catch (e) {
      errors.push(`includes: cannot read ${inc} — ${e.message}`);
    }
  }
  return parts.length ? `${parts.join('\n\n')}\n\n${body}` : body;
}

export function loadDir(dir) {
  const abs = resolve(dir);
  const connectors = loadConnectors(abs);
  const config = loadConfig(abs);
  const connectorIds = new Set(Object.keys(connectors));
  const routines = [], failures = [], skipped = [];

  const entries = readdirSync(abs).filter((n) => !n.startsWith('.')).sort();
  for (const name of entries) {
    const p = join(abs, name);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) continue; // shared fragments/templates live in subdirs, referenced by includes/extends
    if (!isRoutineCandidate(name)) continue;
    let raw;
    try { raw = readFileSync(p, 'utf8'); } catch (e) { failures.push({ file: name, errors: [e.message] }); continue; }

    let parsed;
    try { parsed = parseRoutineFile(raw); } catch (e) { failures.push({ file: name, errors: [e.message] }); continue; }
    if (parsed.meta == null || !Object.keys(parsed.meta).length) { skipped.push({ file: name, reason: 'no front matter' }); continue; }

    const preErrors = [];
    const meta = resolveMeta(parsed.meta, p, preErrors);
    const { routine, errors, warnings } = normalizeRoutine(meta, { file: name, connectorIds });
    if (!routine) { failures.push({ file: name, errors: [...preErrors, ...errors] }); continue; }

    const body = resolveIncludes(routine, parsed.body, p, preErrors);
    const { prompt, handlers } = parseBody(body);
    routines.push({ ...routine, file: name, path: p, body, prompt, handlers, warnings: [...warnings], loadErrors: preErrors });
  }

  // duplicate slugs are fatal for the duplicates (first one wins)
  const seen = new Map();
  const deduped = [];
  for (const r of routines) {
    if (seen.has(r.slug)) failures.push({ file: r.file, errors: [`slug "${r.slug}" already defined by ${seen.get(r.slug)}`] });
    else { seen.set(r.slug, r.file); deduped.push(r); }
  }

  const fleetWarnings = lintFleet(deduped);
  return { dir: abs, routines: deduped, failures, skipped, connectors, config, fleetWarnings };
}
