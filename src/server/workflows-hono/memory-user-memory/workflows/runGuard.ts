import { type WorkflowContext } from '@upstash/workflow';

import { getRedisConfig } from '@/envs/redis';
import { initializeRedis, isRedisEnabled } from '@/libs/redis';
import { type BaseRedisProvider } from '@/libs/redis/types';
import { assertWorkflowRunAllowed, WorkflowRunGuardError } from '@/server/workflows/runGuard';

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

const getWorkflowRunId = (context: WorkflowContext<unknown>): string | undefined =>
  (context as unknown as { workflowRunId?: string }).workflowRunId;

/**
 * Details of a run guard that blocks a memory workflow.
 */
export interface MemoryWorkflowRunGuardBlock {
  /**
   * Redis key that matched the current workflow scope.
   */
  matchedKey: string;

  /**
   * Human-readable operator reason stored with the guard.
   */
  reason?: string;

  /**
   * Logical guard scope that matched.
   */
  scope: string;
}

/**
 * Extra response fields for a blocked memory workflow.
 */
type MemoryWorkflowRunGuardResponseExtra = Record<string, unknown>;

/**
 * Response returned when a memory workflow run guard blocks execution.
 *
 * @param TExtra Additional fields expected by the current workflow response shape.
 */
export type MemoryWorkflowRunGuardResponse<TExtra extends MemoryWorkflowRunGuardResponseExtra> = {
  /**
   * Human-readable skip message.
   */
  message: string;

  /**
   * Whether this workflow stopped because of a guard.
   */
  skipped: true;
} & TExtra;

/**
 * Result of a memory workflow run guard check.
 *
 * @param TExtra Additional fields expected by the current workflow response shape.
 */
export type MemoryWorkflowRunGuardCheck<TExtra extends MemoryWorkflowRunGuardResponseExtra> =
  | {
      /**
       * Whether workflow execution may continue.
       */
      result: true;
    }
  | {
      /**
       * Matched guard details for observability or custom handling.
       */
      block: MemoryWorkflowRunGuardBlock;

      /**
       * Whether workflow execution may continue.
       */
      result: false;

      /**
       * Handler-specific response to return immediately.
       */
      response: MemoryWorkflowRunGuardResponse<TExtra>;
    };

/**
 * Options for checking a memory workflow run guard.
 *
 * @param TExtra Additional fields expected by the current workflow response shape.
 */
export interface MemoryWorkflowRunGuardCheckOptions<
  TExtra extends MemoryWorkflowRunGuardResponseExtra,
> {
  /**
   * Extra fields merged into the blocked response.
   */
  response?: TExtra;

  /**
   * Step name guarded before the matching workflow operation.
   */
  stepName?: string;
}

const createBlockedResponse = <TExtra extends MemoryWorkflowRunGuardResponseExtra>(
  block: MemoryWorkflowRunGuardBlock,
  extra?: TExtra,
): MemoryWorkflowRunGuardResponse<TExtra> => ({
  ...(extra ?? ({} as TExtra)),
  message: `Memory workflow disabled by run guard (${block.reason ?? block.scope}); skipping.`,
  skipped: true,
});

/**
 * Checks a memory workflow run guard as one explicit Upstash workflow step.
 *
 * Use when:
 * - A workflow handler wants a lightweight guard check before continuing.
 * - Redis-backed guard state must be read inside `context.run`.
 * - Redis failures should inherit the shared run guard fail-open behavior.
 *
 * Expects:
 * - `context` is the active Upstash workflow context.
 * - `workflowPath` identifies the current memory workflow route.
 * - `stepName` is only provided for step-boundary checks.
 *
 * Returns:
 * - `result: true` when no guard matches.
 * - `result: false` and a workflow-shaped response when blocked.
 */
export const checkGuard = async <
  TExtra extends MemoryWorkflowRunGuardResponseExtra = MemoryWorkflowRunGuardResponseExtra,
>(
  context: WorkflowContext<unknown>,
  workflowPath: string,
  options: MemoryWorkflowRunGuardCheckOptions<TExtra> = {},
): Promise<MemoryWorkflowRunGuardCheck<TExtra>> => {
  const { response, stepName } = options;
  const block = await context.run<MemoryWorkflowRunGuardBlock | null>(
    `memory:user-memory:run-guard:${workflowPath}:${stepName ?? 'entry'}`,
    async () => {
      const redis = await getRedis();

      try {
        await assertWorkflowRunAllowed(redis, {
          stepName,
          userId: getPayloadUserId(context.requestPayload),
          workflowPath,
          workflowRunId: getWorkflowRunId(context),
        });
        return null;
      } catch (error) {
        if (error instanceof WorkflowRunGuardError) {
          return { matchedKey: error.matchedKey, reason: error.reason, scope: error.guardScope };
        }
        // The underlying guard check fails open on Redis errors, so anything else is unexpected.
        throw error;
      }
    },
  );

  return block
    ? { block, response: createBlockedResponse(block, response), result: false }
    : { result: true };
};
