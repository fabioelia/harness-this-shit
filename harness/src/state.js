// Materialized state, rebuilt by replaying .harness (event sourcing). This is
// what makes a single log file sufficient: budgets, dedupe stamps, open flow
// subscriptions, pending approvals, per-day run counts, and cron last-fire all
// survive a restart because they are derived, not stored.
import { replay } from './log.js';
import { now } from './util.js';

export function materialize(entries) {
  const s = {
    up: null,                       // last harness.up entry
    down: null,
    runs: new Map(),                // runId → {slug,status,trigger,started,finished,ok,costUsd,summary}
    budgets: new Map(),             // budget key → iteration count
    needsHuman: new Map(),          // budget key → {slug, at}
    dedupe: new Map(),              // dedupe key → last-fired ts
    flows: new Map(),               // flow id → {slug,run,repo,pr,events,until,reconcileMs,expiresAt,status,fired:{}}
    approvals: new Map(),           // runId → {slug,approvers,status:pending|granted|denied,by}
    lastCron: new Map(),            // `${slug}|${cronIdx}` → minute stamp
    oneShots: new Set(),            // fired `${slug}|at:<ts>` one-shot schedules
    surfaces: new Map(),            // `${slug}|${target}` → {kind, ref} (slack ts / comment id) for upserts
    runsByDay: new Map(),           // `${slug}|YYYY-MM-DD` → count
    spendByDay: new Map(),          // YYYY-MM-DD → usd
    lastRunFor: new Map(),          // resource key → finished ts (yield-to-human window)
  };
  const day = (t) => String(t).slice(0, 10);
  for (const e of entries) {
    switch (e.ev) {
      case 'harness.up': s.up = e; s.down = null; break;
      case 'harness.down': s.down = e; break;
      case 'run.start': {
        s.runs.set(e.run, { slug: e.slug, status: 'running', trigger: e.trigger, started: e.t });
        const k = `${e.slug}|${day(e.t)}`;
        s.runsByDay.set(k, (s.runsByDay.get(k) ?? 0) + 1);
        break;
      }
      case 'run.done': {
        const r = s.runs.get(e.run) ?? { slug: e.slug };
        Object.assign(r, { status: e.ok ? 'succeeded' : 'failed', finished: e.t, ok: e.ok, costUsd: e.cost_usd, summary: e.summary });
        s.runs.set(e.run, r);
        if (e.cost_usd) s.spendByDay.set(day(e.t), (s.spendByDay.get(day(e.t)) ?? 0) + e.cost_usd);
        if (e.resource) s.lastRunFor.set(e.resource, Date.parse(e.t));
        break;
      }
      case 'run.skip': case 'run.coalesced': {
        const r = s.runs.get(e.run);
        if (r) Object.assign(r, { status: e.ev === 'run.skip' ? 'skipped' : 'coalesced', finished: e.t, reason: e.reason });
        break;
      }
      case 'run.pending': s.approvals.set(e.run, { slug: e.slug, approvers: e.approvers ?? [], status: 'pending', trigger: e.trigger, event: e.event }); break;
      case 'approval.granted': { const a = s.approvals.get(e.run); if (a) { a.status = 'granted'; a.by = e.by; } break; }
      case 'approval.denied': { const a = s.approvals.get(e.run); if (a) { a.status = 'denied'; a.by = e.by; } break; }
      case 'budget.tick': s.budgets.set(e.key, (s.budgets.get(e.key) ?? 0) + 1); break;
      case 'budget.exhausted': s.needsHuman.set(e.key, { slug: e.slug, at: e.t }); break;
      case 'budget.reset': s.budgets.delete(e.key); s.needsHuman.delete(e.key); break;
      case 'event.deduped': break;
      case 'event.fired': if (e.dedupe_key) s.dedupe.set(e.dedupe_key, Date.parse(e.t)); break;
      case 'cron.fired': s.lastCron.set(`${e.slug}|${e.idx ?? 0}`, e.stamp); if (e.at) s.oneShots.add(`${e.slug}|at:${e.at}`); break;
      case 'flow.subscribed': s.flows.set(e.flow, { slug: e.slug, run: e.run, repo: e.repo, pr: e.pr, events: e.events, until: e.until, reconcileMs: e.reconcile_ms, expiresAt: e.expires_at, status: 'open', fired: {}, lastChecked: 0, seen: e.seen ?? {} }); break;
      case 'flow.reaction': { const f = s.flows.get(e.flow); if (f) f.fired[e.reaction] = (f.fired[e.reaction] ?? 0) + 1; break; }
      case 'flow.state': { const f = s.flows.get(e.flow); if (f) f.seen = { ...e.seen, title: f.seen?.title, url: f.seen?.url, headSha: f.seen?.headSha }; break; }
      case 'flow.unsubscribed': { const f = s.flows.get(e.flow); if (f) { f.status = 'closed'; f.reason = e.reason; } break; }
      case 'surface.upserted': if (e.slug && e.target) s.surfaces.set(`${e.slug}|${e.target}`, { kind: e.kind, ref: e.ref }); break;
      default: break;
    }
  }
  return s;
}

export const loadState = (dir) => materialize(replay(dir));

export function isDaemonAlive(state) {
  if (!state.up || state.down && Date.parse(state.down.t) > Date.parse(state.up.t)) return false;
  const pid = state.up.pid;
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// Runs still marked running whose daemon is gone → report as reapable on boot.
export function staleRuns(state, maxAgeMs = 30 * 60_000) {
  const out = [];
  for (const [id, r] of state.runs) {
    if (r.status === 'running' && now() - Date.parse(r.started) > maxAgeMs) out.push({ id, ...r });
  }
  return out;
}
