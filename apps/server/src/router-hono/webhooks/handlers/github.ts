import debug from 'debug';
import type { Context } from 'hono';

import { getServerDB } from '@/database/core/db-adaptor';
import { ScmWebhookDeliveryModel } from '@/database/models/scm';
import { scmEnv } from '@/envs/scm';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import {
  describeGitHubDelivery,
  normalizeGitHubEvent,
} from '@/server/services/scm/github/normalize';
import { verifyGitHubSignature } from '@/server/services/scm/github/signature';
import { ScmIngestService } from '@/server/services/scm/ScmIngestService';

/**
 * The ledger grows with every accepted delivery, so it is swept from the
 * ingress itself rather than from a scheduler this deployment may not run.
 * A Redis claim keeps it to one sweep a day across every instance; without
 * Redis the sweep is skipped rather than run on every request.
 */
const pruneDeliveryLedger = async (db: Awaited<ReturnType<typeof getServerDB>>) => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  if ((await redis.set('scm:delivery-prune', '1', 'EX', 86_400, 'NX')) !== 'OK') return;

  const before = new Date(Date.now() - ScmWebhookDeliveryModel.RETENTION_DAYS * 86_400_000);
  const pruned = await ScmWebhookDeliveryModel.pruneBefore(db, before);
  log('pruned %d webhook deliveries received before %s', pruned, before.toISOString());
};

const log = debug('lobe-server:scm:github-webhook');

/**
 * Inbound GitHub App webhook. Order matters:
 *
 * 1. Verify the signature over the raw bytes — before parsing, before any
 *    database read, so an unsigned request costs nothing.
 * 2. Claim the delivery id. GitHub retries and redelivers; the ledger's
 *    primary key makes the second copy a no-op 200.
 * 3. Normalize + apply. A thrown handler settles the ledger row as `failed`
 *    and answers 500 so the delivery shows red in the App's delivery log and
 *    can be redelivered (with a fresh id) once the cause is fixed.
 */
export const githubWebhook = async (c: Context): Promise<Response> => {
  const secret = scmEnv.GITHUB_APP_WEBHOOK_SECRET;
  if (!secret) return c.json({ error: 'GitHub App webhook is not configured' }, 503);

  const rawBody = await c.req.text();
  const verified = verifyGitHubSignature({
    rawBody,
    secret,
    signature: c.req.header('x-hub-signature-256'),
  });
  if (!verified) return c.json({ error: 'invalid signature' }, 401);

  const event = c.req.header('x-github-event');
  const deliveryId = c.req.header('x-github-delivery');
  if (!event || !deliveryId) return c.json({ error: 'missing event headers' }, 400);

  let payload: Record<string, any>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }

  const db = await getServerDB();
  const described = describeGitHubDelivery(payload);
  const claimed = await ScmWebhookDeliveryModel.claim(db, {
    ...described,
    deliveryId,
    event,
    provider: 'github',
  });
  if (!claimed) {
    log('duplicate delivery %s (%s.%s)', deliveryId, event, described.action ?? '-');
    return c.json({ duplicate: true, ok: true });
  }

  const key = { deliveryId, provider: 'github' as const };
  try {
    const normalized = normalizeGitHubEvent(event, payload);
    const outcome = await new ScmIngestService(db).apply(normalized);
    await ScmWebhookDeliveryModel.settle(db, key, {
      error: outcome.detail,
      status: outcome.status,
    });
    log(
      '%s.%s delivery=%s -> %s %s',
      event,
      described.action ?? '-',
      deliveryId,
      outcome.status,
      outcome.detail ?? '',
    );
    // After the response path is settled, not before: retention must never
    // decide whether a delivery is accepted.
    await pruneDeliveryLedger(db).catch((error) => log('delivery prune failed: %O', error));

    return c.json({ ok: true, ...outcome });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('%s.%s delivery=%s failed: %O', event, described.action ?? '-', deliveryId, error);
    await ScmWebhookDeliveryModel.settle(db, key, { error: message, status: 'failed' });
    return c.json({ error: message, ok: false }, 500);
  }
};
