import debug from 'debug';

import { redisService } from '@/server/services/redis';

import { AGENT_SIGNAL_DEFAULTS } from '../../../constants';

const log = debug('lobe-server:agent-signal:nightly-topic-quota');

/** Input for claiming nightly review topics against the per-user nightly quota. */
export interface ClaimNightlyReviewTopicsInput {
  /** User-local review date (`YYYY-MM-DD`) shared by every agent reviewed that night. */
  localDate: string;
  /** Candidate topic ids, in priority order. Duplicates are ignored. */
  topicIds: string[];
  /** User whose nightly review is being bounded. */
  userId: string;
}

/** Outcome of one nightly topic claim. */
export interface ClaimNightlyReviewTopicsResult {
  /** Topic ids that may be processed: already counted for this night, or newly counted. */
  admitted: string[];
  /** Why some candidates were refused, when any were. */
  reason?: 'exhausted' | 'unavailable';
}

/** Claims topics against the per-user nightly quota. Injected so collectors stay pure. */
export type ClaimNightlyReviewTopics = (
  input: ClaimNightlyReviewTopicsInput,
) => Promise<ClaimNightlyReviewTopicsResult>;

/**
 * Claims topics against the user's nightly review quota in Redis.
 *
 * Use when:
 * - A nightly review is about to feed topics to an agent's review context, or the nightly
 *   expertise pass is about to ingest topics
 *
 * Expects:
 * - Every caller for the same user and night passes the same `localDate`
 *
 * Returns:
 * - The admitted subset in input order; `reason: 'exhausted'` when the night's
 *   {@link AGENT_SIGNAL_DEFAULTS.nightlyReviewTopicLimitPerUser} distinct topics are used up
 * - Nothing admitted with `reason: 'unavailable'` when Redis is missing or errors: nightly
 *   review is optional work billed to the user, so an unenforceable cap skips it
 */
export const claimNightlyReviewTopics: ClaimNightlyReviewTopics = async (input) => {
  const topicIds = [...new Set(input.topicIds.filter(Boolean))];
  if (topicIds.length === 0) return { admitted: [] };

  try {
    const admitted = await redisService.agentSignal.claimNightlyTopics({
      limit: AGENT_SIGNAL_DEFAULTS.nightlyReviewTopicLimitPerUser,
      localDate: input.localDate,
      topicIds,
      userId: input.userId,
    });

    if (!admitted) {
      log('nightly topic quota unavailable user=%s date=%s', input.userId, input.localDate);
      return { admitted: [], reason: 'unavailable' };
    }

    if (admitted.length < topicIds.length) {
      log(
        'nightly topic quota exhausted user=%s date=%s admitted=%d refused=%d limit=%d',
        input.userId,
        input.localDate,
        admitted.length,
        topicIds.length - admitted.length,
        AGENT_SIGNAL_DEFAULTS.nightlyReviewTopicLimitPerUser,
      );
      return { admitted, reason: 'exhausted' };
    }

    return { admitted };
  } catch (error) {
    console.error('[AgentSignal] Failed to claim nightly review topics, skipping:', {
      error,
      userId: input.userId,
    });
    return { admitted: [], reason: 'unavailable' };
  }
};
