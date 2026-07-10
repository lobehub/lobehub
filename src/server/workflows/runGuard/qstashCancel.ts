import { normalizeWorkflowRunGuardPath } from './keys';

/**
 * Default Upstash QStash origin used by the SDK when `QSTASH_URL` is not configured.
 */
const DEFAULT_QSTASH_URL = 'https://qstash.upstash.io';

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

interface CancelWorkflowRunsResponse {
  cancelled?: number;
  error?: string;
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
 * - `QSTASH_TOKEN` is configured for the Upstash Workflow REST API.
 *
 * Returns:
 * - The workflow URL prefix and QStash cancellation count.
 */
export const cancelWorkflowRunsByGuardPolicy = async (
  params: CancelWorkflowRunsByGuardPolicyParams,
): Promise<CancelWorkflowRunsByGuardPolicyResult> => {
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error('QSTASH_TOKEN is required to cancel workflow runs');

  const workflowUrlPrefix = buildWorkflowUrlPrefix(params);
  const qstashUrl = process.env.QSTASH_URL || DEFAULT_QSTASH_URL;

  // NOTICE:
  // `@upstash/workflow@0.2.23` serializes `urlStartingWith` as `{ workflowUrl: string }`,
  // but the current Workflow REST API expects the body field to be an array.
  // Source/context: production returned
  // `json: cannot unmarshal string into Go struct field CancelWorkflowRunsRequest.workflowUrl of type []string`;
  // docs: `https://upstash.com/docs/workflow/api-reference/runs/bulk-cancel-workflow-runs`.
  // Removal condition: replace this direct REST call after upgrading the SDK to a version whose
  // `client.cancel` URL-prefix branch sends the current API shape.
  const response = await fetch(new URL('/v2/workflows/runs', qstashUrl), {
    body: JSON.stringify({ workflowUrl: [workflowUrlPrefix] }),
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    method: 'DELETE',
  });

  const result = (await response.json()) as CancelWorkflowRunsResponse;

  if (!response.ok || result.error) {
    throw new Error(result.error || `QStash workflow cancellation failed: ${response.status}`);
  }

  return {
    cancelled: result.cancelled || 0,
    workflowUrlPrefix,
  };
};
