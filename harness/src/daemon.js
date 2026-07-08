// `harness up <dir>` — the resident control plane. Reads the folder of routine
// .md files, wires every trigger (internal cron, webhook listener, after-chains,
// flow reconciliation), and appends every wiring action and run to the single
// .harness file. Kill it and `harness up` again: state rebuilds from the log.
import { loadDir } from './loader.js';
import { HarnessLog } from './log.js';
import { loadState, staleRuns } from './state.js';
import { Dispatcher, validateInputs } from './dispatch.js';
import { FlowManager } from './flow.js';
import { matchFleet, triggerMatches } from './match.js';
import { fromSchedule } from './events.js';
import { cronMatches, minuteStamp, nextCronFire, validTz } from './cron.js';
import { connectorHealth } from './mcp.js';
import { startHttp } from './http.js';
import { renderTemplate, buildContext } from './template.js';
import { durationMs, now, iso, truncate, rid } from './util.js';

const VERSION = '0.1.0';

export class Daemon {
  // `http: false` embeds the daemon in a host process (the Fleet app) that serves
  // its own API — no listener is started and shutdown doesn't exit the process.
  constructor(dir, { mirror = null, port = null, http = true, configOverrides = {} } = {}) {
    const loaded = loadDir(dir);
    this.dir = loaded.dir;
    this.routines = loaded.routines;
    this.failures = loaded.failures;
    this.skipped = loaded.skipped;
    this.registry = loaded.connectors;
    this.config = { ...loaded.config, ...configOverrides };
    this.fleetWarnings = loaded.fleetWarnings;
    this.http = http;
    this.port = port ?? this.config.port;
    this.log = new HarnessLog(this.dir, { mirror });
    this.state = loadState(this.dir);
    this.dispatcher = new Dispatcher({ dir: this.dir, log: this.log, state: this.state, routines: this.routines, registry: this.registry, config: this.config });
    this.dispatcher.emitEnvelope = (env) => this.ingest(env);
    this.dispatcher.flow = new FlowManager(this.dispatcher);
    this.webhookTriggers = new Map();   // webhook id → {slug, secretRef}
    this.everyLast = new Map();         // `${slug}|${idx}` → last interval fire ts
    this.debounces = new Map();         // debounce key → {timer, envelope, pair}
    this.timers = [];
    this.stopping = false;
  }

  // Re-read the folder after a file was written/deleted (the app's CRUD path).
  // Routine array identity is preserved so the dispatcher sees the new fleet.
  reload() {
    const loaded = loadDir(this.dir);
    this.routines.splice(0, this.routines.length, ...loaded.routines);
    this.failures = loaded.failures;
    this.skipped = loaded.skipped;
    this.fleetWarnings = loaded.fleetWarnings;
    Object.assign(this.registry, loaded.connectors);
    for (const k of Object.keys(this.registry)) if (!(k in loaded.connectors)) delete this.registry[k];
    this.webhookTriggers.clear();
    for (const r of this.routines) r.on.forEach((t) => {
      if (t.type === 'webhook') this.webhookTriggers.set(String(t.config.id), { slug: r.slug, secretRef: t.config.secret ?? null });
    });
    this.log.append('harness.reload', { routines: this.routines.length, failures: this.failures.length });
    return { routines: this.routines, failures: this.failures };
  }

