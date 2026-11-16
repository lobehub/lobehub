import { and, eq, inArray, lt, or } from 'drizzle-orm';

import { getServerDB } from '@/database/core/db-adaptor';
import { InboundWebhookModel } from '@/database/models/inboundWebhook';
import { signals } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { redisService } from '@/server/services/redis';
import { afterUnscoped } from '@/server/utils/scheduleAfterResponse';

import { createKindGate, getInboundWebhookKind, INBOUND_WEBHOOK_SIGNAL_SOURCES } from './kinds';
import { removeInboundWebhook } from './lifecycle';
import { scheduleInboundWebhookWake } from './scheduler';

/** Rows one sweep maintains at most. */
const MAINTENANCE_BATCH = 100;
/** Due rows one sweep may look at, skipped ones included, so a sweep stays bounded. */
const MAINTENANCE_SCAN_LIMIT = 1000;
/** How soon a row whose owner switched the feature off is looked at again. */
export const FEATURE_OFF_RECHECK_MS = 15 * 60_000;

/**
 * Due rows this sweep can act on, earliest first. Rows whose kind is switched off for their owner are
 * not maintained (the kill switch); the scan pages past them, and they are rescheduled a little
 * later, so a long run of them cannot fill the front of every sweep's bounded scan and starve the
 * rows behind it. They are maintained within that delay once the feature is back on.
 */
async function dueForMaintenance(db: LobeChatDatabase) {
  const enabledFor = createKindGate();
  const actionable: Awaited<ReturnType<typeof InboundWebhookModel.queryMaintenance>> = [];
  const skippedIds: string[] = [];
  let after: { id: string; nextMaintenanceAt: Date } | undefined;
  for (let scanned = 0; scanned < MAINTENANCE_SCAN_LIMIT;) {
    const page = await InboundWebhookModel.queryMaintenance(db, MAINTENANCE_BATCH, after);
    for (const row of page) {
      // A kind that is switched off is not maintained, but deletions still finish.
      if (row.status === 'deleting' || (await enabledFor(row))) actionable.push(row);
      else skippedIds.push(row.id);
      if (actionable.length === MAINTENANCE_BATCH) break;
    }
    if (actionable.length === MAINTENANCE_BATCH) break;
    scanned += page.length;
    const last = page.at(-1);
    if (page.length < MAINTENANCE_BATCH || !last?.nextMaintenanceAt) break;
    after = { id: last.id, nextMaintenanceAt: last.nextMaintenanceAt };
  }
  await InboundWebhookModel.deferMaintenance(
    db,
    skippedIds,
    new Date(Date.now() + FEATURE_OFF_RECHECK_MS),
  );
  return actionable;
}

export async function sweepInboundWebhooks(db: LobeChatDatabase) {
  const rows = await dueForMaintenance(db);
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
        await getInboundWebhookKind(row.kind)?.maintain?.({ db, featureEnabled: true, model, row });
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
        inArray(signals.source, INBOUND_WEBHOOK_SIGNAL_SOURCES),
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
