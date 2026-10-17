import debug from 'debug';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { getServerDB } from '@/database/core/db-adaptor';
import { createAgentInboundService } from '@/server/services/agentIdentity/inbound';

const log = debug('lobe-server:agent:account-webhook');

/**
 * Largest delivery the route will buffer. Provider webhooks carry a summary
 * (Agent Mail's body is fetched back separately) or a short text, so this is
 * far above any real delivery and far below what an unauthenticated caller
 * could otherwise make the server hold before the signature is even checked.
 */
export const AGENT_ACCOUNT_WEBHOOK_MAX_BYTES = 512 * 1024;

/**
 * Runs before {@link agentAccountWebhook} reads the body. Checks the declared
 * length and the streamed bytes alike, so an oversized or unbounded stream is
 * cut off at the cap instead of buffered whole.
 */
export const agentAccountWebhookBodyLimit = bodyLimit({
  maxSize: AGENT_ACCOUNT_WEBHOOK_MAX_BYTES,
  onError: (c) => c.json({ error: 'payload too large', success: false }, 413),
});

/**
 * Inbound webhook for the agent's own accounts.
 *
 * `POST /api/agent/accounts/webhooks/:provider`
 *
 * Runs BEFORE any authorization middleware: the provider (e.g. Agent Mail) is
 * an untrusted caller and the only thing it can prove is its signature, which
 * the account service verifies against the credential of the account the
 * delivery routes to. Nothing is trusted until `handleInbound` says
 * `delivered`.
 *
 * The raw body is what the signature covers, so it is read as text and handed
 * on unparsed — the provider parses it after verification.
 *
 * Status mapping (see `AgentInboundResult`): 200 delivered/ignored, 503 stored
 * but its wake failed transiently (retry it), 401 a forged signature, 404 a
 * delivery for an address this deployment cannot route.
 */
export async function agentAccountWebhook(c: Context): Promise<Response> {
  const provider = c.req.param('provider');
  if (!provider) return c.json({ error: 'provider is required' }, 400);

  const body = await c.req.text();
  const headers: Record<string, string | undefined> = {};
  c.req.raw.headers.forEach((value, key) => {
    headers[key] = value;
  });

  log('Received account webhook: provider=%s, bytes=%d', provider, body.length);

  try {
    const serverDB = await getServerDB();
    const service = await createAgentInboundService(serverDB);
    const result = await service.handle(provider, { body, headers });

    if (result.outcome === 'delivered') {
      log(
        'Delivered: account=%s message=%s created=%s wake=%s',
        result.accountId,
        result.messageId,
        result.created,
        result.wake.reason,
      );
      return c.json(
        {
          accountId: result.accountId,
          created: result.created,
          messageId: result.messageId,
          outcome: result.outcome,
          success: true,
          // Only the fixed outcome code: the provider is an outside caller and
          // must not learn internal errors or which topic the run landed in.
          wake: { reason: result.wake.reason, started: result.wake.started },
        },
        result.status,
      );
    }

    log('Not delivered: provider=%s outcome=%s', provider, result.outcome);
    return c.json({ outcome: result.outcome, success: false }, result.status);
  } catch (error) {
    log('Account webhook failed for provider %s: %O', provider, error);
    return c.json({ error: 'webhook processing failed', success: false }, 500);
  }
}
