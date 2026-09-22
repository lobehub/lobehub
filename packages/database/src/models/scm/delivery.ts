import type {
  ScmClaimDeliveryParams,
  ScmProvider,
  ScmWebhookDeliveryStatus,
} from '@lobechat/types';
import { and, eq, lt, or } from 'drizzle-orm';

import type { ScmWebhookDeliveryItem } from '../../schemas';
import { scmWebhookDeliveries } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

/**
 * The idempotency gate for inbound webhooks. `claim` inserts the delivery id
 * before any handler runs; a delivery already applied returns `null` and the
 * caller answers the provider with a no-op 200.
 *
 * "Already applied" means `processed` or `skipped` — those are settled. A
 * `failed` row, or one stuck in `received` because the process died
 * mid-flight, is *not* a duplicate: redelivering is how GitHub recovers a
 * lost event, and refusing it would drop a merge for good.
 */
export class ScmWebhookDeliveryModel {
  /** How long a `received` row may sit before a redelivery may take it over. */
  static STALE_RECEIVED_MINUTES = 5;

  static claim = async (
    db: LobeChatDatabase,
    params: ScmClaimDeliveryParams,
  ): Promise<ScmWebhookDeliveryItem | null> => {
    const values = {
      action: params.action ?? null,
      deliveryId: params.deliveryId,
      event: params.event,
      installationId: params.installationId ?? null,
      number: params.number ?? null,
      provider: params.provider,
      repoFullName: params.repoFullName ?? null,
      status: 'received' as const,
    };
    const staleBefore = new Date(
      Date.now() - ScmWebhookDeliveryModel.STALE_RECEIVED_MINUTES * 60_000,
    );

    // The conflict update is the retry gate: it fires only for a row that is
    // safe to re-run, so two concurrent redeliveries still produce one claim.
    const [row] = await db
      .insert(scmWebhookDeliveries)
      .values(values)
      .onConflictDoUpdate({
        set: { error: null, processedAt: null, receivedAt: new Date(), status: 'received' },
        target: [scmWebhookDeliveries.provider, scmWebhookDeliveries.deliveryId],
        where: or(
          eq(scmWebhookDeliveries.status, 'failed'),
          and(
            eq(scmWebhookDeliveries.status, 'received'),
            lt(scmWebhookDeliveries.receivedAt, staleBefore),
          ),
        ),
      })
      .returning();

    return row ?? null;
  };

  static settle = async (
    db: LobeChatDatabase,
    key: { deliveryId: string; provider: ScmProvider },
    outcome: { error?: string | null; status: Exclude<ScmWebhookDeliveryStatus, 'received'> },
  ): Promise<void> => {
    await db
      .update(scmWebhookDeliveries)
      .set({ error: outcome.error ?? null, processedAt: new Date(), status: outcome.status })
      .where(
        and(
          eq(scmWebhookDeliveries.provider, key.provider),
          eq(scmWebhookDeliveries.deliveryId, key.deliveryId),
        ),
      );
  };

  /** How long a settled delivery stays on the ledger before the sweep drops it. */
  static RETENTION_DAYS = 30;

  /** Retention sweep: drop rows older than the given instant. Returns the count removed. */

  static pruneBefore = async (db: LobeChatDatabase, before: Date): Promise<number> => {
    const rows = await db
      .delete(scmWebhookDeliveries)
      .where(lt(scmWebhookDeliveries.receivedAt, before))
      .returning({ deliveryId: scmWebhookDeliveries.deliveryId });

    return rows.length;
  };
}
