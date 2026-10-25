import { and, isNull, lt, sql } from 'drizzle-orm';

import { signals } from '../schemas';
import type { LobeChatDatabase } from '../type';

/** Rows kept per `(user, channel, source)` bucket when the caller does not say otherwise. */
export const DEFAULT_SIGNAL_RETENTION_PER_SOURCE = 10_000;
/** How long a signal keeps its raw `payload`. The row and its decisions outlive it. */
export const DEFAULT_SIGNAL_PAYLOAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Upper bound on buckets/rows one sweep touches, so a single tick stays short. */
export const DEFAULT_SIGNAL_SWEEP_BATCH = 500;

export interface SignalRetentionOptions {
  /** Upper bound on buckets (prune) or rows (payload) handled per call. */
  limit?: number;
  now?: Date;
}

export interface PruneSignalOverflowOptions extends SignalRetentionOptions {
  keepPerSource?: number;
}

export interface PurgeSignalPayloadsOptions extends SignalRetentionOptions {
  payloadTtlMs?: number;
}

/**
 * Cross-user retention sweeps over `signals`. Deliberately not user-scoped: it runs from a
 * scheduled job, not a request.
 *
 * A signal is *promoted* — never pruned — when a `signal_decisions` row points at it (which
 * covers woken and labelled ones, since a label hangs off a decision) or an `agent_mails` row was
 * parsed from it. Promoted rows do not count toward a bucket's quota either, so a busy channel's
 * evidence cannot squeeze out its recent history.
 */
export class SignalRetentionModel {
  /**
   * Keeps the newest `keepPerSource` unpromoted rows of every `(user_id, scope_key, source)`
   * bucket and deletes the rest.
   *
   * Returns the number of rows deleted and the buckets it looked at.
   */
  static pruneOverflow = async (db: LobeChatDatabase, options: PruneSignalOverflowOptions = {}) => {
    const keep = Math.max(
      0,
      Math.floor(options.keepPerSource ?? DEFAULT_SIGNAL_RETENTION_PER_SOURCE),
    );
    const limit = options.limit ?? DEFAULT_SIGNAL_SWEEP_BATCH;

    const unpromoted = sql`NOT EXISTS (SELECT 1 FROM signal_decisions d WHERE d.signal_id = ${signals.id})
      AND NOT EXISTS (SELECT 1 FROM agent_mails m WHERE m.signal_id = ${signals.id})`;

    const buckets = await db
      .select({
        scopeKey: signals.scopeKey,
        source: signals.source,
        userId: signals.userId,
      })
      .from(signals)
      .where(unpromoted)
      .groupBy(signals.userId, signals.scopeKey, signals.source)
      .having(sql`count(*) > ${keep}`)
      .limit(limit);

    let deleted = 0;
    for (const bucket of buckets) {
      const result = await db.execute(sql`
        DELETE FROM signals
        WHERE id IN (
          SELECT s.id FROM signals s
          WHERE s.user_id = ${bucket.userId}
            AND s.source = ${bucket.source}
            AND s.scope_key IS NOT DISTINCT FROM ${bucket.scopeKey}
            AND NOT EXISTS (SELECT 1 FROM signal_decisions d WHERE d.signal_id = s.id)
            AND NOT EXISTS (SELECT 1 FROM agent_mails m WHERE m.signal_id = s.id)
          ORDER BY s.created_at DESC, s.id DESC
          OFFSET ${keep}
        )
        RETURNING id
      `);
      // `rows` is the one shape node-postgres and PGlite share; `rowCount` is not.
      deleted += result.rows.length;
    }

    return { buckets: buckets.length, deleted };
  };

  /**
   * Blanks `payload` on rows older than the TTL and stamps `payload_purged_at`, promoted rows
   * included: evidence keeps its shape and decisions, not the raw content.
   *
   * Returns the number of rows purged.
   */
  static purgeExpiredPayloads = async (
    db: LobeChatDatabase,
    options: PurgeSignalPayloadsOptions = {},
  ) => {
    const now = options.now ?? new Date();
    const cutoff = new Date(
      now.getTime() - (options.payloadTtlMs ?? DEFAULT_SIGNAL_PAYLOAD_TTL_MS),
    );
    const limit = options.limit ?? DEFAULT_SIGNAL_SWEEP_BATCH;

    const expired = db
      .select({ id: signals.id })
      .from(signals)
      .where(and(isNull(signals.payloadPurgedAt), lt(signals.createdAt, cutoff)))
      .orderBy(signals.createdAt)
      .limit(limit);

    const rows = await db
      .update(signals)
      .set({ payload: {}, payloadPurgedAt: now })
      .where(sql`${signals.id} IN (${expired})`)
      .returning({ id: signals.id });

    return { purged: rows.length };
  };
}
