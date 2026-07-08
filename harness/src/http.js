// The event gateway + control API (docs/04 §3 step 1): a bare node:http server.
// Inbound: GitHub webhooks (signed), connector events (Slack Events API et al),
// generic per-routine webhooks, API dispatch. Control: run/approve/cancel/stop.
import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { fromGithub, fromConnector, fromWebhook, fromApi, fromManual } from './events.js';
import { resolveSecretRef } from './secrets.js';

const readBody = (req, limit = 2_000_000) => new Promise((resolve, reject) => {
  let buf = '';
  req.on('data', (d) => { buf += d; if (buf.length > limit) { reject(new Error('body too large')); req.destroy(); } });
  req.on('end', () => resolve(buf));
  req.on('error', reject);
});

function hmacValid(secret, body, header) {
  if (!header) return false;
  const digest = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  try { return timingSafeEqual(Buffer.from(digest), Buffer.from(header)); } catch { return false; }
}

export function startHttp(daemon, { port }) {
  const { log } = daemon;
  const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (req.method === 'GET' && path === '/healthz') return json(res, 200, { ok: true, pid: process.pid, dir: daemon.dir, routines: daemon.routines.length });
      if (req.method === 'GET' && path === '/api/status') return json(res, 200, daemon.statusView());

      if (req.method !== 'POST') return json(res, 404, { error: 'not found' });
      const raw = await readBody(req);
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { /* non-json webhook payloads stay raw */ }

      // ── GitHub webhooks ──
      if (path === '/webhooks/github') {
        const secret = process.env.HARNESS_GITHUB_WEBHOOK_SECRET || daemon.config.github_webhook_secret || '';
        if (secret && !hmacValid(secret, raw, req.headers['x-hub-signature-256'])) {
          log.append('event.rejected', { source: 'github', reason: 'bad signature' });
          return json(res, 401, { error: 'bad signature' });
        }
        const type = String(req.headers['x-github-event'] || body.event || 'unknown');
        const envs = fromGithub(type, body, String(req.headers['x-github-delivery'] || ''));
        envs.forEach((e) => daemon.ingest(e));
        return json(res, 202, { ok: true, type });
      }

      // ── connector events (Slack Events API, Sentry, Jira webhooks, …) ──
      const conn = path.match(/^\/webhooks\/connector\/([\w-]+)$/);
      if (conn) {
        if (conn[1] === 'slack' && body.type === 'url_verification') return json(res, 200, { challenge: body.challenge });
        const payload = body.type === 'event_callback' && body.event ? body.event : body; // unwrap Slack envelope
        const type = String(payload.type || payload.event || url.searchParams.get('type') || 'event');
        daemon.ingest(fromConnector(conn[1], type, payload));
        return json(res, 202, { ok: true });
      }

      // ── generic per-routine webhook (docs/04 §1.4) ──
      const wh = path.match(/^\/webhooks\/([\w-]+)$/);
      if (wh) {
        const id = wh[1];
        const owner = daemon.webhookTriggers.get(id);
        if (!owner) return json(res, 404, { error: `no routine listens on webhook "${id}"` });
        if (owner.secretRef) {
          const { value } = resolveSecretRef(owner.secretRef, { dir: daemon.dir, mapping: daemon.config.secrets ?? {} });
          const sig = req.headers['x-hub-signature-256'];
          const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
          const okSig = value && sig ? hmacValid(value, raw, sig) : false;
          const okBearer = value && bearer ? bearer === value : false;
          const okToken = value ? url.searchParams.get('token') === value : false;
          if (!okSig && !okBearer && !okToken) {
            log.append('event.rejected', { source: 'webhook', webhook: id, reason: 'bad signature/token' });
            return json(res, 401, { error: 'unauthorized' });
          }
        }
        daemon.ingest(fromWebhook(id, body));
        return json(res, 202, { ok: true });
      }

      // ── control API ──
      const apiToken = process.env.HARNESS_API_TOKEN || daemon.config.api_token || '';
      const authed = !apiToken || (req.headers.authorization || '').replace(/^Bearer\s+/i, '') === apiToken;

      const dispatch = path.match(/^\/api\/routines\/([\w-]+)\/(dispatch|run)$/);
      if (dispatch) {
        if (dispatch[2] === 'dispatch' && !authed) return json(res, 401, { error: 'bearer token required' });
        const r = daemon.dispatcher.bySlug(dispatch[1]);
        if (!r) return json(res, 404, { error: `no routine "${dispatch[1]}"` });
        const env = dispatch[2] === 'dispatch' ? fromApi(body.inputs ?? {}, body) : fromManual(body.inputs ?? {}, body.by ?? 'cli');
        const out = await daemon.runNow(r, env, body.inputs ?? {});
        return json(res, out.error ? 400 : 200, out);
      }

      const approve = path.match(/^\/api\/(approve|deny)\/([\w-]+)$/);
      if (approve) {
        if (!authed) return json(res, 401, { error: 'bearer token required' });
        const out = await daemon.resolveApproval(approve[2], approve[1] === 'approve', body.by ?? 'cli');
        return json(res, out.error ? 404 : 200, out);
      }

      const cancel = path.match(/^\/api\/runs\/([\w-]+)\/cancel$/);
      if (cancel) {
        const ok = daemon.dispatcher.cancel(cancel[1]);
        log.append('run.cancel', { run: cancel[1], ok });
        return json(res, 200, { ok });
      }

      if (path === '/api/budget-reset') {
        if (!body.key) return json(res, 400, { error: 'key required' });
        daemon.dispatcher.state.budgets.delete(body.key);
        daemon.dispatcher.state.needsHuman.delete(body.key);
        log.append('budget.reset', { key: body.key, by: body.by ?? 'cli' });
        return json(res, 200, { ok: true });
      }

      if (path === '/api/stop') {
        json(res, 200, { ok: true });
        setTimeout(() => daemon.shutdown('api stop'), 50);
        return;
      }
      return json(res, 404, { error: 'not found' });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, () => resolve(server));
  });
}
