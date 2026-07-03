import debug from 'debug';

import type { BaseRedisProvider } from '@/libs/redis/types';

import { WorkflowRunGuardError } from './errors';
import { buildWorkflowRunGuardKeys, buildWorkflowRunGuardRedisKey } from './keys';
import type {
  WorkflowRunGuardCheckScope,
  WorkflowRunGuardMatch,
  WorkflowRunGuardMutationScope,
  WorkflowRunGuardValue,
} from './types';
import {
  WORKFLOW_RUN_GUARD_DEFAULT_TTL_SECONDS,
  WORKFLOW_RUN_GUARD_KEY_PREFIX,
  WORKFLOW_RUN_GUARD_MAX_TTL_SECONDS,
} from './types';

const log = debug('lobe-server:workflows:run-guard');

/**
 * Normalizes workflow run guard TTL seconds into the supported Redis range.
 *
 * Before:
 * - Number.NaN
 * - 3.9
 * - 99_999
 *
 * After:
 * - 3600
 * - 3
 * - 86_400
 */
const normalizeTtlSeconds = (ttlSeconds?: number): number => {
  const integerTtlSeconds =
    typeof ttlSeconds === 'number' && Number.isFinite(ttlSeconds)
      ? Math.floor(ttlSeconds)
      : WORKFLOW_RUN_GUARD_DEFAULT_TTL_SECONDS;

  return Math.min(Math.max(1, integerTtlSeconds), WORKFLOW_RUN_GUARD_MAX_TTL_SECONDS);
};

const parseGuardValue = (raw: string | null): WorkflowRunGuardValue | undefined => {
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as WorkflowRunGuardValue)
      : undefined;
  } catch (error) {
    log('Ignoring malformed workflow run guard value: %O', error);
    return undefined;
  }
};

/**
 * Throws when a workflow run guard matches the provided workflow scope.
 *
 * Use when:
 * - Checking workflow execution before starting or continuing a run.
 * - Redis errors should fail open so workflow execution can continue.
 *
 * Expects:
 * - `workflowPath` is present and can be converted into guard candidates.
 * - Redis returns serialized {@link WorkflowRunGuardValue} payloads.
 *
 * Returns:
 * - Resolves when no guard matches.
 * - Rejects with {@link WorkflowRunGuardError} when the first matching guard blocks execution.
 */
export const assertWorkflowRunAllowed = async (
  redis: Pick<BaseRedisProvider, 'get'> | null,
  scope: WorkflowRunGuardCheckScope,
): Promise<void> => {
  if (!redis) return;

  try {
    for (const candidate of buildWorkflowRunGuardKeys(scope)) {
      const value = parseGuardValue(await redis.get(candidate.key));
      if (!value) continue;

      const match: WorkflowRunGuardMatch = {
        key: candidate.key,
        scope: candidate.scope,
        value,
      };

      throw new WorkflowRunGuardError({ match, scope });
    }
  } catch (error) {
    if (error instanceof WorkflowRunGuardError) throw error;

    log('Workflow run guard Redis check failed open: %O', error);
  }
};

/**
 * Creates or replaces one workflow run guard Redis entry.
 *
 * Use when:
 * - Admin or operational code needs to block a workflow scope.
 * - Mutation errors should surface to the caller.
 *
 * Expects:
 * - `scope` identifies exactly one Redis guard key.
 * - `value` is JSON-serializable.
 *
 * Returns:
 * - The Redis key, normalized TTL, and stored guard value.
 */
export const setWorkflowRunGuard = async (
  redis: Pick<BaseRedisProvider, 'set'>,
  input: {
    scope: WorkflowRunGuardMutationScope;
    ttlSeconds?: number;
    value: WorkflowRunGuardValue;
  },
) => {
  const key = buildWorkflowRunGuardRedisKey(input.scope);
  const ttlSeconds = normalizeTtlSeconds(input.ttlSeconds);
  const value: WorkflowRunGuardValue = {
    ...input.value,
    createdAt: input.value.createdAt ?? new Date().toISOString(),
    stepName: input.scope.type === 'step' ? input.scope.stepName : input.value.stepName,
  };

  await redis.set(key, JSON.stringify(value), { ex: ttlSeconds });

  return { key, ttlSeconds, value };
};

/**
 * Deletes one workflow run guard Redis entry.
 *
 * Use when:
 * - Admin or operational code needs to unblock one workflow scope.
 * - Mutation errors should surface to the caller.
 *
 * Expects:
 * - `scope` identifies exactly one Redis guard key.
 *
 * Returns:
 * - The Redis key and Redis deletion count.
 */
export const clearWorkflowRunGuard = async (
  redis: Pick<BaseRedisProvider, 'del'>,
  scope: WorkflowRunGuardMutationScope,
) => {
  const key = buildWorkflowRunGuardRedisKey(scope);
  const deleted = await redis.del(key);
  return { deleted, key };
};

/**
 * Lists current workflow run guard Redis entries.
 *
 * Use when:
 * - Admin or operational code needs to inspect active guard state.
 * - Scan/listing errors should surface to the caller.
 *
 * Expects:
 * - Redis supports cursor scan with MATCH and COUNT arguments.
 *
 * Returns:
 * - Guard entries with their key, remaining TTL seconds, and parsed value when valid.
 */
export const listWorkflowRunGuards = async (
  redis: Pick<BaseRedisProvider, 'get' | 'scan' | 'ttl'>,
) => {
  const items: Array<{ key: string; ttlSeconds: number; value?: WorkflowRunGuardValue }> = [];
  let cursor = '0';

  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      'MATCH',
      `${WORKFLOW_RUN_GUARD_KEY_PREFIX}:*`,
      'COUNT',
      100,
    );
    cursor = nextCursor;

    for (const key of keys) {
      items.push({
        key,
        ttlSeconds: await redis.ttl(key),
        value: parseGuardValue(await redis.get(key)),
      });
    }
  } while (cursor !== '0');

  return items;
};
