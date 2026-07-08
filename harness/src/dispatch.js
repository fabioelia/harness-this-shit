// The dispatcher (docs/03, docs/05): between "an event matched" and "a session
// runs" sits the admission pipeline — policy caps, approval gates, trigger
// gates, concurrency groups, claim-before-act leases, the SHA barrier,
// yield-to-human, and per-target iteration budgets. Two agents never touch the
// same resource at once; a non-converging loop terminates in needs-human.
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { rid, now, sleep, fmtDur, truncate } from './util.js';
import { renderTemplate, buildContext } from './template.js';
import { runGate } from './gate.js';
import { resolveSecrets } from './secrets.js';
import { buildMcpConfig, allowedTools } from './mcp.js';
import { makeWorkspace } from './checkout.js';
import { runClaude, traceAdapter } from './runner.js';
import { buildRunPrompt } from './prompt.js';
import { livePrHeadSha, ghLogin, prView, resolvePrFromBranch, slackPost } from './gh.js';
import { fromAfter } from './events.js';
import { upsertSurface } from './outputs.js';

const RETRY_DELAYS = [30_000, 120_000, 480_000, 900_000, 1_800_000];

export function validateInputs(routine, given = {}) {
  const values = {}, errors = [];
  for (const [name, spec] of Object.entries(routine.inputs)) {
    let v = given[name] ?? spec.default;
    if (v == null) {
      if (spec.required) errors.push(`input "${name}" is required`);
      continue;
    }
    if (spec.type === 'int') { v = parseInt(v, 10); if (Number.isNaN(v)) errors.push(`input "${name}" must be an int`); }
    else if (spec.type === 'number') { v = parseFloat(v); if (Number.isNaN(v)) errors.push(`input "${name}" must be a number`); }
    else if (spec.type === 'bool') v = v === true || v === 'true' || v === '1';
    else v = String(v);
    if (spec.type === 'choice' && spec.choices.length && !spec.choices.includes(String(v))) errors.push(`input "${name}" must be one of [${spec.choices.join(', ')}]`);
    values[name] = v;
  }
  for (const k of Object.keys(given)) if (!routine.inputs[k]) errors.push(`unknown input "${k}"`);
  return { values, errors };
}

export class Dispatcher {
  constructor({ dir, log, state, routines, registry, config }) {
    this.dir = dir;
    this.log = log;
    this.state = state;            // materialized from .harness replay (budgets, dedupe, approvals, …)
    this.routines = routines;
    this.registry = registry;
    this.config = config;
    this.leases = new Map();       // key → {runId, slug, sha, expiresAt}  (leases die with the process)
    this.groups = new Map();       // concurrency group → runId
    this.children = new Map();     // runId → child process (for cancel/shutdown)
    this.canceled = new Set();
    this.emitEnvelope = null;      // set by the daemon: routes after-chain events back through matching
    this.flow = null;              // set by the daemon: FlowManager for PR subscriptions
  }

  bySlug(slug) { return this.routines.find((r) => r.slug === slug); }

