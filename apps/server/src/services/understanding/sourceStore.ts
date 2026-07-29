import { createHash } from 'node:crypto';

import {
  type CollectionDiagnostics,
  CollectionDiagnosticsSchema,
  MAX_COLLECTION_COUNT,
  MAX_PROVIDER_ID_LENGTH,
} from '@lobechat/types';
import type Redis from 'ioredis';
import { z } from 'zod';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import { MAX_SOURCE_BRIEF_LENGTH } from './sanitizer';

const SOURCE_STORE_PREFIX = 'onboarding_understanding:context';
const SOURCE_STORE_TTL_SECONDS = 3 * 24 * 60 * 60;

interface SessionReference {
  sessionId: string;
  userId: string;
}

interface ProviderReference extends SessionReference {
  providerId: string;
  revision: number;
}

export interface StoredUnderstandingProviderContext {
  context: string;
  diagnostics: CollectionDiagnostics;
  providerId: string;
  revision: number;
  sourceCount: number;
}

const StoredUnderstandingProviderContextSchema = z
  .object({
    context: z.string().max(MAX_SOURCE_BRIEF_LENGTH),
    diagnostics: CollectionDiagnosticsSchema,
    providerId: z.string().trim().min(1).max(MAX_PROVIDER_ID_LENGTH),
    revision: z.number().int().nonnegative().max(MAX_COLLECTION_COUNT),
    sourceCount: z.number().int().nonnegative().max(MAX_COLLECTION_COUNT),
  })
  .strict() satisfies z.ZodType<StoredUnderstandingProviderContext>;

const digestIdentifier = (value: string): string => {
  if (!value || value.length > 512) throw new TypeError('Invalid Understanding source identifier');
  return createHash('sha256').update(value).digest('hex');
};

const sessionKey = ({ sessionId, userId }: SessionReference): string =>
  `${SOURCE_STORE_PREFIX}:{${digestIdentifier(userId)}}:session:${digestIdentifier(sessionId)}`;

const providerField = (providerId: string, revision: number): string =>
  `${z.string().trim().min(1).max(MAX_PROVIDER_ID_LENGTH).parse(providerId)}:${z.number().int().nonnegative().max(MAX_COLLECTION_COUNT).parse(revision)}`;

export class UnderstandingSourceStore {
  private readonly redis: Redis;

  constructor(redis: Redis | null = getAgentRuntimeRedisClient()) {
    if (!redis) throw new Error('Redis is not available for onboarding Understanding sources');
    this.redis = redis;
  }

  async deleteSession(reference: SessionReference): Promise<void> {
    try {
      await this.redis.del(sessionKey(reference));
    } catch {
      throw new Error('Failed to reset onboarding Understanding provider contexts');
    }
  }

  async get(reference: ProviderReference): Promise<StoredUnderstandingProviderContext | null> {
    try {
      const field = providerField(reference.providerId, reference.revision);
      const serialized = await this.redis.hget(sessionKey(reference), field);
      if (!serialized) return null;
      const stored = StoredUnderstandingProviderContextSchema.parse(JSON.parse(serialized));
      if (
        stored.providerId !== reference.providerId ||
        stored.revision !== reference.revision ||
        providerField(stored.providerId, stored.revision) !== field
      ) {
        throw new Error('Stored provider context does not match its reference');
      }
      return stored;
    } catch {
      throw new Error('Failed to read onboarding Understanding provider context');
    }
  }

  async put(input: SessionReference & StoredUnderstandingProviderContext): Promise<void> {
    try {
      const stored = StoredUnderstandingProviderContextSchema.parse({
        context: input.context,
        diagnostics: input.diagnostics,
        providerId: input.providerId,
        revision: input.revision,
        sourceCount: input.sourceCount,
      });
      const key = sessionKey(input);
      await this.redis
        .multi()
        .hset(key, providerField(stored.providerId, stored.revision), JSON.stringify(stored))
        .expire(key, SOURCE_STORE_TTL_SECONDS)
        .exec();
    } catch {
      throw new Error('Failed to persist onboarding Understanding provider context');
    }
  }
}
