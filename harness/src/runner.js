// The data plane: spawn a real headless Claude session (`claude -p`) with exactly
// the granted tool surface, streaming NDJSON events back to the caller. Ported
// from the Switchboard server's runner — the harness only routes and records.
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const claudeBin = () => process.env.CLAUDE_BIN || 'claude';   // resolved at spawn time (tests + config overrides)
export const TOOLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools');

export function runClaude(prompt, {
  timeoutMs = 240_000, allow = [], deny = [], onEvent, onChild,
  model, effort, cwd, mcpConfig, runId, extraEnv = {},
} = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    // --allowed-tools / --disallowed-tools are variadic → they come last and the
    // prompt is fed via stdin so it isn't swallowed. --strict-mcp-config keeps the
    // session clean: tools come only from what the harness grants.
    const args = ['-p', '--strict-mcp-config', '--output-format', 'stream-json', '--verbose'];
    if (mcpConfig) args.push('--mcp-config', mcpConfig);
    if (model) args.push('--model', model);
    if (effort) args.push('--effort', effort);
    if (deny.length) args.push('--disallowed-tools', ...deny);
    if (allow.length) args.push('--allowed-tools', ...allow);
    const env = { ...process.env, ...extraEnv, PATH: `${TOOLS_DIR}:${process.env.PATH}`, ...(runId ? { HARNESS_RUN_ID: runId } : {}) };
    const fail = (msg) => resolve({ finalText: '', stderr: msg, code: -1, ms: Date.now() - start, isError: true, costUsd: null, numTurns: null, usage: null, sessionId: '', events: 0 });

    let child;
    try {
      child = spawn(claudeBin(), args, { cwd: cwd || tmpdir(), env, stdio: ['pipe', 'pipe', 'pipe'] });
      try { onChild?.(child); } catch { /* registration must not kill the run */ }
      child.stdin.write(prompt);
      child.stdin.end();
    } catch (e) {
      return fail(`spawn failed: ${e.message}`);
    }

    let buf = '', raw = '', err = '', killed = false, nEvents = 0, resultEvt = null;
    const MAX_LINE = 1_000_000;
    const handleLine = (line) => {
      if (!line.trim()) return;
      let o;
      try { o = JSON.parse(line); } catch { raw += line + '\n'; return; }
      if (o.type === 'result') resultEvt = o;
      nEvents++;
      try { onEvent?.(o); } catch { /* a consumer error must not kill the run */ }
    };
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (d) => {
      buf += d;
      if (buf.length > MAX_LINE && !buf.includes('\n')) { raw += buf; buf = ''; return; }
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); handleLine(line); }
    });
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); fail(`claude not runnable: ${e.message}`); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (buf.trim()) handleLine(buf);
      const finalText = (resultEvt?.result ?? raw).trim();
      resolve({
        finalText,
        isError: resultEvt ? !!resultEvt.is_error : (killed || code !== 0),
        timedOut: killed,
        costUsd: resultEvt?.total_cost_usd ?? null,
        numTurns: resultEvt?.num_turns ?? null,
        usage: resultEvt?.usage ?? null,
        sessionId: resultEvt?.session_id ?? '',
        stderr: err.trim(), code: killed ? 124 : code, ms: Date.now() - start,
        events: nEvents,
      });
    });
  });
}

// Normalize stream-json into compact trace events for the .harness log.
export function traceAdapter(put) {
  const toolById = new Map();
  return (o) => {
    try {
      if (o.type === 'system' && o.subtype === 'init') put('system', null, null, { model: o.model, tools: (o.tools ?? []).length, permissionMode: o.permissionMode });
      else if (o.type === 'assistant') {
        for (const b of o.message?.content ?? []) {
          if (b.type === 'text' && b.text?.trim()) put('text', null, null, b.text);
          else if (b.type === 'tool_use') { toolById.set(b.id, b.name); put('tool_use', b.name, null, b.input ?? {}); }
        }
      } else if (o.type === 'user') {
        for (const b of o.message?.content ?? []) {
          if (b.type === 'tool_result') {
            const content = Array.isArray(b.content) ? b.content.map((c) => c.text ?? '').join('') : b.content;
            put('tool_result', toolById.get(b.tool_use_id) ?? null, !b.is_error, content ?? '');
          }
        }
      }
    } catch { /* one malformed event must not kill the run */ }
  };
}
