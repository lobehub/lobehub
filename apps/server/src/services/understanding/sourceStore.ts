import { createHash } from 'node:crypto';

import {
  type CollectionDiagnostics,
  CollectionDiagnosticsSchema,
  type CollectionError,
  MAX_PROVIDER_ID_LENGTH,
} from '@lobechat/types';
import type Redis from 'ioredis';
import { z } from 'zod';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import { MAX_SOURCE_BRIEF_LENGTH } from './sanitizer';
import type { SourceCandidate } from './types';

const SOURCE_STORE_PREFIX = 'onboarding_understanding:source';
const SOURCE_STORE_TTL_SECONDS = 86_400;
const SESSION_ERRORS_FIELD = 'session:errors';
const RESET_SESSION_SCRIPT = `
redis.call('SET', KEYS[2], '1', 'EX', ARGV[1])
redis.call('DEL', KEYS[1])
return 1
`;
const WRITE_FIELD_SCRIPT = `
if redis.call('EXISTS', KEYS[2]) == 1 then
  return 0
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1
`;

interface SourceReference {
  runId: string;
  sessionId: string;
  userId: string;
}

const SourcePayloadSchema = z
  .object({
    brief: z.string().max(MAX_SOURCE_BRIEF_LENGTH),
    diagnostics: CollectionDiagnosticsSchema,
  })
  .strict();

const SessionErrorsSchema = z.object({ errors: CollectionDiagnosticsSchema.shape.errors }).strict();

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

const sessionKey = ({ sessionId, userId }: Omit<SourceReference, 'runId'>): string =>
  `${SOURCE_STORE_PREFIX}:{${digestIdentifier(userId)}}:session:${digestIdentifier(sessionId)}`;

const resetTombstoneKey = ({ sessionId, userId }: Omit<SourceReference, 'runId'>): string =>
  `${SOURCE_STORE_PREFIX}:{${digestIdentifier(userId)}}:reset:${digestIdentifier(sessionId)}`;

const payloadField = (runId: string): string => `source:${digestIdentifier(runId)}:payload`;
const locatorField = (runId: string): string => `source:${digestIdentifier(runId)}:locator`;

export class UnderstandingSourceStore {
  private readonly redis: Redis;

  constructor(redis: Redis | null = getAgentRuntimeRedisClient()) {
    if (!redis) throw new Error('Redis is not available for onboarding Understanding sources');
    this.redis = redis;
  }

  async deleteSourcePayload(reference: SourceReference): Promise<void> {
    await this.redis.hdel(sessionKey(reference), payloadField(reference.runId));
  }

  async deleteSourceLocator(reference: SourceReference): Promise<void> {
    await this.redis.hdel(sessionKey(reference), locatorField(reference.runId));
  }

  async deleteSession(reference: Omit<SourceReference, 'runId'>): Promise<void> {
    try {
      const result = await this.redis.eval(
        RESET_SESSION_SCRIPT,
        2,
        sessionKey(reference),
        resetTombstoneKey(reference),
        SOURCE_STORE_TTL_SECONDS.toString(),
      );
      if (result !== 1) throw new Error('Unexpected reset script result');
    } catch {
      throw new Error('Failed to reset onboarding Understanding source data');
    }
  }

  async get(reference: SourceReference): Promise<SourcePayload | null> {
    const serialized = await this.redis.hget(sessionKey(reference), payloadField(reference.runId));
    if (!serialized) return null;
    return SourcePayloadSchema.parse(JSON.parse(serialized));
  }

  async getSessionErrors(reference: Omit<SourceReference, 'runId'>): Promise<CollectionError[]> {
    const serialized = await this.redis.hget(sessionKey(reference), SESSION_ERRORS_FIELD);
    if (!serialized) return [];
    return SessionErrorsSchema.parse(JSON.parse(serialized)).errors;
  }

  async getSourceLocator(reference: SourceReference): Promise<SourceCandidate | null> {
    const serialized = await this.redis.hget(sessionKey(reference), locatorField(reference.runId));
    if (!serialized) return null;
    return SourceLocatorSchema.parse(JSON.parse(serialized));
  }

  async put(input: SourceReference & SourcePayload): Promise<void> {
    const payload = SourcePayloadSchema.parse({
      brief: input.brief,
      diagnostics: input.diagnostics,
    });
    await this.putField(input, payloadField(input.runId), payload);
  }

  async putSessionErrors(
    input: Omit<SourceReference, 'runId'> & { errors: CollectionError[] },
  ): Promise<void> {
    await this.putField(
      input,
      SESSION_ERRORS_FIELD,
      SessionErrorsSchema.parse({ errors: input.errors }),
    );
  }

  async putSourceLocator(input: SourceReference & { locator: SourceCandidate }): Promise<void> {
    await this.putField(input, locatorField(input.runId), SourceLocatorSchema.parse(input.locator));
  }

  private async putField(
    reference: Omit<SourceReference, 'runId'>,
    field: string,
    value: unknown,
  ): Promise<void> {
    try {
      const result = await this.redis.eval(
        WRITE_FIELD_SCRIPT,
        2,
        sessionKey(reference),
        resetTombstoneKey(reference),
        field,
        JSON.stringify(value),
        SOURCE_STORE_TTL_SECONDS.toString(),
      );
      if (result !== 1) throw new Error('Unexpected write script result');
    } catch {
      throw new Error('Failed to persist onboarding Understanding source data');
    }
  }
}