  // ── boot ──
  async up() {
    // reap runs a dead daemon left "running" so the log stays honest
    for (const r of staleRuns(this.state, 0)) {
      this.log.append('run.done', { run: r.id, slug: r.slug, ok: false, ms: null, summary: 'reaped — previous harness process died mid-run' });
      const st = this.state.runs.get(r.id);
      if (st) st.status = 'failed';
    }

    if (this.http) {
      this.server = await startHttp(this, { port: this.port });
      if (!this.config.controlUrl) this.config.controlUrl = `http://127.0.0.1:${this.port}`;
    }
    this.log.append('harness.up', { dir: this.dir, version: VERSION, pid: process.pid, port: this.http ? this.port : null, embedded: !this.http || undefined, control_url: this.config.controlUrl ?? undefined, routines: this.routines.length });

    for (const f of this.failures) this.log.append('routine.error', { file: f.file, errors: f.errors });
    for (const s of this.skipped) this.log.append('routine.skipped', { file: s.file, reason: s.reason });
    for (const w of this.fleetWarnings) this.log.append('lint.warn', { slug: w.slug, msg: w.msg });

    for (const c of connectorHealth(this.registry)) {
      if (this.routines.some((r) => r.tools.mcp.includes(c.id) || r.on.some((t) => t.type === c.id))) {
        this.log.append('wire.connector', { connector: c.id, kind: c.kind, ok: c.ok, ...(c.missing.length ? { missing_env: c.missing } : {}), events: c.events });
      }
    }

    for (const r of this.routines) {
      this.log.append('routine.loaded', { slug: r.slug, file: r.file, name: r.name, owner: r.owner, enabled: r.enabled, warnings: r.warnings.length ? r.warnings : undefined });
      r.on.forEach((t, idx) => this.wireTrigger(r, t, idx));
      if (r.flow) this.log.append('wire.flow', { slug: r.slug, events: r.flow.subscribe.events, until: r.flow.subscribe.until, reconcile_ms: r.flow.subscribe.reconcileMs, reactions: r.flow.reactions.map((x) => x.do) });
      for (const m of r.tools.mcp) this.log.append('wire.grant', { slug: r.slug, grant: `mcp:${m}` });
      for (const c of r.tools.capabilities) this.log.append('wire.grant', { slug: r.slug, grant: `capability:${c}` });
      if (r.tools.deny.length) this.log.append('wire.deny', { slug: r.slug, deny: r.tools.deny });
    }

    this.recoverMissedCrons();

    const tickMs = Math.max(5, this.config.tick_seconds) * 1000;
    this.timers.push(setInterval(() => this.tickSchedules(), tickMs));
    this.timers.push(setInterval(() => this.dispatcher.flow.tick().catch(() => {}), Math.max(15, this.config.flow_tick_seconds) * 1000));
    this.timers.forEach((t) => t.unref?.());

    if (this.http) {
      const bye = (sig) => () => this.shutdown(sig);
      process.on('SIGINT', bye('SIGINT'));
      process.on('SIGTERM', bye('SIGTERM'));
    }
    return this;
  }

  wireTrigger(r, t, idx) {
    const base = { slug: r.slug, idx };
    if (t.type === 'schedule') {
      const c = t.config;
      if (c.cron) {
        if (c.tz && !validTz(c.tz)) this.log.append('lint.warn', { slug: r.slug, msg: `schedule.tz "${c.tz}" is not a valid IANA zone — using local time` });
        const next = nextCronFire(c.cron, validTz(c.tz) ? c.tz : null);
        this.log.append('wire.cron', { ...base, cron: c.cron, tz: c.tz ?? 'local', next: next ? iso(next.getTime()) : null, missed: c.missed ?? 'skip' });
      } else if (c.every != null) this.log.append('wire.every', { ...base, every_ms: durationMs(c.every), jitter_ms: durationMs(c.jitter) ?? 0 });
      else if (c.at) this.log.append('wire.at', { ...base, at: c.at, fired: this.state.oneShots.has(`${r.slug}|at:${c.at}`) });
    } else if (t.type === 'webhook') {
      const id = String(t.config.id);
      this.webhookTriggers.set(id, { slug: r.slug, secretRef: t.config.secret ?? null });
      this.log.append('wire.webhook', { ...base, id, path: `/webhooks/${id}`, signed: !!t.config.secret });
    } else if (t.type === 'github') {
      this.log.append('wire.github', { ...base, event: t.config.event, filters: Object.keys(t.config).filter((k) => k !== 'event'), guards: Object.keys(t.guards) });
    } else if (t.type === 'after') {
      this.log.append('wire.after', { ...base, upstream: t.config.routine, on: t.config.on });
    } else if (t.type === 'manual' || t.type === 'api') {
      this.log.append(`wire.${t.type}`, { ...base, ...(t.type === 'api' ? { path: `/api/routines/${r.slug}/dispatch` } : {}) });
    } else {
      this.log.append('wire.connector-event', { ...base, connector: t.type, event: t.config.event ?? '*', path: `/webhooks/connector/${t.type}` });
    }
  }

  // ── the event pipeline: ingest → match → guards (dedupe/debounce) → dispatch ──
  // Returns matched slugs AND pre-allocated run ids so an ingress endpoint can
  // answer synchronously while the dispatches proceed in the background.
  ingest(envelope) {
    if (this.stopping) return { matched: [], runs: [] };
    if (this.state.killSwitch) {
      this.log.append('event.rejected', { source: envelope.source, type: envelope.type, reason: 'kill switch engaged' });
      return { matched: [], runs: [], error: 'kill switch engaged' };
    }
    const pairs = matchFleet(this.routines, envelope);
    this.log.append('event.received', {
      source: envelope.source, type: envelope.type, repo: envelope.repo ?? undefined,
      resource: envelope.resource_key || undefined, matched: pairs.map((p) => p.routine.slug),
    });
    const runs = pairs.map((pair) => ({ slug: pair.routine.slug, runId: this.admitPair(pair, envelope) })).filter((x) => x.runId);
    return { matched: pairs.map((p) => p.routine.slug), runs };
  }

