import { type WorkflowContext } from '@upstash/workflow';

import { getRedisConfig } from '@/envs/redis';
import { initializeRedis, isRedisEnabled } from '@/libs/redis';
import { type BaseRedisProvider } from '@/libs/redis/types';
import { assertWorkflowRunAllowed } from '@/server/workflows/runGuard';

interface MemoryWorkflowGuardInput {
  payload?: unknown;
  stepName?: string;
  workflowPath: string;
  workflowRunId?: string;
}

const getWorkflowRunId = (context: WorkflowContext<unknown>): string | undefined =>
  (context as unknown as { workflowRunId?: string }).workflowRunId;

const getRedis = async (): Promise<BaseRedisProvider | null> => {
  const config = getRedisConfig();
  if (!isRedisEnabled(config)) return null;

  return initializeRedis(config);
};

const getPayloadUserId = (payload: unknown): string | undefined => {
  if (!payload || typeof payload !== 'object') return undefined;

  const userId = 'userId' in payload ? payload.userId : undefined;
  if (typeof userId === 'string' && userId) return userId;

  const userIds = 'userIds' in payload ? payload.userIds : undefined;
  if (!Array.isArray(userIds)) return undefined;

  return userIds.find((id): id is string => typeof id === 'string' && id.length > 0);
};

/**
 * Checks whether a memory workflow run may continue for the provided scope.
 *
 * Use when:
 * - Memory workflow handlers start or reach an expensive step boundary.
 * - Redis failures should inherit the shared run guard fail-open behavior.
 *
 * Expects:
 * - `workflowPath` identifies the current memory workflow route.
 * - `payload` may include `userId` or `userIds` for user-level guard checks.
 *
 * Returns:
 * - Resolves when no guard blocks the workflow.
 * - Rejects with the shared guard error when a matching guard exists.
 */
export const assertMemoryWorkflowRunAllowed = async ({
  payload,
  stepName,
  workflowPath,
  workflowRunId,
}: MemoryWorkflowGuardInput): Promise<void> => {
  const redis = await getRedis();

  await assertWorkflowRunAllowed(redis, {
    stepName,
    userId: getPayloadUserId(payload),
    workflowPath,
    workflowRunId,
  });
};

/**
 * Checks whether a memory workflow context may continue for a route or step.
 *
 * Use when:
 * - A Hono Upstash workflow handler has a concrete {@link WorkflowContext}.
 * - The caller wants to include the current workflow run id when available.
 *
 * Expects:
 * - `workflowPath` is the route path serving the current workflow.
 * - `stepName` is passed before the matching `context.run` or `context.invoke` call.
 *
 * Returns:
 * - Resolves when no guard blocks the workflow.
 * - Rejects with the shared guard error when a matching guard exists.
 */
export const assertMemoryWorkflowContextAllowed = async (
  context: WorkflowContext<unknown>,
  workflowPath: string,
  stepName?: string,
): Promise<void> => {
  await assertMemoryWorkflowRunAllowed({
    payload: context.requestPayload,
    stepName,
    workflowPath,
    workflowRunId: getWorkflowRunId(context),
  });
};
