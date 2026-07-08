// The harness CLI. Every command targets a routines FOLDER (default: cwd) whose
// single .harness file is both the log and the source of status.
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadDir } from './loader.js';
import { Daemon } from './daemon.js';
import { loadState, isDaemonAlive } from './state.js';
import { replay, follow, logPath } from './log.js';
import { HarnessLog } from './log.js';
import { Dispatcher, validateInputs } from './dispatch.js';
import { FlowManager } from './flow.js';
import { fromManual } from './events.js';
import { triggerMatches } from './match.js';
import { connectorHealth } from './mcp.js';
import { nextCronFire, validTz } from './cron.js';
import { iso, truncate } from './util.js';

const C = { reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m', cyan: '\x1b[36m' };
const color = (c, s) => (process.stdout.isTTY ? `${C[c]}${s}${C.reset}` : String(s));

function parseArgs(argv) {
  const args = { _: [], input: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input' || a === '-i') {
      const [k, ...v] = String(argv[++i] ?? '').split('=');
      if (k) args.input[k] = v.join('=');
    } else if (a === '--follow' || a === '-f') args.follow = true;
    else if (a === '--json') args.json = true;
    else if (a === '--by') args.by = argv[++i];
    else if (a === '--port') args.port = parseInt(argv[++i], 10);
    else if (a.startsWith('--')) args[a.slice(2)] = true;
    else args._.push(a);
  }
  return args;
}

const EV_COLORS = {
  'harness.up': 'green', 'harness.down': 'yellow', 'run.start': 'blue', 'run.done': 'green',
  'run.skip': 'dim', 'run.error': 'red', 'routine.error': 'red', 'lint.warn': 'yellow',
  'event.received': 'cyan', 'budget.exhausted': 'red', 'barrier.stale': 'yellow',
  'flow.reaction': 'cyan', 'approval.granted': 'green', 'run.pending': 'yellow',
};
function prettyLine(e) {
  const { t, ev, ...rest } = e;
  const c = EV_COLORS[ev] ?? (ev.startsWith('wire.') ? 'dim' : ev === 'run.done' && !rest.ok ? 'red' : 'reset');
  const kv = Object.entries(rest)
    .filter(([k]) => !['seq', 'text'].includes(k) || rest.type)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' ');
  return `${color('dim', t.slice(11, 19))} ${color(c, ev.padEnd(20))} ${truncate(kv, 220)}`;
}

async function daemonCall(dir, method, path, body) {
  const st = loadState(dir);
  if (!isDaemonAlive(st)) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${st.up.port}${path}`, {
      method, headers: { 'content-type': 'application/json', ...(process.env.HARNESS_API_TOKEN ? { authorization: `Bearer ${process.env.HARNESS_API_TOKEN}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return await res.json();
  } catch { return null; }
}

const dirOf = (args, idx = 0) => resolve(args._[idx] ?? '.');

