// Status surfaces (docs/02 §2.9): the single place a run reports, UPSERTED —
// find-and-update by idempotency marker, never spammed. Plus optional check-run
// emission so a routine's verdict can join a merge gate.
import { truncate } from './util.js';
import { upsertPrComment, emitCheckRun, slackPost } from './gh.js';

export async function upsertSurface(dispatcher, routine, envelope, { id, ok, summary }) {
  const s = routine.outputs.statusSurface;
  const log = dispatcher.log;
  const prm = (envelope.resource_key ?? '').match(/^pr:(.+)#(\d+)$/);

  if (s && s.type !== 'none') {
    if (s.type === 'pr-comment') {
      if (!prm) log.append('surface.skip', { run: id, slug: routine.slug, kind: 'pr-comment', reason: 'no PR in run context' });
      else {
        const body = `**${routine.name}** — ${ok ? '✅' : '❌'} ${truncate(summary, 1500)}\n\n<sub>run \`${id}\` · updated ${new Date().toISOString()}</sub>`;
        const r = await upsertPrComment(prm[1], prm[2], s.marker, body);
        log.append(r.ok ? 'surface.upserted' : 'surface.error', { run: id, slug: routine.slug, kind: 'pr-comment', target: `pr:${prm[1]}#${prm[2]}`, ref: r.ref, ...(r.ok ? {} : { error: r.err }) });
      }
    } else if (s.type === 'slack-message') {
      const channel = s.channel || routine.tools.scopes?.slack?.channels?.[0] || (routine.policy.notify?.channel ?? '').replace(/^slack:\/\//, '');
      if (!channel) log.append('surface.skip', { run: id, slug: routine.slug, kind: 'slack-message', reason: 'no channel (set outputs.status_surface.channel or tools.scopes.slack.channels)' });
      else {
        const key = `${routine.slug}|slack:${channel}`;
        const prev = dispatcher.state.surfaces.get(key);
        const r = await slackPost(channel, `*${routine.name}* — ${ok ? '✅' : '❌'} ${truncate(summary, 2500)}`, { ts: prev?.ref ?? null });
        if (r.ok) {
          dispatcher.state.surfaces.set(key, { kind: 'slack-message', ref: r.ref });
          log.append('surface.upserted', { run: id, slug: routine.slug, kind: 'slack-message', target: key.split('|')[1], ref: r.ref });
        } else log.append('surface.error', { run: id, slug: routine.slug, kind: 'slack-message', error: r.err });
      }
    } else if (s.type === 'check-run') {
      if (!prm || !envelope.sha) log.append('surface.skip', { run: id, slug: routine.slug, kind: 'check-run', reason: 'no repo/sha in run context' });
      else {
        const r = await emitCheckRun(prm[1], envelope.sha, `routine/${routine.slug}`, ok, summary);
        log.append(r.ok ? 'surface.upserted' : 'surface.error', { run: id, slug: routine.slug, kind: 'check-run', target: `routine/${routine.slug}`, ...(r.ok ? {} : { error: r.err }) });
      }
    }
  }

  if (routine.outputs.emitCheckRun && envelope.sha && envelope.repo) {
    const r = await emitCheckRun(envelope.repo, envelope.sha, routine.outputs.emitCheckRun, ok, summary);
    log.append(r.ok ? 'surface.upserted' : 'surface.error', { run: id, slug: routine.slug, kind: 'check-run', target: routine.outputs.emitCheckRun, ...(r.ok ? {} : { error: r.err }) });
  }
}
