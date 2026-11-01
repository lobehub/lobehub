import { createHash } from 'node:crypto';

import type {
  WorkflowRunGuardCheckScope,
  WorkflowRunGuardKeyCandidate,
  WorkflowRunGuardMutationScope,
} from './types';
import { WORKFLOW_RUN_GUARD_KEY_PREFIX } from './types';

/**
 * Normalizes workflow paths for guard key construction.
 *
 * Before:
 * - "https://app.lobehub.com/api/workflows/demo/"
 * - "/api/workflows/demo/?x=1#hash"
 * - "api/workflows/demo?x=1#hash"
 *
 * After:
 * - "api/workflows/demo"
 * - "api/workflows/demo"
 * - "api/workflows/demo"
 */
export const normalizeWorkflowRunGuardPath = (value: string): string => {
  const { pathname } = (() => {
    try {
      return new URL(value);
    } catch {
      return new URL(value, 'https://workflow-run-guard.local');
    }
  })();

  return pathname.replace(/^\/+/, '').replace(/\/+$/, '');
};

/**
 * Hashes a workflow step name into a short stable key fragment.
 *
 * Use when:
 * - Building step-scoped run guard keys.
 *
 * Expects:
 * - The input is the exact workflow step name to protect.
 *
 * Returns:
 * - A 16-character lowercase hexadecimal SHA-256 prefix.
 */
export const hashWorkflowRunGuardStepName = (stepName: string): string =>
  createHash('sha256').update(stepName).digest('hex').slice(0, 16);

/**
 * Builds the Redis key for one workflow run guard mutation scope.
 *
 * Use when:
 * - Creating, deleting, or reading a direct guard key.
 *
 * Expects:
 * - Path scopes may pass a path or URL.
 * - Step scopes include both workflow run id and step name.
 *
 * Returns:
 * - The Redis key for the provided scope.
 */
export const buildWorkflowRunGuardRedisKey = (scope: WorkflowRunGuardMutationScope): string => {
  switch (scope.type) {
    case 'global': {
      return `${WORKFLOW_RUN_GUARD_KEY_PREFIX}:global`;
    }

    case 'path': {
      return `${WORKFLOW_RUN_GUARD_KEY_PREFIX}:path:${normalizeWorkflowRunGuardPath(
        scope.workflowPath,
      )}`;
    }

    case 'user': {
      return `${WORKFLOW_RUN_GUARD_KEY_PREFIX}:user:${scope.userId}`;
    }

    case 'run': {
      return `${WORKFLOW_RUN_GUARD_KEY_PREFIX}:run:${scope.workflowRunId}`;
    }

    case 'step': {
      return `${WORKFLOW_RUN_GUARD_KEY_PREFIX}:step:${scope.workflowRunId}:${hashWorkflowRunGuardStepName(
        scope.stepName,
      )}`;
    }
  }
};

const buildPathPrefixKeys = (workflowPath: string): WorkflowRunGuardKeyCandidate[] => {
  const normalized = normalizeWorkflowRunGuardPath(workflowPath);

  if (!normalized) return [];

  const segments = normalized.split('/').filter(Boolean);

  return segments.map((_, index) => ({
    key: `${WORKFLOW_RUN_GUARD_KEY_PREFIX}:path:${segments.slice(0, index + 1).join('/')}`,
    scope: 'path-prefix',
  }));
};

/**
 * Builds all workflow run guard candidate keys in check order.
 *
 * Use when:
 * - Evaluating whether a workflow request or step should be blocked.
 *
 * Expects:
 * - `workflowPath` is always present.
 * - `workflowRunId` is present when step-level matching is needed.
 *
 * Returns:
 * - Candidate keys ordered from broadest guard to narrowest guard.
 */
export const buildWorkflowRunGuardKeys = (
  scope: WorkflowRunGuardCheckScope,
): WorkflowRunGuardKeyCandidate[] => [
  { key: buildWorkflowRunGuardRedisKey({ type: 'global' }), scope: 'global' },
  ...buildPathPrefixKeys(scope.workflowPath),
  ...(scope.userId
    ? [
        {
          key: buildWorkflowRunGuardRedisKey({ type: 'user', userId: scope.userId }),
          scope: 'user' as const,
        },
      ]
    : []),
  ...(scope.workflowRunId
    ? [
        {
          key: buildWorkflowRunGuardRedisKey({ type: 'run', workflowRunId: scope.workflowRunId }),
          scope: 'run' as const,
        },
      ]
    : []),
  ...(scope.workflowRunId && scope.stepName
    ? [
        {
          key: buildWorkflowRunGuardRedisKey({
            stepName: scope.stepName,
            type: 'step',
            workflowRunId: scope.workflowRunId,
          }),
          scope: 'step' as const,
        },
      ]
    : []),
];