  stateDirFor(routine) {
    const d = join(this.dir, 'state', routine.slug);
    if (!existsSync(d)) {
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'memory.md'), `# ${routine.name} — memory\n\n(Persistent across runs. The index — keep it concise and link supporting files.)\n`);
    }
    return d;
  }

  // ── lease store ──
  acquireLease(key, runId, slug, sha, ttlMs) {
    const cur = this.leases.get(key);
    if (cur && cur.expiresAt > now() && cur.runId !== runId) return { ok: false, holder: cur.runId, expired: false };
    if (cur && cur.expiresAt <= now() && cur.runId !== runId) {
      this.leases.set(key, { runId, slug, sha, expiresAt: now() + ttlMs });
      return { ok: true, stolen: cur.runId };
    }
    this.leases.set(key, { runId, slug, sha, expiresAt: now() + ttlMs });
    return { ok: true };
  }
  releaseLease(key, runId) {
    if (this.leases.get(key)?.runId === runId) this.leases.delete(key);
  }

  cancel(runId) {
    this.canceled.add(runId);
    const c = this.children.get(runId);
    if (c) { try { c.kill('SIGKILL'); } catch { /* gone */ } return true; }
    return false;
  }

  // ── the admission pipeline + execution ──
  async dispatch(routine, trigger, envelope, { inputs = {}, approved = false, attempt = 0, chainPath = [], handler = null } = {}) {
    const id = rid('run');
    const label = trigger ? `${trigger.type}${trigger.type === 'schedule' && trigger.config.cron ? ` · ${trigger.config.cron}` : ''}` : envelope.source;
    const skip = (reason, ev = 'run.skip') => { this.log.append(ev, { run: id, slug: routine.slug, reason }); return { id, skipped: true, reason }; };

    if (!routine.enabled) return skip('disabled');

    // policy: per-day run cap
    if (routine.policy.maxRunsPerDay > 0) {
      const key = `${routine.slug}|${new Date().toISOString().slice(0, 10)}`;
      if ((this.state.runsByDay.get(key) ?? 0) >= routine.policy.maxRunsPerDay) return skip(`max_runs_per_day (${routine.policy.maxRunsPerDay}) reached`);
    }

    // policy: human approval gate — park the run; `harness approve <id>` resumes it
    if (routine.policy.requiresApproval && !approved) {
      this.log.append('run.pending', {
        run: id, slug: routine.slug, trigger: label, approvers: routine.policy.approvers,
        event: { ...envelope, payload: JSON.parse(truncate(JSON.stringify(envelope.payload ?? {}), 20_000).replace(/…$/, '') || '{}') },
        inputs,
      });
      this.state.approvals.set(id, { slug: routine.slug, approvers: routine.policy.approvers, status: 'pending', trigger: label, event: envelope, inputs });
      return { id, pending: true };
    }

    // trigger gate: external deterministic program admits or drops
    if (trigger?.guards.gate) {
      const g = await runGate(trigger.guards.gate, envelope, { dir: this.dir });
      this.log.append(g.pass ? 'gate.pass' : 'gate.block', { run: id, slug: routine.slug, gate: trigger.guards.gate, code: g.code, detail: g.detail });
      if (!g.pass) return skip(`gate ${trigger.guards.gate} exited ${g.code}`);
    }

    const ctx = buildContext({ event: envelope, inputs, runtime: routine.runtime, upstream: envelope.upstream });

    // concurrency group: runs sharing a resolved key serialize (or supersede)
    const group = routine.concurrency.group ? renderTemplate(routine.concurrency.group, ctx) : '';
    if (group) {
      const holder = this.groups.get(group);
      if (holder) {
        if (routine.concurrency.cancelInProgress) {
          this.log.append('group.superseded', { run: id, slug: routine.slug, group, canceled: holder });
          this.cancel(holder);
        } else {
          this.log.append('group.queued', { run: id, slug: routine.slug, group, behind: holder });
          const deadline = now() + 10 * 60_000;
          while (this.groups.get(group) && now() < deadline) await sleep(3000);
          if (this.groups.get(group)) return skip(`gave up queued behind ${group}`);
        }
      }
      this.groups.set(group, id);
    }
    const releaseGroup = () => { if (group && this.groups.get(group) === id) this.groups.delete(group); };

    // claim-before-act lease
    let leaseKey = '';
    if (routine.concurrency.lease) {
      leaseKey = renderTemplate(routine.concurrency.lease.resource, ctx);
      const { ttlMs, onConflict } = routine.concurrency.lease;
      let lease = this.acquireLease(leaseKey, id, routine.slug, envelope.sha, ttlMs);
      if (!lease.ok) {
        if (onConflict === 'skip') { releaseGroup(); this.log.append('lease.conflict', { run: id, slug: routine.slug, key: leaseKey, holder: lease.holder, action: 'skip' }); return skip(`stood down — ${leaseKey} held by ${lease.holder}`); }
        if (onConflict === 'coalesce') {
          releaseGroup();
          this.log.append('run.coalesced', { run: id, slug: routine.slug, key: leaseKey, into: lease.holder, reason: `handed to ${lease.holder}` });
          return { id, coalesced: true };
        }
        if (onConflict === 'steal-if-expired') { releaseGroup(); this.log.append('lease.conflict', { run: id, slug: routine.slug, key: leaseKey, holder: lease.holder, action: 'skip (not expired)' }); return skip(`lease ${leaseKey} live — not stealable`); }
        // queue
        this.log.append('lease.queued', { run: id, slug: routine.slug, key: leaseKey, holder: lease.holder });
        const deadline = now() + ttlMs;
        while (now() < deadline) { await sleep(3000); lease = this.acquireLease(leaseKey, id, routine.slug, envelope.sha, ttlMs); if (lease.ok) break; }
        if (!lease.ok) { releaseGroup(); return skip(`gave up waiting for ${leaseKey}`); }
      }
      this.log.append('lease.acquired', { run: id, slug: routine.slug, key: leaseKey, ttl_ms: ttlMs, ...(lease.stolen ? { stolen_from: lease.stolen } : {}) });
    }
    const releaseAll = () => { if (leaseKey) { this.releaseLease(leaseKey, id); this.log.append('lease.released', { run: id, key: leaseKey }); } releaseGroup(); };

    // SHA barrier: if the PR head moved past the sha this event was for, the work is stale
    if (routine.concurrency.barrier) {
      const expected = renderTemplate(routine.concurrency.barrier.staleIfShaChanged, ctx);
      const prm = (leaseKey || envelope.resource_key || '').match(/^pr:(.+)#(\d+)$/);
      if (expected && !expected.includes('${{') && prm) {
        const live = await livePrHeadSha(prm[1], prm[2]);
        if (live && live !== expected) {
          this.log.append('barrier.stale', { run: id, slug: routine.slug, key: `pr:${prm[1]}#${prm[2]}`, expected: expected.slice(0, 9), live: live.slice(0, 9) });
          releaseAll();
          return skip(`stale — head moved ${expected.slice(0, 7)}→${live.slice(0, 7)}`);
        }
      }
    }

    // yield to humans: if a human acted on the PR after our last action, stand down
    if (routine.concurrency.yieldToHuman) {
      const prm = (leaseKey || envelope.resource_key || '').match(/^pr:(.+)#(\d+)$/);
      const lastOurs = prm ? this.state.lastRunFor.get(`pr:${prm[1]}#${prm[2]}`) : null;
      if (prm && lastOurs) {
        const me = await ghLogin();
        const { pr } = await prView(prm[1], prm[2], 'comments,commits');
        if (pr) {
          const humanTs = [
            ...(pr.comments ?? []).filter((c) => c.author?.login && c.author.login !== me && !c.author.login.endsWith('[bot]')).map((c) => Date.parse(c.createdAt)),
            ...(pr.commits ?? []).flatMap((c) => (c.authors ?? []).some((a) => a.login && a.login !== me) ? [Date.parse(c.committedDate)] : []),
          ].filter(Boolean);
          if (humanTs.length && Math.max(...humanTs) > lastOurs) {
            this.log.append('yield.human', { run: id, slug: routine.slug, key: leaseKey });
            releaseAll();
            return skip('a human acted after our last action — yielding');
          }
        }
      }
    }

    // per-target iteration budget: bounded loops, observable terminal state
    if (routine.concurrency.budget) {
      const key = renderTemplate(routine.concurrency.budget.key, ctx);
      const used = this.state.budgets.get(key) ?? 0;
      if (this.state.needsHuman.has(key)) { releaseAll(); return skip(`budget ${key} exhausted — needs-human (reset with \`harness budget-reset\`)`); }
      if (used >= routine.concurrency.budget.maxIterations) {
        this.log.append('budget.exhausted', { run: id, slug: routine.slug, key, max: routine.concurrency.budget.maxIterations, on_exhausted: routine.concurrency.budget.onExhausted });
        this.state.needsHuman.set(key, { slug: routine.slug, at: new Date().toISOString() });
        await this.notify(routine, `budget exhausted on ${key} after ${used} iterations — needs a human`, 'failure');
        releaseAll();
        return skip(`budget ${key} exhausted (${used}/${routine.concurrency.budget.maxIterations})`);
      }
      this.log.append('budget.tick', { run: id, slug: routine.slug, key, used: used + 1, max: routine.concurrency.budget.maxIterations });
      this.state.budgets.set(key, used + 1);
    }

    // ── admitted: execute ──
    this.log.append('run.start', { run: id, slug: routine.slug, trigger: label, attempt, source: envelope.source, type: envelope.type, repo: envelope.repo ?? undefined, resource: envelope.resource_key || undefined });
    this.state.runs.set(id, { slug: routine.slug, status: 'running', trigger: label, started: new Date().toISOString() });
    const dayKey = `${routine.slug}|${new Date().toISOString().slice(0, 10)}`;
    this.state.runsByDay.set(dayKey, (this.state.runsByDay.get(dayKey) ?? 0) + 1);

    let result;
    try {
      result = await this.execute(routine, trigger, envelope, { id, inputs, label, handler });
    } finally {
      releaseAll();
    }
    const live = this.state.runs.get(id);
    if (live && live.status === 'running') Object.assign(live, { status: result.ok ? 'succeeded' : 'failed', finished: new Date().toISOString(), ok: result.ok });

    // reactive flow: a successful run that produced/touched a PR subscribes to it
    if (result.ok && this.flow && routine.flow && !handler) {
      try { await this.flow.maybeSubscribe(routine, envelope, id, result.output); }
      catch (e) { this.log.append('flow.error', { run: id, slug: routine.slug, reason: e.message }); }
    }

    // retry policy
    if (!result.ok && !result.canceled && routine.policy.retry && attempt < routine.policy.retry.max) {
      const delay = routine.policy.retry.backoff === 'exponential' ? (RETRY_DELAYS[attempt] ?? 900_000) : 60_000;
      this.log.append('retry.scheduled', { run: id, slug: routine.slug, attempt: attempt + 1, max: routine.policy.retry.max, in_ms: delay });
      setTimeout(() => { this.dispatch(routine, trigger, envelope, { inputs, approved, attempt: attempt + 1, chainPath }).catch(() => {}); }, delay).unref?.();
    } else if (!result.ok && !result.canceled) {
      await this.notify(routine, `run ${id} failed (${label}): ${truncate(result.summary ?? '', 200)}`, 'failure');
    } else if (result.ok && routine.policy.notify?.on.includes('success')) {
      await this.notify(routine, `run ${id} succeeded (${label}): ${truncate(result.summary ?? '', 200)}`, 'success');
    }

    // after-chain: emit a control-plane event other routines' `on.after` can match
    if (this.emitEnvelope && chainPath.length < 8) {
      const outcome = result.ok ? 'success' : 'failure';
      const env2 = fromAfter({ routine: routine.slug, run: id, outcome, output: truncate(result.summary ?? '', 4000) });
      env2.chainPath = [...chainPath, routine.slug];
      this.emitEnvelope(env2);
    }
    return { id, ...result };
  }

  async execute(routine, trigger, envelope, { id, inputs, label, handler = null }) {
    const t0 = now();
    // secrets → env (values registered for redaction before anything is logged)
    const { env: secretEnv, report } = resolveSecrets(routine, { dir: this.dir, mapping: this.config.secrets ?? {}, log: this.log });
    for (const s of report) this.log.append('wire.secret', { run: id, slug: routine.slug, name: s.name, via: s.via, ok: s.ok });
    const missingSecrets = report.filter((s) => !s.ok);
    if (missingSecrets.length) {
      const summary = `missing secrets: ${missingSecrets.map((s) => s.name).join(', ')}`;
      this.log.append('run.done', { run: id, slug: routine.slug, ok: false, ms: 0, summary });
      return { ok: false, summary };
    }

    // workspace (repo checkout per runtime:)
    const workspace = await makeWorkspace(routine, { runId: id });
    for (const c of workspace.cloned) this.log.append('run.checkout', { run: id, repo: c.repo, mode: routine.runtime.checkout });
    if (workspace.errors.length) {
      workspace.cleanup();
      const summary = `checkout failed: ${workspace.errors.map((e) => `${e.repo}: ${e.err}`).join('; ')}`;
      this.log.append('run.done', { run: id, slug: routine.slug, ok: false, ms: now() - t0, summary });
      return { ok: false, summary };
    }

    // MCP config from the connector registry (docs/06 §4)
    const mcp = buildMcpConfig(routine, this.registry, { runId: id });
    for (const name of Object.keys(mcp.servers)) this.log.append('wire.mcp', { run: id, slug: routine.slug, server: name });
    for (const name of mcp.missing) this.log.append('wire.mcp', { run: id, slug: routine.slug, server: name, ok: false, reason: 'not in connector registry' });

    const stateDir = routine.state.enabled ? this.stateDirFor(routine) : null;
    const { allow, deny, grants } = allowedTools(routine, { hasWorkspace: workspace.cloned.length > 0 });
    if (stateDir) allow.push('Read', 'Write', 'Edit', 'Glob', 'Grep');

    const prRef = envelope.resource_key?.startsWith('pr:') ? (() => { const m = envelope.resource_key.match(/^pr:(.+)#(\d+)$/); return m ? { repo: m[1], pr: +m[2] } : null; })() : null;
    const { prompt, templateMisses } = buildRunPrompt(routine, envelope, {
      inputs, secrets: secretEnv, stateDir, upstream: envelope.upstream, prRef, workspace, handler,
    });
    for (const miss of templateMisses) this.log.append('template.miss', { run: id, slug: routine.slug, ref: miss });

    // step-level trace into .harness (compact by default; off/full via harness.yaml trace:)
    const traceMode = this.config.trace ?? 'compact';
    let seq = 0;
    const put = traceMode === 'off' ? () => {} : (type, tool, ok, payload) => {
      const text = truncate(typeof payload === 'string' ? payload : JSON.stringify(payload), traceMode === 'full' ? 4000 : 300);
      this.log.append('run.event', { run: id, seq: seq++, type, ...(tool ? { tool } : {}), ...(ok == null ? {} : { ok }), text });
    };

    const res = await runClaude(prompt, {
      allow, deny,
      onEvent: traceAdapter(put),
      onChild: (c) => this.children.set(id, c),
      model: routine.runtime.model || this.config.model || undefined,
      effort: routine.runtime.effort || undefined,
      cwd: stateDir && !workspace.cloned.length ? stateDir : workspace.dir,
      mcpConfig: mcp.path,
      runId: id,
      timeoutMs: routine.runtime.timeoutMs ?? 240_000,
      extraEnv: { ...secretEnv, HARNESS_STATE_DIR: stateDir ?? '', HARNESS_REPO: routine.runtime.repo[0] ?? '', HARNESS_EVENT: truncate(JSON.stringify(envelope.payload ?? {}), 50_000) },
    });
    this.children.delete(id);
    workspace.cleanup();
    if (mcp.path) { try { rmSync(mcp.path, { force: true }); } catch { /* tmp */ } }

    const canceled = this.canceled.delete(id);
    const ok = !canceled && !res.isError && !!res.finalText;
    const summary = canceled ? 'canceled'
      : ok ? res.finalText
      : (res.finalText || (res.timedOut ? `timed out after ${fmtDur(res.ms)}` : res.stderr || `claude exited ${res.code}`));

    // structured result contract (outputs.summary: structured): parse trailing JSON line
    let structured = null;
    if (ok && routine.outputs.summary === 'structured') {
      const lines = res.finalText.trim().split('\n');
      for (let i = lines.length - 1; i >= Math.max(0, lines.length - 5); i--) {
        try { const o = JSON.parse(lines[i]); if (o && typeof o === 'object') { structured = o; break; } } catch { /* keep looking */ }
      }
      if (!structured) this.log.append('run.contract', { run: id, slug: routine.slug, ok: false, reason: 'no structured JSON summary found' });
    }

    this.log.append('run.done', {
      run: id, slug: routine.slug, ok, canceled: canceled || undefined,
      ms: res.ms, cost_usd: res.costUsd, turns: res.numTurns, session: res.sessionId || undefined,
      resource: envelope.resource_key || undefined,
      summary: truncate(summary, 600),
      ...(structured ? { structured } : {}),
    });
    const st = this.state.runs.get(id);
    if (st) Object.assign(st, { status: ok ? 'succeeded' : 'failed', finished: new Date().toISOString(), ok, costUsd: res.costUsd });
    if (envelope.resource_key) this.state.lastRunFor.set(envelope.resource_key, now());
    if (res.costUsd) { const d = new Date().toISOString().slice(0, 10); this.state.spendByDay.set(d, (this.state.spendByDay.get(d) ?? 0) + res.costUsd); }

    // status surface (docs/02 §2.9): one idempotent place a run reports
    try {
      await upsertSurface(this, routine, envelope, { id, ok, summary: structured?.summary ?? summary, prRef: null });
    } catch (e) {
      this.log.append('surface.error', { run: id, slug: routine.slug, error: e.message });
    }

    return { ok, canceled, summary, ms: res.ms, costUsd: res.costUsd, output: res.finalText, structured };
  }

  async notify(routine, text, kind) {
    const n = routine.policy.notify;
    const wants = n?.on.includes(kind) || (kind === 'failure' && (routine.policy.onFailure.includes('notify') || routine.policy.onFailure.includes('notify-owner')));
    if (!wants) return;
    const chan = (n?.channel ?? '').replace(/^slack:\/\//, '');
    if (chan) {
      const r = await slackPost(chan, `:rotating_light: *${routine.name}* — ${text}`);
      this.log.append('notify.sent', { slug: routine.slug, channel: chan, ok: r.ok, ...(r.ok ? {} : { error: r.err }) });
    } else {
      this.log.append('notify.sent', { slug: routine.slug, channel: `owner:${routine.owner}`, ok: true, note: 'no slack channel configured — logged only', text: truncate(text, 200) });
    }
  }
}