  admitPair({ routine, trigger }, envelope) {
    const g = trigger.guards;
    const ctx = () => buildContext({ event: envelope, runtime: routine.runtime });

    if (g.dedupe_key) {
      const key = `${routine.slug}|${renderTemplate(g.dedupe_key, ctx())}`;
      const windowMs = durationMs(g.dedupe_window ?? this.config.dedupe_window) ?? 3_600_000;
      const last = this.state.dedupe.get(key);
      if (last && now() - last < windowMs) {
        this.log.append('event.deduped', { slug: routine.slug, dedupe_key: key, last_fired: iso(last) });
        return null;
      }
      this.state.dedupe.set(key, now());
      this.log.append('event.fired', { slug: routine.slug, dedupe_key: key });
    }

    const runId = rid('run');
    const go = (env) => this.dispatcher
      .dispatch(routine, trigger, env, { chainPath: env.chainPath ?? [], id: runId })
      .catch((e) => this.log.append('run.error', { run: runId, slug: routine.slug, error: e.message }));

    if (g.debounce) {
      const ms = durationMs(g.debounce) ?? 30_000;
      const key = `${routine.slug}|${envelope.resource_key || envelope.type}`;
      const cur = this.debounces.get(key);
      if (cur) clearTimeout(cur.timer);
      const timer = setTimeout(() => { this.debounces.delete(key); go(envelope); }, ms);
      timer.unref?.();
      this.debounces.set(key, { timer, envelope });
      this.log.append('event.debounced', { slug: routine.slug, key, for_ms: ms });
      return runId;
    }
    go(envelope);
    return runId;
  }

  // ── schedules ──
  tickSchedules() {
    if (this.state.killSwitch) return;
    const d = new Date();
    for (const r of this.routines) {
      if (!r.enabled) continue;
      r.on.forEach((t, idx) => {
        if (t.type !== 'schedule') return;
        const c = t.config;
        const key = `${r.slug}|${idx}`;
        if (c.cron) {
          const tz = validTz(c.tz) ? c.tz : null;
          if (!cronMatches(c.cron, d, tz)) return;
          const stamp = minuteStamp(d, tz);
          if (this.state.lastCron.get(key) === stamp) return;
          this.state.lastCron.set(key, stamp);
          this.log.append('cron.fired', { slug: r.slug, idx, stamp, cron: c.cron });
          this.fireSchedule(r, t, { cron: c.cron, fired_at: d.toISOString() });
        } else if (c.every != null) {
          const ms = durationMs(c.every);
          const last = this.everyLast.get(key) ?? 0;
          if (now() - last < ms) return;
          this.everyLast.set(key, now());
          const jitter = Math.floor(Math.random() * (durationMs(c.jitter) ?? 0));
          setTimeout(() => this.fireSchedule(r, t, { every: c.every, fired_at: iso() }), jitter).unref?.();
          this.log.append('cron.fired', { slug: r.slug, idx, every: c.every, jitter_ms: jitter });
        } else if (c.at) {
          const at = Date.parse(c.at);
          const marker = `${r.slug}|at:${c.at}`;
          if (now() >= at && !this.state.oneShots.has(marker)) {
            this.state.oneShots.add(marker);
            this.log.append('cron.fired', { slug: r.slug, idx, at: c.at });
            this.fireSchedule(r, t, { at: c.at, fired_at: iso() });
          }
        }
      });
    }
  }

  fireSchedule(r, t, spec) {
    const env = fromSchedule(spec);
    this.dispatcher.dispatch(r, t, env, {}).catch((e) => this.log.append('run.error', { slug: r.slug, error: e.message }));
  }

