// Executes a routine by spawning a real headless Claude instance (`claude -p`)
// and capturing its stdout. Runs in a neutral cwd so it doesn't load this repo's
// project context. This is the harness's data plane — the actual runner.
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const TOOLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools');

// Map granted connectors → the concrete tools the auto-mode session may use.
export function allowedToolsFor(connectors = []) {
  const allow = [];
  if (connectors.includes('github')) allow.push('Bash(gh:*)');
  if (connectors.includes('slack')) allow.push('Bash(slack-post:*)');
  if (connectors.includes('web') || connectors.includes('webfetch')) allow.push('WebFetch', 'WebSearch');
  // MCP-backed connectors (anything else) get their namespaced tools enabled too
  connectors
    .filter((c) => !['github', 'slack', 'web', 'webfetch'].includes(c))
    .forEach((c) => allow.push(`mcp__${c}__*`));
  return allow;
}

export function runClaude(prompt, { timeoutMs = 240_000, tools = [] } = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    const allow = allowedToolsFor(tools);
    // --allowed-tools is variadic, so it must come last (each tool a separate arg)
    // and the prompt is fed via stdin so it isn't swallowed by the variadic.
    // --strict-mcp-config with no --mcp-config = no global MCP servers loaded
    // (keeps the session clean/fast; tools come only from what we grant).
    const args = ['-p', '--strict-mcp-config'];
    if (allow.length) args.push('--allowed-tools', ...allow);
    // tools dir on PATH so `slack-post` (and future tool scripts) resolve by name
    const env = { ...process.env, PATH: `${TOOLS_DIR}:${process.env.PATH}` };
    let child;
    try {
      child = spawn(CLAUDE_BIN, args, { cwd: tmpdir(), env, stdio: ['pipe', 'pipe', 'pipe'] });
      child.stdin.write(prompt);
      child.stdin.end();
    } catch (e) {
      return resolve({ output: '', stderr: `spawn failed: ${e.message}`, code: -1, ms: Date.now() - start });
    }
    let out = '';
    let err = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ output: '', stderr: `claude not runnable: ${e.message}`, code: -1, ms: Date.now() - start });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        output: out.trim(),
        stderr: err.trim(),
        code: killed ? 124 : code,
        ms: Date.now() - start,
      });
    });
  });
}

/** Assemble the session input: the routine's natural instruction + the live
 *  trigger context + the tools it may use. No output-format contract — the
 *  session does whatever the instruction needs and takes the actions itself. */
export function buildPrompt(routine, event) {
  const tools = Array.isArray(routine.connectors)
    ? routine.connectors
    : (() => { try { return JSON.parse(routine.connectors || '[]'); } catch { return []; } })();
  const repo = typeof event?.repository === 'object' ? event.repository.full_name : event?.repository;
  const lines = [
    (routine.prompt && routine.prompt.trim()) || routine.summary || '',
    '',
    '## Trigger',
    `This routine fired on a "${event?.event || event?.type || 'event'}"${repo ? ` in ${repo}` : ''}. Full event payload:`,
    '```json',
    JSON.stringify(event ?? {}, null, 2),
    '```',
  ];
  if (tools.length) {
    const how = [];
    if (tools.includes('github')) how.push('- GitHub: use the `gh` CLI, always with `--repo OWNER/REPO`. e.g. `gh pr list --repo acme/x --head my-branch --state open --json number,title,url` or `gh pr view N --repo acme/x --json title`.');
    if (tools.includes('slack')) how.push("- Slack: to post a message, RUN the shell command `slack-post '#channel-or-@user' 'your message'` — it is on your PATH and already authenticated as the bot. This IS your Slack tool; do NOT look for a Slack MCP server.");
    if (tools.includes('web') || tools.includes('webfetch')) how.push('- Web: use WebFetch / WebSearch to read pages.');
    tools.filter((c) => !['github', 'slack', 'web', 'webfetch'].includes(c)).forEach((c) => how.push(`- ${c}: use its mcp__${c}__* tools.`));
    lines.push('', '## Tools you have', 'You are an autonomous session — take the actions the instruction calls for, don’t just describe them.', ...how);
  }
  lines.push('', 'Carry out the instruction now using the trigger context and your tools. End with a one-line summary of what you did.');
  return lines.join('\n');
}
