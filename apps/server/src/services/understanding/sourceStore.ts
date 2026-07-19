import { createHash } from 'node:crypto';

import {
  type CollectionDiagnostics,
  CollectionDiagnosticsSchema,
  MAX_PROVIDER_ID_LENGTH,
} from '@lobechat/types';
import type Redis from 'ioredis';
import { z } from 'zod';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import { MAX_SOURCE_BRIEF_LENGTH } from './sanitizer';
import type { SourceCandidate } from './types';

const SOURCE_STORE_PREFIX = 'onboarding_understanding:source';
const SOURCE_STORE_TTL_SECONDS = 86_400;

interface SourceReference {
  sessionId: string;
  sourceId: string;
  userId: string;
}

const SourcePayloadSchema = z
  .object({
    brief: z.string().max(MAX_SOURCE_BRIEF_LENGTH),
    diagnostics: CollectionDiagnosticsSchema,
  })
  .strict();

const SourceLocatorSchema = z
  .object({
    candidateId: z.string().max(512),
    credentialOrigin: z.enum(['auth_account', 'connector', 'integration']),
    credentialReference: z.string().max(512),
    provider: z.string().max(MAX_PROVIDER_ID_LENGTH),
  })
  .strict();

export interface SourcePayload {
  brief: string;
  diagnostics: CollectionDiagnostics;
}

const digestIdentifier = (value: string): string => {
  if (!value || value.length > 512) throw new TypeError('Invalid Understanding source identifier');
  return createHash('sha256').update(value).digest('hex');
};

const sessionKey = ({ sessionId, userId }: Omit<SourceReference, 'sourceId'>): string =>
  `${SOURCE_STORE_PREFIX}:{${digestIdentifier(userId)}}:session:${digestIdentifier(sessionId)}`;

const payloadField = (sourceId: string): string => `source:${digestIdentifier(sourceId)}:payload`;
const locatorField = (sourceId: string): string => `source:${digestIdentifier(sourceId)}:locator`;

export class UnderstandingSourceStore {
  private readonly redis: Redis;

  constructor(redis: Redis | null = getAgentRuntimeRedisClient()) {
    if (!redis) throw new Error('Redis is not available for onboarding Understanding sources');
    this.redis = redis;
  }

  async deleteSourcePayload(reference: SourceReference): Promise<void> {
    await this.deleteField(reference, payloadField(reference.sourceId));
  }

  async deleteSourceLocator(reference: SourceReference): Promise<void> {
    await this.deleteField(reference, locatorField(reference.sourceId));
  }

  async deleteSession(reference: Omit<SourceReference, 'sourceId'>): Promise<void> {
    try {
      await this.redis.del(sessionKey(reference));
    } catch {
      throw new Error('Failed to reset onboarding Understanding source data');
    }
  }

  async get(reference: SourceReference): Promise<SourcePayload | null> {
    return this.readField(reference, payloadField(reference.sourceId), SourcePayloadSchema);
  }

  async getSourceLocator(reference: SourceReference): Promise<SourceCandidate | null> {
    return this.readField(reference, locatorField(reference.sourceId), SourceLocatorSchema);
  }

  async put(input: SourceReference & SourcePayload): Promise<void> {
    await this.putField(
      input,
      payloadField(input.sourceId),
      SourcePayloadSchema.parse({ brief: input.brief, diagnostics: input.diagnostics }),
    );
  }

  async putSourceLocator(input: SourceReference & { locator: SourceCandidate }): Promise<void> {
    await this.putField(
      input,
      locatorField(input.sourceId),
      SourceLocatorSchema.parse(input.locator),
    );
  }

  private async deleteField(
    reference: Omit<SourceReference, 'sourceId'>,
    field: string,
  ): Promise<void> {
    try {
      await this.redis.hdel(sessionKey(reference), field);
    } catch {
      throw new Error('Failed to delete onboarding Understanding source data');
    }
  }

  private async putField(
    reference: Omit<SourceReference, 'sourceId'>,
    field: string,
    value: unknown,
  ): Promise<void> {
    try {
      const results = await this.redis
        .multi()
        .hset(sessionKey(reference), field, JSON.stringify(value))
        .expire(sessionKey(reference), SOURCE_STORE_TTL_SECONDS)
        .exec();
      if (!results || results.some(([error]) => error)) {
        throw new Error('Redis transaction failed');
      }
    } catch {
      throw new Error('Failed to persist onboarding Understanding source data');
    }
  }

  private async readField<T>(
    reference: Omit<SourceReference, 'sourceId'>,
    field: string,
    schema: z.ZodType<T>,
  ): Promise<T | null> {
    try {
      const serialized = await this.redis.hget(sessionKey(reference), field);
      if (!serialized) return null;
      return schema.parse(JSON.parse(serialized));
    } catch {
      throw new Error('Failed to read onboarding Understanding source data');
    }
  }
}
