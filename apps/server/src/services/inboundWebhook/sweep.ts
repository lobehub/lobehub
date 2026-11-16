import { and, eq, inArray, lt, or } from 'drizzle-orm';
import { memoize } from 'es-toolkit';

import { getServerDB } from '@/database/core/db-adaptor';
import { InboundWebhookModel } from '@/database/models/inboundWebhook';
import { signals } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { isMcpEventsEnabled } from '@/server/services/mcp/featureGate';
import { redisService } from '@/server/services/redis';
import { afterUnscoped } from '@/server/utils/scheduleAfterResponse';

import { getInboundWebhookKind } from './kinds';
import { removeInboundWebhook } from './lifecycle';
import { scheduleInboundWebhookWake } from './scheduler';

/** Rows one sweep maintains at most. */
const MAINTENANCE_BATCH = 100;
/** Due rows one sweep may look at, skipped ones included, so a sweep stays bounded. */
const MAINTENANCE_SCAN_LIMIT = 1000;

/**
 * Due rows this sweep can act on, earliest first. Rows whose owner switched the feature off are
 * left untouched (the kill switch keeps their schedule), so the scan pages past them: otherwise the
 * same skipped rows would fill every batch and starve the ones behind them.
 */
async function dueForMaintenance(db: LobeChatDatabase) {
  const eventsEnabledFor = memoize(isMcpEventsEnabled);
  const actionable: Awaited<ReturnType<typeof InboundWebhookModel.queryMaintenance>> = [];
  let after: { id: string; nextMaintenanceAt: Date } | undefined;
  for (let scanned = 0; scanned < MAINTENANCE_SCAN_LIMIT;) {
    const page = await InboundWebhookModel.queryMaintenance(db, MAINTENANCE_BATCH, after);
    for (const row of page) {
      const skipped =
        row.status !== 'deleting' &&
        row.kind === 'mcp_events' &&
        !(await eventsEnabledFor(row.userId));
      if (!skipped) actionable.push(row);
      if (actionable.length === MAINTENANCE_BATCH) return actionable;
    }
    scanned += page.length;
    const last = page.at(-1);
    if (page.length < MAINTENANCE_BATCH || !last?.nextMaintenanceAt) break;
    after = { id: last.id, nextMaintenanceAt: last.nextMaintenanceAt };
  }
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
