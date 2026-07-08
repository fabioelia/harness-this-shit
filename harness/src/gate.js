// Trigger `gate:` (docs/04 §2) — an external deterministic program admits or
// drops a matched event before a runner spins up. Exit 0 ⇒ proceed. The event
// envelope is fed as JSON on stdin and as HARNESS_EVENT; the routine dir is cwd.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

export function runGate(gatePath, envelope, { dir, timeoutMs = 60_000 } = {}) {
  return new Promise((res) => {
    const abs = resolve(dir || '.', gatePath);
    const json = JSON.stringify(envelope.payload ?? {});
    let child;
    try {
      child = spawn(abs, [], { cwd: dir, env: { ...process.env, HARNESS_EVENT: json.slice(0, 100_000), HARNESS_EVENT_TYPE: envelope.type ?? '' }, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return res({ pass: false, code: -1, detail: `gate spawn failed: ${e.message}` });
    }
    let out = '', err = '';
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); res({ pass: false, code: -1, detail: `gate not runnable: ${e.message}` }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      res({ pass: code === 0, code, detail: (out || err).trim().slice(0, 200) });
    });
    child.stdin.write(json);
    child.stdin.end();
  });
}
