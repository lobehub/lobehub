import { RedisKeys } from '@/server/modules/Redis';

import { claimRedisOnce, releaseRedisClaim } from './cache';
import { getRedisServiceClient } from './client';

const getClient = () => getRedisServiceClient('agentIdentity');

// Webhook replay claims must hold across instances: a provider retry, or a captured
// delivery played back, can land on any worker, and a per-process store would accept it
// once per worker. Without Redis the claim degrades to a process-local one.
export const agentIdentity = {
  /** Claims one webhook delivery; `false` means another delivery already accepted it. */
  async claimWebhookEvent(scope: { eventId: string; provider: string }, ttlSeconds: number) {
    return claimRedisOnce(
      await getClient(),
      RedisKeys.agentIdentity.webhookEvent(scope.provider, scope.eventId),
      ttlSeconds * 1000,
    );
  },

  /** Gives a claim back after its processing failed, so the provider's retry is not dropped. */
  async releaseWebhookEvent(scope: { eventId: string; provider: string }) {
    return releaseRedisClaim(
      await getClient(),
      RedisKeys.agentIdentity.webhookEvent(scope.provider, scope.eventId),
    );
  },
};
