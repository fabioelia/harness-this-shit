// The canonical Event envelope (docs/04 §3). Every source — GitHub webhooks,
// connector events, generic webhooks, cron, manual, api, after — normalizes into
// this one shape so matching and ${{ event.* }} are uniform.
import { rid, now } from './util.js';

export const eventRepo = (p) => (typeof p?.repository === 'object' ? p.repository?.full_name : p?.repository) || null;
export const eventSha = (p) => p?.pull_request?.head?.sha || p?.after || p?.check_suite?.head_sha || p?.check_run?.head_sha || p?.workflow_run?.head_sha || p?.head_commit?.id || '';
export const branchOf = (p) => (p?.ref ? String(p.ref).replace('refs/heads/', '') : null) || p?.pull_request?.head?.ref || p?.workflow_run?.head_branch || p?.check_run?.check_suite?.head_branch || p?.branch || null;

export function resourceKey(payload) {
  const repo = eventRepo(payload);
  const pr = payload?.pull_request?.number ?? (payload?.issue?.pull_request ? payload?.issue?.number : null);
  if (repo && pr) return `pr:${repo}#${pr}`;
  if (repo) return `repo:${repo}`;
  return '';
}

export function makeEnvelope(source, type, payload = {}, extra = {}) {
  return {
    id: rid('evt'),
    source,                       // github | webhook | manual | api | schedule | after | flow | <connector>
    type,                         // pull_request | label | message | cron | …
    payload,
    repo: eventRepo(payload),
    actor: payload?.sender?.login ?? payload?.actor ?? null,
    resource_key: resourceKey(payload),
    sha: eventSha(payload),
    received_at: now(),
    ...extra,
  };
}

// GitHub delivery → envelope. A "labeled"/"unlabeled" pull_request/issues delivery
// also surfaces as the friendlier `label` event type (both are matchable).
const LABELISH = new Set(['pull_request', 'pull_request_target', 'issues']);
export function fromGithub(eventHeader, payload, delivery = '') {
  const envs = [makeEnvelope('github', eventHeader, payload, { delivery })];
  if (LABELISH.has(eventHeader) && (payload?.action === 'labeled' || payload?.action === 'unlabeled')) {
    envs.push(makeEnvelope('github', 'label', payload, { delivery }));
  }
  return envs;
}

export const fromConnector = (connector, type, payload) => makeEnvelope(connector, type, payload);
export const fromWebhook = (id, payload) => makeEnvelope('webhook', id, payload, { webhook_id: id });
export const fromSchedule = (spec) => makeEnvelope('schedule', 'schedule', { event: 'schedule', ...spec });
export const fromManual = (inputs = {}, by = '') => makeEnvelope('manual', 'manual', { event: 'manual', inputs, by });
export const fromApi = (inputs = {}, body = {}) => makeEnvelope('api', 'api', { ...body, event: 'api', inputs });
export const fromAfter = (upstream) => makeEnvelope('after', 'after', { event: 'after', upstream }, { upstream });
