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
 * Result returned after cancelling QStash workflow runs by URL prefix.
 */
export interface CancelWorkflowRunsByGuardPolicyResult {
  /**
   * Number of workflow runs QStash reported as cancelled.
   */
  cancelled: number;

  /**
   * Absolute workflow URL prefix passed to the QStash workflow cancellation API.
   */
  workflowUrlPrefix: string;
}

/**
 * Builds the absolute workflow URL prefix used for QStash cancellation.
 *
 * Use when:
 * - Cancelling workflow runs from QStash by workflow path.
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

/**
 * Cancels QStash workflow runs selected by a workflow run guard policy.
 *
 * Use when:
 * - A guard with QStash cancellation enabled should stop pending and active workflow runs.
 * - QStash should resolve matching workflow runs by URL prefix.
 *
 * Expects:
 * - `client.cancel` supports `{ urlStartingWith }` for workflow URL prefix cancellation.
 *
 * Returns:
 * - The workflow URL prefix and QStash cancellation count.
 */
export const cancelWorkflowRunsByGuardPolicy = async (
  client: Pick<WorkflowClient, 'cancel'>,
  params: CancelWorkflowRunsByGuardPolicyParams,
): Promise<CancelWorkflowRunsByGuardPolicyResult> => {
  const workflowUrlPrefix = buildWorkflowUrlPrefix(params);
  const result = await client.cancel({ urlStartingWith: workflowUrlPrefix });

  return {
    cancelled: result.cancelled || 0,
    workflowUrlPrefix,
  };
};