export async function main(argv) {
  const [cmd, ...rest] = argv;
  const args = parseArgs(rest);

  switch (cmd) {
    case 'up': {
      const dir = dirOf(args);
      if (!existsSync(dir)) { console.error(`no such directory: ${dir}`); process.exit(1); }
      const daemon = new Daemon(dir, { port: args.port, mirror: (e) => console.log(prettyLine(e)) });
      if (daemon.failures.length) {
        for (const f of daemon.failures) console.error(color('red', `✗ ${f.file}: ${f.errors.join('; ')}`));
      }
      if (!daemon.routines.length) { console.error('no routines loaded — nothing to do'); process.exit(1); }
      await daemon.up();
      console.log(color('bold', `\nharness up — ${daemon.routines.length} routine(s) wired · http :${daemon.port} · log ${logPath(dir)}\n`));
      return;
    }

    case 'validate': {
      const dir = dirOf(args);
      const { routines, failures, skipped, fleetWarnings } = loadDir(dir);
      for (const r of routines) {
        const flag = r.warnings.length ? color('yellow', '⚠') : color('green', '✓');
        console.log(`${flag} ${r.file} → ${color('bold', r.slug)} (${r.on.map((t) => t.type).join(', ') || 'no triggers'})`);
        for (const w of r.warnings) console.log(`   ${color('yellow', w)}`);
      }
      for (const w of fleetWarnings) console.log(`${color('yellow', '⚠')} fleet: [${w.slug}] ${w.msg}`);
      for (const s of skipped) console.log(`${color('dim', `- ${s.file}: ${s.reason}`)}`);
      for (const f of failures) console.log(`${color('red', `✗ ${f.file}: ${f.errors.join('; ')}`)}`);
      console.log(`\n${routines.length} valid, ${failures.length} failed, ${skipped.length} skipped`);
      process.exit(failures.length ? 1 : 0);
      return;
    }

    case 'list': {
      const dir = dirOf(args);
      const { routines } = loadDir(dir);
      if (args.json) return console.log(JSON.stringify(routines.map((r) => ({ slug: r.slug, name: r.name, owner: r.owner, enabled: r.enabled, on: r.on, mcp: r.tools.mcp })), null, 2));
      for (const r of routines) {
        const trig = r.on.map((t) => t.config.cron ?? t.config.event ?? t.config.id ?? t.config.routine ?? t.type).map((s) => `[${s}]`).join(' ');
        console.log(`${r.enabled ? color('green', '●') : color('dim', '○')} ${color('bold', r.slug.padEnd(28))} ${trig}  ${color('dim', `mcp:${r.tools.mcp.join(',') || '—'} owner:${r.owner || '—'}`)}`);
      }
      return;
    }

    case 'run': {
      const slug = args._[0];
      if (!slug) { console.error('usage: harness run <slug> [dir] [--input k=v]…'); process.exit(1); }
      const dir = dirOf(args, 1);
      // daemon running → dispatch through it (one lease authority); else one-shot local
      const viaDaemon = await daemonCall(dir, 'POST', `/api/routines/${slug}/run`, { inputs: args.input, by: process.env.USER ?? 'cli' });
      if (viaDaemon) { console.log(JSON.stringify(viaDaemon, null, 2)); process.exit(viaDaemon.ok || viaDaemon.pending ? 0 : 1); }

      const loaded = loadDir(dir);
      const routine = loaded.routines.find((r) => r.slug === slug);
      if (!routine) { console.error(`no routine "${slug}" in ${dir}`); process.exit(1); }
      const log = new HarnessLog(loaded.dir, { mirror: (e) => console.log(prettyLine(e)) });
      const state = loadState(loaded.dir);
      const d = new Dispatcher({ dir: loaded.dir, log, state, routines: loaded.routines, registry: loaded.connectors, config: loaded.config });
      d.flow = new FlowManager(d);
      const { values, errors } = validateInputs(routine, args.input);
      if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
      const env = fromManual(values, process.env.USER ?? 'cli');
      const trigger = routine.on.find((t) => triggerMatches(routine, t, env)) ?? null;
      const res = await d.dispatch(routine, trigger, env, { inputs: values });
      console.log(`\n${res.ok ? color('green', '✓ succeeded') : res.pending ? color('yellow', '… pending approval') : res.skipped ? color('yellow', `– skipped: ${res.reason}`) : color('red', '✗ failed')}${res.summary ? ` — ${truncate(res.summary, 400)}` : ''}`);
      process.exit(res.ok || res.pending || res.skipped ? 0 : 1);
      return;
    }

    case 'status': {
      const dir = dirOf(args);
      const live = await daemonCall(dir, 'GET', '/api/status');
      const st = loadState(dir);
      if (args.json) return console.log(JSON.stringify(live ?? { offline: true, runs: [...st.runs.entries()].slice(-25) }, null, 2));
      const alive = isDaemonAlive(st);
      console.log(`${alive ? color('green', '● harness up') : color('red', '○ harness down')} ${st.up ? color('dim', `pid ${st.up.pid} · port ${st.up.port} · since ${st.up.t}`) : ''}\n`);
      const { routines, failures } = loadDir(dir);
      for (const r of routines) {
        const cronT = r.on.find((t) => t.type === 'schedule' && t.config.cron);
        const next = cronT ? nextCronFire(cronT.config.cron, validTz(cronT.config.tz) ? cronT.config.tz : null) : null;
        const lastRun = [...st.runs.values()].filter((x) => x.slug === r.slug).pop();
        console.log(`${r.enabled ? color('green', '●') : color('dim', '○')} ${r.slug.padEnd(28)} ${(lastRun ? `${lastRun.status} ${color('dim', lastRun.finished ?? lastRun.started ?? '')}` : color('dim', 'never ran')).padEnd(45)} ${next ? color('dim', `next ${iso(next.getTime())}`) : ''}`);
      }
      for (const f of failures) console.log(color('red', `✗ ${f.file}: ${f.errors[0]}`));
      const pend = [...st.approvals.entries()].filter(([, a]) => a.status === 'pending');
      if (pend.length) { console.log(`\n${color('yellow', 'pending approval:')}`); pend.forEach(([id, a]) => console.log(`  ${id} ${a.slug} (approvers: ${a.approvers.join(', ') || 'anyone'}) → harness approve ${id}`)); }
      const nh = [...st.needsHuman.entries()];
      if (nh.length) { console.log(`\n${color('red', 'needs-human (budget exhausted):')}`); nh.forEach(([k, v]) => console.log(`  ${k} (${v.slug}) → harness budget-reset ${k}`)); }
      const flows = [...st.flows.entries()].filter(([, f]) => f.status === 'open');
      if (flows.length) { console.log(`\n${color('cyan', 'open PR subscriptions:')}`); flows.forEach(([id, f]) => console.log(`  ${id} ${f.slug} watching ${f.repo}#${f.pr}`)); }
      const spend = st.spendByDay.get(new Date().toISOString().slice(0, 10)) ?? 0;
      console.log(`\n${color('dim', `runs logged: ${st.runs.size} · spend today: $${spend.toFixed(2)} · log: ${logPath(dir)}`)}`);
      return;
    }

    case 'logs': {
      const dir = dirOf(args);
      const entries = replay(dir);
      const filtered = args.run ? entries.filter((e) => e.run === args.run) : entries;
      for (const e of filtered.slice(args.follow ? -20 : -400)) console.log(args.json ? JSON.stringify(e) : prettyLine(e));
      if (args.follow) follow(dir, (e) => console.log(args.json ? JSON.stringify(e) : prettyLine(e)));
      return;
    }

    case 'approve': case 'deny': {
      const runId = args._[0];
      if (!runId) { console.error(`usage: harness ${cmd} <run-id> [dir] [--by name]`); process.exit(1); }
      const dir = dirOf(args, 1);
      const by = args.by ?? process.env.USER ?? 'cli';
      const viaDaemon = await daemonCall(dir, 'POST', `/api/${cmd}/${runId}`, { by });
      if (viaDaemon) return console.log(JSON.stringify(viaDaemon, null, 2));
      // offline: resolve against the replayed approval, executing locally
      const loaded = loadDir(dir);
      const log = new HarnessLog(loaded.dir, { mirror: (e) => console.log(prettyLine(e)) });
      const state = loadState(loaded.dir);
      const a = state.approvals.get(runId);
      if (!a || a.status !== 'pending') { console.error(`no pending approval for ${runId}`); process.exit(1); }
      if (cmd === 'deny') { log.append('approval.denied', { run: runId, by }); return console.log('denied'); }
      log.append('approval.granted', { run: runId, by });
      const d = new Dispatcher({ dir: loaded.dir, log, state, routines: loaded.routines, registry: loaded.connectors, config: loaded.config });
      d.flow = new FlowManager(d);
      const routine = d.bySlug(a.slug);
      if (!routine) { console.error(`routine ${a.slug} not loaded`); process.exit(1); }
      const res = await d.dispatch(routine, null, a.event, { inputs: a.inputs ?? {}, approved: true });
      console.log(res.ok ? color('green', '✓ succeeded') : color('red', `✗ ${res.reason ?? 'failed'}`));
      return;
    }

    case 'budget-reset': {
      const key = args._[0];
      if (!key) { console.error('usage: harness budget-reset <key> [dir]'); process.exit(1); }
      const dir = dirOf(args, 1);
      const viaDaemon = await daemonCall(dir, 'POST', '/api/budget-reset', { key, by: process.env.USER ?? 'cli' });
      if (viaDaemon) return console.log(JSON.stringify(viaDaemon));
      new HarnessLog(dir).append('budget.reset', { key, by: process.env.USER ?? 'cli' });
      return console.log('reset (applies on next daemon boot or immediately if daemon replays)');
    }

    case 'connectors': {
      const dir = dirOf(args);
      const { connectors, routines } = loadDir(dir);
      for (const c of connectorHealth(connectors)) {
        const usedBy = routines.filter((r) => r.tools.mcp.includes(c.id) || r.on.some((t) => t.type === c.id)).map((r) => r.slug);
        console.log(`${c.ok ? color('green', '●') : color('red', '○')} ${c.id.padEnd(14)} ${c.kind.padEnd(7)} ${color('dim', (c.detail || '').padEnd(52))} ${c.missing.length ? color('red', `missing env: ${c.missing.join(',')}`) : ''}${usedBy.length ? color('dim', ` used by: ${usedBy.join(', ')}`) : ''}`);
      }
      return;
    }

    case 'stop': {
      const dir = dirOf(args);
      const viaDaemon = await daemonCall(dir, 'POST', '/api/stop', {});
      if (viaDaemon) return console.log('stopping');
      const st = loadState(dir);
      if (st.up?.pid && isDaemonAlive(st)) { process.kill(st.up.pid, 'SIGTERM'); return console.log(`sent SIGTERM to ${st.up.pid}`); }
      return console.log('harness is not running');
    }

    case 'init': {
      const dir = dirOf(args);
      mkdirSync(dir, { recursive: true });
      const routine = join(dir, 'hello.md');
      if (!existsSync(routine)) writeFileSync(routine, `---\nname: Hello Harness\nsummary: Prove the wiring works — say hello on a schedule.\nowner: ${process.env.USER ?? 'me'}\non:\n  - schedule: { every: 30m }\n  - manual: {}\ntools:\n  mcp: [web]\nruntime:\n  timeout: 3m\n---\n## Prompt\n\nSay hello, note the current date, and end with a one-line status.\n`);
      const conn = join(dir, 'connectors.yaml');
      if (!existsSync(conn)) writeFileSync(conn, `# Connector registry (docs/06). Builtins: github, slack, web, atlassian/jira.\n# Add your own MCP servers here:\n#\n# sentry:\n#   kind: mcp\n#   config: { command: npx, args: [-y, "@sentry/mcp-server"], env: { SENTRY_AUTH_TOKEN: "$SENTRY_AUTH_TOKEN" } }\n#   events: [issue]\n`);
      console.log(`initialized ${dir} — try: harness validate ${dir} && harness run hello-harness ${dir}`);
      return;
    }

    default:
      console.log(`harness — headless control plane for Claude Code routines

usage:
  harness up [dir] [--port N]          load routines, wire triggers, stay resident
  harness validate [dir]               parse + schema-check + lint every .md
  harness list [dir]                   the fleet at a glance
  harness run <slug> [dir] [-i k=v]    dispatch one routine now (typed inputs)
  harness status [dir]                 wiring, runs, approvals, flows (from .harness)
  harness logs [dir] [-f] [--run id]   pretty-print / follow the .harness log
  harness approve|deny <run> [dir]     resolve a policy approval gate
  harness budget-reset <key> [dir]     clear a needs-human iteration budget
  harness connectors [dir]             connector registry + auth health
  harness stop [dir]                   graceful shutdown of the resident daemon
  harness init [dir]                   scaffold a starter routine + connectors.yaml

The folder is the config: *.md files with YAML front matter (docs/02 spec) are
routines; connectors.yaml registers MCPs; harness.yaml tunes the daemon. The
single .harness file in the folder is the append-only log of everything.`);
      process.exit(cmd ? 1 : 0);
  }
}