  // missed-fire policy (docs/04 §5): run_once_on_recovery fires one catch-up run
  // if any cron minute matched while the harness was down.
  recoverMissedCrons() {
    const downSince = this.state.down ? Date.parse(this.state.down.t) : (this.state.up ? Date.parse(this.state.up.t) : null);
    if (!downSince) return;
    const from = Math.max(downSince, now() - 48 * 3_600_000);
    for (const r of this.routines) {
      r.on.forEach((t, idx) => {
        if (t.type !== 'schedule' || !t.config.cron || t.config.missed !== 'run_once_on_recovery') return;
        const tz = validTz(t.config.tz) ? t.config.tz : null;
        for (let ts = from - (from % 60_000); ts < now(); ts += 60_000) {
          const d = new Date(ts);
          if (!cronMatches(t.config.cron, d, tz)) continue;
          const stamp = minuteStamp(d, tz);
          if (this.state.lastCron.get(`${r.slug}|${idx}`) === stamp) break;   // already fired for that minute
          this.log.append('cron.recovered', { slug: r.slug, idx, missed_at: iso(ts) });
          this.fireSchedule(r, t, { cron: t.config.cron, fired_at: iso(ts), recovered: true });
          break;                                                             // one catch-up run, not a backfill
        }
      });
    }
  }

  // ── control-plane ops (shared by HTTP + one-shot CLI) ──
  async runNow(routine, envelope, inputs) {
    const { values, errors } = validateInputs(routine, inputs);
    if (errors.length) return { error: errors.join('; ') };
    const trigger = routine.on.find((t) => triggerMatches(routine, t, envelope)) ?? null;
    const res = await this.dispatcher.dispatch(routine, trigger, envelope, { inputs: values });
    return { run: res.id, ok: res.ok ?? false, skipped: res.skipped, pending: res.pending, reason: res.reason, summary: truncate(res.summary ?? '', 400) };
  }

  async resolveApproval(runId, grant, by) {
    const a = this.state.approvals.get(runId);
    if (!a || a.status !== 'pending') return { error: `no pending approval for ${runId}` };
    if (a.approvers?.length && !a.approvers.includes(by)) return { error: `"${by}" is not in approvers [${a.approvers.join(', ')}]` };
    if (!grant) {
      a.status = 'denied'; a.by = by;
      this.log.append('approval.denied', { run: runId, by });
      return { run: runId, denied: true };
    }
    a.status = 'granted'; a.by = by;
    this.log.append('approval.granted', { run: runId, by });
    const routine = this.dispatcher.bySlug(a.slug);
    if (!routine) return { error: `routine ${a.slug} no longer loaded` };
    const res = await this.dispatcher.dispatch(routine, null, a.event, { inputs: a.inputs ?? {}, approved: true });
    return { run: res.id, ok: res.ok ?? false, summary: truncate(res.summary ?? '', 400) };
  }

  statusView() {
    const runs = [...this.state.runs.entries()].slice(-25).map(([id, r]) => ({ id, ...r }));
    return {
      up: { pid: process.pid, port: this.port, dir: this.dir, version: VERSION, routines: this.routines.length },
      routines: this.routines.map((r) => ({
        slug: r.slug, name: r.name, owner: r.owner, enabled: r.enabled,
        triggers: r.on.map((t) => t.type + (t.config.cron ? `(${t.config.cron})` : t.config.event ? `(${t.config.event})` : '')),
        mcp: r.tools.mcp, capabilities: r.tools.capabilities, warnings: r.warnings,
      })),
      failures: this.failures,
      runs,
      pendingApprovals: [...this.state.approvals.entries()].filter(([, a]) => a.status === 'pending').map(([id, a]) => ({ run: id, slug: a.slug, approvers: a.approvers })),
      openFlows: [...this.state.flows.entries()].filter(([, f]) => f.status === 'open').map(([id, f]) => ({ flow: id, slug: f.slug, pr: `${f.repo}#${f.pr}` })),
      needsHuman: [...this.state.needsHuman.entries()].map(([key, v]) => ({ key, ...v })),
      spendToday: this.state.spendByDay.get(new Date().toISOString().slice(0, 10)) ?? 0,
    };
  }

  shutdown(reason) {
    if (this.stopping) return;
    this.stopping = true;
    for (const [id, child] of this.dispatcher.children) {
      try { child.kill('SIGKILL'); } catch { /* gone */ }
      this.log.append('run.done', { run: id, slug: this.state.runs.get(id)?.slug, ok: false, summary: `killed — harness shutdown (${reason})` });
    }
    this.timers.forEach(clearInterval);
    this.log.append('harness.down', { reason, pid: process.pid });
    this.server?.close();
    if (this.http) setTimeout(() => process.exit(0), 100).unref?.();
  }
}
