// Reactive flows (docs/02 §2.12, docs/11): when a run opens/touches a PR, the
// routine SUBSCRIBES to that PR and reacts to its life — "if ci/* fails, do
// fix-ci" — until merged/closed. Local transport is reconcile polling via gh
// (webhook events, when wired, land through the same reaction matcher).
import { rid, now, anyGlob, truncate, durationMs } from './util.js';
import { makeEnvelope } from './events.js';
import { prView, resolvePrFromBranch } from './gh.js';

const PR_URL_RE = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/;

export class FlowManager {
  constructor(dispatcher) {
    this.d = dispatcher;
    this.log = dispatcher.log;
    this.state = dispatcher.state;
  }

  // After a successful run: find the PR this run produced/touched and subscribe.
  // A routine whose reactions are timeout-only subscribes even without a PR.
  async maybeSubscribe(routine, envelope, runId, output) {
    if (!routine.flow) return;
    let repo = envelope.repo ?? routine.runtime.repo[0] ?? null;
    let pr = null;
    const m = String(output ?? '').match(PR_URL_RE);
    if (m) { repo = m[1]; pr = +m[2]; }
    if (!pr && envelope.resource_key?.startsWith('pr:')) {
      const rm = envelope.resource_key.match(/^pr:(.+)#(\d+)$/);
      if (rm) { repo = rm[1]; pr = +rm[2]; }
    }
    if (!pr && (envelope.payload?.pull_request?.number ?? envelope.payload?.number)) {
      pr = Number(envelope.payload.pull_request?.number ?? envelope.payload.number);
    }
    if (!pr && repo && envelope.payload?.branch) pr = await resolvePrFromBranch(repo, envelope.payload.branch);
    const timerOnly = routine.flow.reactions.length > 0 && routine.flow.reactions.every((rx) => rx.when.event === 'timeout');
    if ((!repo || !pr) && !timerOnly) { this.log.append('flow.skip', { run: runId, slug: routine.slug, reason: 'no PR resolved from run' }); return; }
    if (timerOnly && (!repo || !pr)) { repo = repo ?? null; pr = pr ?? null; }

    // one open subscription per (routine, PR)
    for (const f of this.state.flows.values()) {
      if (f.status === 'open' && f.slug === routine.slug && f.repo === repo && f.pr === pr) return;
    }
    const flow = rid('flow');
    const sub = routine.flow.subscribe;
    const rec = {
      slug: routine.slug, run: runId, repo, pr,
      events: sub.events, until: sub.until,
      reconcileMs: sub.reconcileMs, createdAt: now(), expiresAt: now() + sub.ttlMs,
      status: 'open', fired: {}, lastChecked: 0, seen: null,
    };
    this.state.flows.set(flow, rec);
    this.log.append('flow.subscribed', {
      flow, run: runId, slug: routine.slug, repo, pr,
      events: sub.events, until: sub.until, reconcile_ms: sub.reconcileMs, created_at: rec.createdAt, expires_at: rec.expiresAt,
    });
  }

  async snapshot(repo, pr) {
    const { pr: v, err } = await prView(repo, pr, 'state,title,url,headRefOid,statusCheckRollup,reviews,comments,mergedAt');
    if (err) return { err };
    return {
      state: v.state,                                             // OPEN | MERGED | CLOSED
      headSha: v.headRefOid,
      title: v.title, url: v.url,
      checks: Object.fromEntries((v.statusCheckRollup ?? []).map((c) => [c.name ?? c.context, (c.conclusion || c.state || c.status || '').toLowerCase()])),
      reviews: Object.fromEntries((v.reviews ?? []).filter((r) => ['APPROVED', 'CHANGES_REQUESTED'].includes(r.state)).map((r) => [r.author?.login ?? '?', r.state.toLowerCase()])),
      comments: (v.comments ?? []).length,
    };
  }

  // Diff old→new snapshot into synthetic envelope-shaped occurrences.
  diff(prev, cur) {
    const occ = [];
    for (const [name, conc] of Object.entries(cur.checks)) {
      const done = ['success', 'failure', 'error', 'cancelled', 'timed_out', 'action_required', 'neutral'].includes(conc);
      if (done && (prev?.checks?.[name] ?? '') !== conc) occ.push({ event: 'check_run', name, conclusion: conc === 'error' ? 'failure' : conc });
    }
    for (const [login, st] of Object.entries(cur.reviews)) {
      if ((prev?.reviews?.[login] ?? '') !== st) occ.push({ event: 'pull_request_review', state: st, author: login });
    }
    if (prev && cur.comments > prev.comments) occ.push({ event: 'issue_comment', action: 'created' });
    if (cur.state === 'MERGED' && prev?.state !== 'MERGED') occ.push({ event: 'pull_request', merged: true, action: 'closed' });
    if (cur.state === 'CLOSED' && prev?.state !== 'CLOSED') occ.push({ event: 'pull_request', merged: false, action: 'closed' });
    return occ;
  }

  reactionMatches(rx, occ) {
    if (rx.when.event !== occ.event && !(rx.when.event === 'status' && occ.event === 'check_run')) return false;
    for (const [k, want] of Object.entries(rx.when.filters)) {
      if (rx.when.event === 'timeout' && k === 'after') continue;   // duration, not a payload filter
      const actual = occ[k];
      if (actual == null) continue;
      if (typeof want === 'boolean') { if (!!actual !== want) return false; }
      else if (!anyGlob(want, actual)) return false;
    }
    return true;
  }

  // Timeout reactions: fire once per subscription after `when.timeout.after` elapses.
  dueTimeouts(rec, routine) {
    const out = [];
    for (const rx of routine.flow.reactions) {
      if (rx.when.event !== 'timeout') continue;
      const ms = durationMs(rx.when.filters.after ?? rx.when.filters.duration ?? '30m') ?? 1_800_000;
      const key = `timeout:${rx.do}`;
      if (!rec.fired[key] && now() - rec.createdAt >= ms) { rec.fired[key] = 1; out.push({ rx, occ: { event: 'timeout', after: rx.when.filters.after } }); }
    }
    return out;
  }

  async fire(flowId, rec, routine, rx, occ, cur) {
    const payload = {
      event: 'flow', repository: { full_name: rec.repo },
      pull_request: { number: rec.pr, title: cur.title, html_url: cur.url, head: { sha: cur.headSha } },
      ...(occ.event === 'check_run' ? { check_run: { name: occ.name, conclusion: occ.conclusion, head_sha: cur.headSha } } : {}),
      ...(occ.event === 'pull_request_review' ? { review: { state: occ.state, user: { login: occ.author } } } : {}),
    };
    const envelope = makeEnvelope('flow', occ.event, payload, { upstream: { routine: rec.slug, run: rec.run } });

    if (rx.do === 'done') {
      rec.status = 'closed';
      this.log.append('flow.unsubscribed', { flow: flowId, reason: `reaction done on ${occ.event}` });
      return;
    }
    // per-handler budget (independent of the routine's own concurrency budget)
    if (rx.budget) {
      const ctx = { pr: { number: rec.pr }, event: payload };
      const key = rx.budget.key.replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (w, p) => String(p.trim() === 'pr.number' ? rec.pr : w));
      const used = this.state.budgets.get(key) ?? 0;
      if (used >= rx.budget.max) {
        this.log.append('budget.exhausted', { flow: flowId, slug: rec.slug, key, max: rx.budget.max, on_exhausted: rx.budget.onExhausted });
        this.state.needsHuman.set(key, { slug: rec.slug, at: new Date().toISOString() });
        return;
      }
      this.log.append('budget.tick', { flow: flowId, slug: rec.slug, key, used: used + 1, max: rx.budget.max });
      this.state.budgets.set(key, used + 1);
    }

    rec.fired[rx.do] = (rec.fired[rx.do] ?? 0) + 1;
    let target = routine, handler = null;
    if (rx.do.startsWith('routine:')) {
      target = this.d.bySlug(rx.do.slice(8));
      if (!target) { this.log.append('flow.error', { flow: flowId, reason: `reaction target ${rx.do} not loaded` }); return; }
    } else handler = rx.do;
    this.log.append('flow.reaction', { flow: flowId, slug: rec.slug, pr: `${rec.repo}#${rec.pr}`, when: `${occ.event}${occ.name ? ':' + occ.name : ''}${occ.conclusion ? ':' + occ.conclusion : occ.state ? ':' + occ.state : ''}`, reaction: rx.do });
    this.d.dispatch(target, null, envelope, { handler, chainPath: [rec.slug] }).catch((e) => this.log.append('flow.error', { flow: flowId, reason: e.message }));
  }

