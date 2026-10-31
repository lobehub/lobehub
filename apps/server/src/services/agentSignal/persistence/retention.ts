import {
  DEFAULT_SIGNAL_PAYLOAD_TTL_MS,
  DEFAULT_SIGNAL_RETENTION_PER_SOURCE,
  SignalRetentionModel,
} from '@/database/models/signalRetention';
import type { LobeChatDatabase } from '@/database/type';

export interface SignalRetentionConfig {
  /** Newest unpromoted rows kept per `(user, channel, source)`. Defaults to 10 000. */
  keepPerSource?: number;
  /** Buckets (prune) / rows (payload purge) handled per sweep. */
  limit?: number;
  /** How long a row keeps its raw payload. Defaults to 7 days. */
  payloadTtlHours?: number;
}

export interface SignalRetentionOutcome {
  buckets: number;
  deleted: number;
  purgedPayloads: number;
}

const positive = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

/**
 * One retention tick over `signals`: blank expired payloads, then prune buckets over their quota.
 * Rows a decision points at are never pruned (see {@link SignalRetentionModel}).
 *
 * Use when:
 * - A scheduled job wants to bound the table; safe to run as often as hourly and to re-run
 */
export const sweepSignals = async (
  db: LobeChatDatabase,
  config: SignalRetentionConfig = {},
  now = new Date(),
): Promise<SignalRetentionOutcome> => {
  const limit = positive(config.limit);
  const payloadTtlHours = positive(config.payloadTtlHours);

  const { purged } = await SignalRetentionModel.purgeExpiredPayloads(db, {
    limit,
    now,
    payloadTtlMs: payloadTtlHours
      ? payloadTtlHours * 60 * 60 * 1000
      : DEFAULT_SIGNAL_PAYLOAD_TTL_MS,
  });
  const { buckets, deleted } = await SignalRetentionModel.pruneOverflow(db, {
    keepPerSource: positive(config.keepPerSource) ?? DEFAULT_SIGNAL_RETENTION_PER_SOURCE,
    limit,
    now,
  });

  return { buckets, deleted, purgedPayloads: purged };
};
