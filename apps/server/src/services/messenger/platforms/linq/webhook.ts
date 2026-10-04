import type { LinqWebhookDedupeStore } from '@lobechat/agent-address-linq';
import {
  createInMemoryLinqWebhookDedupeStore,
  LinqWebhookDeduplicator,
  verifyLinqWebhookRequest,
} from '@lobechat/agent-address-linq';
import debug from 'debug';

import { getMessengerLinqConfig } from '@/config/messenger';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import type { MessengerPlatformWebhookGate } from '../types';

const log = debug('lobe-server:messenger:linq:webhook-gate');

const memoryStore = createInMemoryLinqWebhookDedupeStore();

/**
 * Replay claims must be shared across instances — Linq retries a delivery to
 * whichever instance the load balancer picks. Redis `SET NX EX` gives that;
 * the bounded in-memory store only covers a Redis-less dev process.
 */
const claimKey = (id: string): string => `messenger:linq:webhook-id:${id}`;

const redisDedupeStore: LinqWebhookDedupeStore = {
  claim: async (id, ttlSeconds) => {
    const redis = getAgentRuntimeRedisClient();
    if (!redis) return memoryStore.claim(id, ttlSeconds);
    const result = await redis.set(claimKey(id), '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  },
};

/** Drop a claim so Linq's next retry of this delivery is processed. */
const releaseClaim = async (id: string): Promise<void> => {
  const redis = getAgentRuntimeRedisClient();
  // The in-memory fallback only exists for a Redis-less dev process, where a
  // lost retry is acceptable; production always has Redis.
  if (!redis) return;
  await redis.del(claimKey(id));
};

const deduplicator = new LinqWebhookDeduplicator(redisDedupeStore);

/**
 * Linq signs every delivery with the account-level Standard Webhooks secret.
 * Verify it — and only then claim the delivery id — before any sender
 * controlled field reaches link lookup or the agent runtime.
 */
export const linqWebhookGate: MessengerPlatformWebhookGate = {
  preprocess: async (req, rawBody) => {
    const config = await getMessengerLinqConfig();
    if (!config) {
      log('webhook: Linq messenger is not configured');
      return new Response('service not configured', { status: 503 });
    }

    const verified = await verifyLinqWebhookRequest(req, {
      deduplicator,
      rawBody,
      signingSecret: config.webhookSecret,
    });
    if (!verified.ok) {
      log('webhook: rejected delivery (%d)', verified.response.status);
      return verified.response;
    }

    return null;
  },

  /**
   * The claim is taken before processing so concurrent retries cannot both
   * dispatch. If processing then fails (install / bot unavailable, handler
   * threw), release it — otherwise the retry is answered 409 and the message,
   * possibly a one-time link code, is lost for good.
   */
  settle: async (req, response) => {
    if (response && response.status < 500 && response.status !== 404) return;
    const id = req.headers.get('webhook-id');
    if (!id) return;
    log('webhook: releasing claim %s after failed handling (%s)', id, response?.status ?? 'threw');
    await releaseClaim(id);
  },
};
