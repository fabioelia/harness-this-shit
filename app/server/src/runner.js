// Executes a routine by spawning a real headless Claude instance (`claude -p`)
// and capturing its stdout. Runs in a neutral cwd so it doesn't load this repo's
// project context. This is the harness's data plane — the actual runner.
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';

export function runClaude(prompt, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    let child;
    try {
      child = spawn(CLAUDE_BIN, ['-p', prompt], {
        cwd: tmpdir(), // neutral cwd — don't pull in the harness repo's CLAUDE.md/tools
        env: process.env,
      });
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

/** Build the prompt for a routine firing on an event. */
export function buildPrompt(routine, event) {
  const body = (routine.prompt && routine.prompt.trim()) || `## Prompt\n${routine.summary || ''}`;
  return [
    body,
    '',
    '--- Trigger event payload (JSON) ---',
    JSON.stringify(event, null, 2),
    '',
    'Respond with ONLY the requested output — no preamble, no markdown, no quotes.',
  ].join('\n');
}
