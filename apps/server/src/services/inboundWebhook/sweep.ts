import { and, eq, inArray, lt, or } from 'drizzle-orm';

import { getServerDB } from '@/database/core/db-adaptor';
import { InboundWebhookModel } from '@/database/models/inboundWebhook';
import { signals } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { redisService } from '@/server/services/redis';
import { afterUnscoped } from '@/server/utils/scheduleAfterResponse';

import { getInboundWebhookKind } from './kinds';
import { removeInboundWebhook } from './lifecycle';
import { scheduleInboundWebhookWake } from './waker';

export async function sweepInboundWebhooks(db: LobeChatDatabase) {
  const rows = await InboundWebhookModel.queryMaintenance(db);
  const gateKeeper = rows.length ? await KeyVaultsGateKeeper.initWithEnvKey() : undefined;
  let maintained = 0;
  for (const row of rows) {
    if (!(await redisService.inboundWebhook.claimMaintenance(row.id))) continue;
    try {
      if (row.status === 'deleting') await removeInboundWebhook(db, row);
      else {
        const model = new InboundWebhookModel(
          db,
          row.userId,
          row.workspaceId ?? undefined,
          gateKeeper,
        );
        await getInboundWebhookKind(row.kind)?.maintain?.({ db, model, row });
      }
      maintained++;
    } catch {
      console.error('[inboundWebhook:sweep] Maintenance failed', row.id);
    }
  }
  for (const row of await InboundWebhookModel.queryStalePending(db))
    await removeInboundWebhook(db, row);
  const pending = await db
    .selectDistinct({ scopeKey: signals.scopeKey })
    .from(signals)
    .where(
      and(
        eq(signals.source, 'mcp-events'),
        inArray(signals.status, ['pending', 'failed']),
        or(eq(signals.status, 'pending'), lt(signals.attempts, 3)),
        lt(signals.updatedAt, new Date(Date.now() - 60_000)),
      ),
    )
    .limit(100);
  for (const row of pending) {
    const id = row.scopeKey?.replace(/^inbound-webhook:/, '');
    if (id) await scheduleInboundWebhookWake(id);
  }
  return { maintained, wakes: pending.length };
}

/** Opportunistic repair works even with no QStash and no Redis, with bounded local fallback. */
export function scheduleInboundWebhookSweep(): void {
  afterUnscoped(async () => {
    try {
      if (await redisService.inboundWebhook.claimSweep())
        await sweepInboundWebhooks(await getServerDB());
    } catch (error) {
      console.error('[inboundWebhook:sweep] Opportunistic sweep failed', error);
    }
  });
}
