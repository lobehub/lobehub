import type { Client as WorkflowClient } from '@upstash/workflow';

import { normalizeWorkflowRunGuardPath } from './keys';

/**
 * Input used to resolve active QStash workflow runs affected by a run guard.
 */
export interface CancelWorkflowRunsByGuardPolicyParams {
  /**
   * Public application origin used by QStash workflow URLs.
   */
  appUrl: string;

  /**
   * Workflow path or URL to match as a normalized URL prefix.
   */
  workflowPath: string;
}

/**
 * Result returned after resolving and optionally cancelling QStash workflow runs.
 */
export interface CancelWorkflowRunsByGuardPolicyResult {
  /**
   * Number of workflow runs QStash reported as cancelled.
   */
  cancelled: number;

  /**
   * Deduplicated workflow run ids selected from active QStash logs.
   */
  matchedRunIds: string[];

  /**
   * Absolute workflow URL prefix used for local log filtering.
   */
  workflowUrlPrefix: string;
}

/**
 * Builds the absolute workflow URL prefix used for QStash log matching.
 *
 * Use when:
 * - Resolving workflow runs from QStash logs by workflow path.
 * - Matching child workflow endpoint prefixes under a route group.
 *
 * Expects:
 * - `appUrl` is an absolute application origin or URL.
 * - `workflowPath` may include a leading slash, query, hash, or full origin.
 *
 * Returns:
 * - A trailing-slash-free URL prefix.
 */
export const buildWorkflowUrlPrefix = ({
  appUrl,
  workflowPath,
}: CancelWorkflowRunsByGuardPolicyParams): string =>
  new URL(`/${normalizeWorkflowRunGuardPath(workflowPath)}`, appUrl).toString().replace(/\/$/, '');

const matchesWorkflowUrlPrefix = (workflowUrl: string, workflowUrlPrefix: string): boolean => {
  if (workflowUrl === workflowUrlPrefix) return true;
  if (!workflowUrl.startsWith(workflowUrlPrefix)) return false;

  const boundary = workflowUrl.at(workflowUrlPrefix.length);
  return boundary === '/' || boundary === '?' || boundary === '#';
};

/**
 * Cancels active QStash workflow runs selected by a workflow run guard policy.
 *
 * Use when:
 * - A guard with QStash cancellation enabled should stop already-started workflow runs.
 * - SDK `urlStartingWith` cancellation cannot be trusted and run ids must be resolved first.
 *
 * Expects:
 * - `client.logs` supports filtering with `{ count: 100, state: 'RUN_STARTED' }`.
 * - QStash log entries include workflow URL, state, and run id fields.
 *
 * Returns:
 * - The workflow URL prefix, matched run ids, and QStash cancellation count.
 */
export const cancelWorkflowRunsByGuardPolicy = async (
  client: Pick<WorkflowClient, 'cancel' | 'logs'>,
  params: CancelWorkflowRunsByGuardPolicyParams,
): Promise<CancelWorkflowRunsByGuardPolicyResult> => {
  const workflowUrlPrefix = buildWorkflowUrlPrefix(params);
  const logs = await client.logs({ count: 100, state: 'RUN_STARTED' });
  const matchedRunIds = Array.from(
    new Set(
      logs.runs
        .filter((run) => matchesWorkflowUrlPrefix(run.workflowUrl, workflowUrlPrefix))
        .map((run) => run.workflowRunId),
    ),
  );

  if (matchedRunIds.length === 0) {
    return { cancelled: 0, matchedRunIds, workflowUrlPrefix };
  }

  const result = await client.cancel({ ids: matchedRunIds });

  return {
    cancelled: result.cancelled || 0,
    matchedRunIds,
    workflowUrlPrefix,
  };
};
