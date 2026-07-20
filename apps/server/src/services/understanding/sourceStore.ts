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
const PUT_PROVIDER_CONTEXT_SCRIPT = `
local key = KEYS[1]
local field = ARGV[1]
local revision = tonumber(ARGV[2])
local payload = ARGV[3]
local ttl = tonumber(ARGV[4])
local current = redis.call('HGET', key, field)

if current then
  local decodedSuccessfully, decoded = pcall(cjson.decode, current)
  if not decodedSuccessfully or type(decoded) ~= 'table' or decoded.providerId ~= field or type(decoded.revision) ~= 'number' then
    return redis.error_reply('invalid provider context')
  end
  local currentRevision = decoded.revision
  if currentRevision >= revision then
    return 0
  end
end

redis.call('HSET', key, field, payload)
redis.call('EXPIRE', key, ttl)
return 1
`;

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

const providerField = (providerId: string): string =>
  z.string().trim().min(1).max(MAX_PROVIDER_ID_LENGTH).parse(providerId);

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
      const field = providerField(reference.providerId);
      const serialized = await this.redis.hget(sessionKey(reference), field);
      if (!serialized) return null;
      const stored = StoredUnderstandingProviderContextSchema.parse(JSON.parse(serialized));
      if (stored.providerId !== field || stored.revision !== reference.revision) {
        throw new Error('Stored provider context does not match its reference');
      }
      return stored;
    } catch {
      throw new Error('Failed to read onboarding Understanding provider context');
    }
  }

  async list(reference: SessionReference): Promise<StoredUnderstandingProviderContext[]> {
    try {
      const serializedByProvider = await this.redis.hgetall(sessionKey(reference));
      return Object.entries(serializedByProvider)
        .map(([field, serialized]) => {
          const stored = StoredUnderstandingProviderContextSchema.parse(JSON.parse(serialized));
          if (stored.providerId !== field) {
            throw new Error('Stored provider context does not match its field');
          }
          return stored;
        })
        .sort((left, right) => left.providerId.localeCompare(right.providerId));
    } catch {
      throw new Error('Failed to read onboarding Understanding provider contexts');
    }
  }

  async put(input: SessionReference & StoredUnderstandingProviderContext): Promise<boolean> {
    try {
      const stored = StoredUnderstandingProviderContextSchema.parse({
        context: input.context,
        diagnostics: input.diagnostics,
        providerId: input.providerId,
        revision: input.revision,
        sourceCount: input.sourceCount,
      });
      const key = sessionKey(input);
      const written = await this.redis.eval(
        PUT_PROVIDER_CONTEXT_SCRIPT,
        1,
        key,
        providerField(stored.providerId),
        String(stored.revision),
        JSON.stringify(stored),
        String(SOURCE_STORE_TTL_SECONDS),
      );
      if (written !== 0 && written !== 1) throw new Error('Unexpected Redis CAS result');
      return written === 1;
    } catch {
      throw new Error('Failed to persist onboarding Understanding provider context');
    }
  }
}
