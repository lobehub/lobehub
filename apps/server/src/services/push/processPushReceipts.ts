import debug from 'debug';
import { and, eq, gt, lt } from 'drizzle-orm';
import { Expo } from 'expo-server-sdk';

import { deletePushTokensByExpoTokens } from '@/database/models/pushToken';
import { notificationDeliveries } from '@/database/schemas/notification';
import type { LobeChatDatabase } from '@/database/type';

import type { PushTicketRecord } from './types';

const log = debug('lobe-notification:push-receipts');

/** Expo retains receipts for at most 24h after send */
const RECEIPT_LOOKBACK_HOURS = 24;
/** Wait at least this long after send for a meaningful receipt status */
const RECEIPT_MIN_AGE_MINUTES = 15;

interface ProcessReceiptsOptions {
  /** Override the Expo client (used by tests) */
  expoClient?: Expo;
  /**
   * Wait window: only process deliveries sent between [now - lookbackHours, now - minAgeMinutes].
   * Defaults align with Expo's receipt retention + recommended polling cadence.
   */
  lookbackHours?: number;
  minAgeMinutes?: number;
}

export interface ProcessReceiptsResult {
  deliveriesUpdated: number;
  invalidTokensDeleted: number;
  processed: number;
  skippedMalformed: number;
}

/**
 * Receipt reconciliation worker. Designed to be called from a Vercel cron
 * route (in cloud), but is pure with respect to its inputs — pass any
 * `LobeChatDatabase` instance and it works (including in tests).
 *
 * Steps:
 *  1. Find recent `push` deliveries still in `sent` state
 *  2. Decode their `providerMessageId` (JSON `[{ ticketId, expoToken }, ...]`)
 *  3. Ask Expo for the receipts in bulk (chunked)
 *  4. Update each delivery:
 *      - all tickets ok → `delivered`
 *      - any ticket error → `failed` (failedReason aggregated)
 *  5. Tokens whose receipt says `DeviceNotRegistered` are removed from `push_tokens`
 */
export async function processPushReceipts(
  db: LobeChatDatabase,
  options: ProcessReceiptsOptions = {},
): Promise<ProcessReceiptsResult> {
  const {
    expoClient,
    lookbackHours = RECEIPT_LOOKBACK_HOURS,
    minAgeMinutes = RECEIPT_MIN_AGE_MINUTES,
  } = options;
  const expo = expoClient ?? new Expo();

  const now = Date.now();
  const lookbackFloor = new Date(now - lookbackHours * 60 * 60 * 1000);
  const minAgeCeiling = new Date(now - minAgeMinutes * 60 * 1000);

  const pending = await db
    .select({
      id: notificationDeliveries.id,
      providerMessageId: notificationDeliveries.providerMessageId,
    })
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.channel, 'push'),
        eq(notificationDeliveries.status, 'sent'),
        gt(notificationDeliveries.sentAt, lookbackFloor),
        lt(notificationDeliveries.sentAt, minAgeCeiling),
      ),
    );

  log('Found %d pending push deliveries to reconcile', pending.length);

  if (pending.length === 0) {
    return {
      deliveriesUpdated: 0,
      invalidTokensDeleted: 0,
      processed: 0,
      skippedMalformed: 0,
    };
  }

  // ticketId → { deliveryId, expoToken }
  const ticketLookup = new Map<string, { deliveryId: string; expoToken: string }>();
  // deliveryId → list of (ticketId) for aggregation
  const deliveryTickets = new Map<string, string[]>();
  let skippedMalformed = 0;

  for (const d of pending) {
    if (!d.providerMessageId) continue;

    let records: PushTicketRecord[];
    try {
      records = JSON.parse(d.providerMessageId) as PushTicketRecord[];
      if (!Array.isArray(records)) throw new Error('not an array');
    } catch (error) {
      log('Malformed providerMessageId on delivery %s: %O', d.id, error);
      skippedMalformed += 1;
      continue;
    }

    deliveryTickets.set(d.id, []);
    for (const r of records) {
      if (!r || typeof r.ticketId !== 'string' || typeof r.expoToken !== 'string') continue;
      ticketLookup.set(r.ticketId, { deliveryId: d.id, expoToken: r.expoToken });
      deliveryTickets.get(d.id)!.push(r.ticketId);
    }
  }

  if (ticketLookup.size === 0) {
    return {
      deliveriesUpdated: 0,
      invalidTokensDeleted: 0,
      processed: pending.length,
      skippedMalformed,
    };
  }

  // ticketId → 'ok' | { error: string; message?: string }
  const ticketOutcome = new Map<
    string,
    { error?: string; message?: string; status: 'error' | 'ok' }
  >();
  const ticketIds = [...ticketLookup.keys()];
  const chunks = expo.chunkPushNotificationReceiptIds(ticketIds);

  const receiptChunks = await Promise.all(
    chunks.map((chunk) => expo.getPushNotificationReceiptsAsync(chunk)),
  );
  for (const receipts of receiptChunks) {
    for (const [ticketId, receipt] of Object.entries(receipts)) {
      if (receipt.status === 'ok') {
        ticketOutcome.set(ticketId, { status: 'ok' });
      } else {
        ticketOutcome.set(ticketId, {
          error: receipt.details?.error,
          message: receipt.message,
          status: 'error',
        });
      }
    }
  }

  const invalidTokens = new Set<string>();
  const updateTasks: Promise<unknown>[] = [];

  for (const [deliveryId, tickets] of deliveryTickets) {
    const outcomes = tickets.map((id) => ticketOutcome.get(id));
    const pendingCount = outcomes.filter((o) => o === undefined).length;
    const errors = outcomes.filter((o) => o?.status === 'error');

    // Leave the delivery in 'sent' if any ticket still has no receipt — finalizing
    // now would lose visibility into later error receipts (e.g. DeviceNotRegistered)
    // and skip cleanup of invalid tokens.
    if (pendingCount > 0) continue;

    if (errors.length === 0) {
      updateTasks.push(
        db
          .update(notificationDeliveries)
          .set({ status: 'delivered' })
          .where(eq(notificationDeliveries.id, deliveryId)),
      );
    } else {
      for (const ticketId of tickets) {
        const o = ticketOutcome.get(ticketId);
        if (o?.status === 'error' && o.error === 'DeviceNotRegistered') {
          invalidTokens.add(ticketLookup.get(ticketId)!.expoToken);
        }
      }
      const reason = [...new Set(errors.map((e) => e!.error ?? e!.message ?? 'unknown'))].join(',');
      updateTasks.push(
        db
          .update(notificationDeliveries)
          .set({ failedReason: reason, status: 'failed' })
          .where(eq(notificationDeliveries.id, deliveryId)),
      );
    }
  }

  await Promise.all(updateTasks);
  const deliveriesUpdated = updateTasks.length;

  await deletePushTokensByExpoTokens(db, [...invalidTokens]);

  log(
    'Reconciliation done: processed=%d updated=%d invalidTokens=%d',
    pending.length,
    deliveriesUpdated,
    invalidTokens.size,
  );

  return {
    deliveriesUpdated,
    invalidTokensDeleted: invalidTokens.size,
    processed: pending.length,
    skippedMalformed,
  };
}