  async tick() {
    for (const [flowId, rec] of this.state.flows) {
      if (rec.status !== 'open') continue;
      if (now() > rec.expiresAt) {
        rec.status = 'closed';
        this.log.append('flow.unsubscribed', { flow: flowId, reason: 'ttl expired' });
        continue;
      }
      const routineForTimers = this.d.bySlug(rec.slug);
      if (routineForTimers?.flow) {
        for (const due of this.dueTimeouts(rec, routineForTimers)) {
          await this.fire(flowId, rec, routineForTimers, due.rx, due.occ, rec.seen ?? { checks: {}, reviews: {}, comments: 0, state: 'OPEN', title: '', url: '', headSha: '' });
          if (rec.status !== 'open') break;
        }
        // a timer-only subscription closes once every timeout reaction has fired
        if (rec.status === 'open' && !rec.pr && routineForTimers.flow.reactions.every((rx) => rx.when.event !== 'timeout' || rec.fired[`timeout:${rx.do}`])) {
          rec.status = 'closed';
          this.log.append('flow.unsubscribed', { flow: flowId, reason: 'all timers fired' });
        }
      }
      if (rec.status !== 'open' || !rec.pr) continue;
      if (now() - rec.lastChecked < rec.reconcileMs) continue;
      rec.lastChecked = now();
      const routine = this.d.bySlug(rec.slug);
      if (!routine?.flow) { rec.status = 'closed'; this.log.append('flow.unsubscribed', { flow: flowId, reason: 'routine gone' }); continue; }

      const cur = await this.snapshot(rec.repo, rec.pr);
      if (cur.err) { this.log.append('flow.poll', { flow: flowId, error: truncate(cur.err, 120) }); continue; }
      const occurrences = this.diff(rec.seen, cur);
      const changed = JSON.stringify({ c: cur.checks, r: cur.reviews, n: cur.comments, s: cur.state }) !== JSON.stringify(rec.seen && { c: rec.seen.checks, r: rec.seen.reviews, n: rec.seen.comments, s: rec.seen.state });
      rec.seen = cur;
      if (changed) this.log.append('flow.state', { flow: flowId, seen: { state: cur.state, checks: cur.checks, reviews: cur.reviews, comments: cur.comments } });

      for (const occ of occurrences) {
        if (!rec.events.includes(occ.event) && !(occ.event === 'check_run' && rec.events.includes('status'))) continue;
        for (const rx of routine.flow.reactions) {
          if (this.reactionMatches(rx, occ)) { await this.fire(flowId, rec, routine, rx, occ, cur); break; }
        }
        if (rec.status !== 'open') break;
      }
      // terminal states close the subscription even without a matching reaction
      if (rec.status === 'open' && ((cur.state === 'MERGED' && rec.until.includes('merged')) || (cur.state === 'CLOSED' && rec.until.includes('closed')))) {
        rec.status = 'closed';
        this.log.append('flow.unsubscribed', { flow: flowId, reason: cur.state.toLowerCase() });
      }
    }
  }
}
