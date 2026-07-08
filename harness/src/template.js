// ${{ … }} templating (docs/02 §3): resolves inputs.*, event.*, secrets.*,
// state.*, runtime.*, upstream.*, pr.* against a run context. Unresolvable
// references are left verbatim and reported so nothing fails silently.
import { get } from './util.js';

const RE = /\$\{\{\s*([^}]+?)\s*\}\}/g;

export function renderTemplate(text, ctx, { onMiss } = {}) {
  return String(text).replace(RE, (whole, path) => {
    const v = get(ctx, path.trim());
    if (v === undefined || v === null) { onMiss?.(path.trim()); return whole; }
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  });
}

export function templateRefs(text) {
  return [...String(text).matchAll(RE)].map((m) => m[1].trim());
}

// The normalized view templates + if: guards see. `pr.*` is flattened from
// whichever GitHub payload shape carried it so guards read one vocabulary.
export function buildContext({ event = {}, inputs = {}, secrets = {}, state = {}, runtime = {}, upstream = null, pr = null } = {}) {
  const payload = event.payload ?? event;
  const prSrc = pr ?? payload.pull_request ?? payload.issue?.pull_request ?? null;
  const prView = prSrc ? {
    number: prSrc.number ?? payload.number,
    title: prSrc.title,
    author: prSrc.user?.login ?? prSrc.author,
    draft: !!prSrc.draft,
    state: prSrc.state,
    base: prSrc.base?.ref ?? prSrc.base,
    head: prSrc.head?.ref ?? prSrc.head,
    head_sha: prSrc.head?.sha ?? prSrc.head_sha,
    labels: (prSrc.labels ?? []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean),
    url: prSrc.html_url ?? prSrc.url,
    merged: !!prSrc.merged,
  } : {};
  const repo = event.repo ?? (typeof payload.repository === 'object' ? payload.repository?.full_name : payload.repository) ?? runtime.repo?.[0] ?? '';
  return {
    event: { ...payload, type: event.type ?? payload.event, action: payload.action, repo, pr: prView },
    pr: prView,
    repo,
    actor: payload.sender?.login ?? payload.actor ?? '',
    action: payload.action ?? '',
    type: event.type ?? payload.event ?? '',
    inputs, secrets, state, runtime, upstream: upstream ?? {},
  };
}
