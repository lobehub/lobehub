import type {
  ScmClaimDeliveryParams,
  ScmProvider,
  ScmWebhookDeliveryStatus,
} from '@lobechat/types';
import { and, eq, lt } from 'drizzle-orm';

import type { ScmWebhookDeliveryItem } from '../../schemas';
import { scmWebhookDeliveries } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

/**
 * The idempotency gate for inbound webhooks. `claim` inserts the delivery id
 * before any handler runs; a duplicate delivery returns `null` and the caller
 * answers the provider with a no-op 200.
 */
export class ScmWebhookDeliveryModel {
  static claim = async (
    db: LobeChatDatabase,
    params: ScmClaimDeliveryParams,
  ): Promise<ScmWebhookDeliveryItem | null> => {
    const [row] = await db
      .insert(scmWebhookDeliveries)
      .values({
        action: params.action ?? null,
        deliveryId: params.deliveryId,
        event: params.event,
        installationId: params.installationId ?? null,
        number: params.number ?? null,
        provider: params.provider,
        repoFullName: params.repoFullName ?? null,
        status: 'received',
      })
      .onConflictDoNothing()
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

  /** Retention sweep: drop rows older than the given instant. Returns the count removed. */
  static pruneBefore = async (db: LobeChatDatabase, before: Date): Promise<number> => {
    const rows = await db
      .delete(scmWebhookDeliveries)
      .where(lt(scmWebhookDeliveries.receivedAt, before))
      .returning({ deliveryId: scmWebhookDeliveries.deliveryId });

    return rows.length;
  };
}
