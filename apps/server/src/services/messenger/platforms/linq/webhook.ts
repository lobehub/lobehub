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
const redisDedupeStore: LinqWebhookDedupeStore = {
  claim: async (id, ttlSeconds) => {
    const redis = getAgentRuntimeRedisClient();
    if (!redis) return memoryStore.claim(id, ttlSeconds);
    const result = await redis.set(`messenger:linq:webhook-id:${id}`, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  },
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
};
