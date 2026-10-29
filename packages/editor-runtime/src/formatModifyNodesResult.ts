import type { ModifyNodesRuntimeResult } from './types';

/**
 * Appended when the host editor keeps AI edits as review diffs.
 *
 * Without it the model reports "已修改" as soon as the tool returns, while the
 * page still shows the previous content until the user accepts the diff — and
 * it then builds follow-up operations on content that is not live yet.
 */
export const PENDING_REVIEW_NOTE =
  'These edits are review diffs: they are NOT live yet. The page keeps showing the old content until the user accepts them, and the user may reject them instead. Describe them as proposed changes waiting for acceptance — never say the page has been updated, and do not assume a later operation can build on them as if they were applied.';

export interface FormatModifyNodesOptions {
  /**
   * Whether the host renders pending edits as review diffs at all. The server
   * runtime writes straight to the document and passes nothing; the live
   * editor passes true so the per-operation `pendingReview` flags are reported.
   */
  pendingReview?: boolean;
}

/**
 * Tool message for a page-agent `modifyNodes` call. Failed operations are listed
 * with their reason so the model retries them instead of assuming they applied;
 * one that failed after part of it was written is flagged so a retry does not
 * duplicate the applied part.
 */
export const formatModifyNodesResult = (
  { results, successCount, totalCount }: ModifyNodesRuntimeResult,
  options: FormatModifyNodesOptions = {},
): string => {
  const summary = Object.entries(
    results.reduce<Record<string, number>>((acc, { action }) => {
      acc[action] = (acc[action] || 0) + 1;
      return acc;
    }, {}),
  )
    .map(([action, count]) => `${count} ${action}${count > 1 ? 's' : ''}`)
    .join(', ');

  // Only operations the editor actually kept as a diff are pending; list and
  // table edits are written directly and are live immediately. A `modify` split
  // across several steps can leave a diff behind while the operation as a whole
  // reports failure, so partial results count here too.
  const pendingCount = results.filter((result) => result.pendingReview).length;
  const hasPendingPartial = results.some((result) => result.pendingReview && !result.success);
  const reviewNote =
    options.pendingReview && pendingCount > 0
      ? pendingCount === successCount
        ? PENDING_REVIEW_NOTE
        : [
            `${pendingCount} of ${totalCount} operations are review diffs and are NOT live yet.`,
            hasPendingPartial
              ? 'One of them failed after part of it was written, so that fragment is pending too.'
              : '',
            pendingCount < totalCount ? 'The remaining operations are live in the page.' : '',
            PENDING_REVIEW_NOTE,
          ]
            .filter(Boolean)
            .join(' ')
      : '';

  if (successCount === totalCount) {
    return [
      `Successfully executed ${summary} (${successCount}/${totalCount} operations succeeded).`,
      reviewNote,
    ]
      .filter(Boolean)
      .join('\n');
  }

  const failures = results
    .map((result, index) => {
      if (result.success) return undefined;

      const reason = result.error ?? 'not applied';
      return result.partiallyApplied
        ? `- Operation ${index + 1} (${result.action}): PARTIALLY APPLIED — some of its fragments were already written before it failed: ${reason}`
        : `- Operation ${index + 1} (${result.action}): ${reason}`;
    })
    .filter(Boolean);
  const hasPartial = results.some((result) => !result.success && result.partiallyApplied);

  return [
    `Only ${successCount}/${totalCount} operations succeeded (${summary} requested). ${
      hasPartial
        ? 'Failed operations were not applied, except those marked PARTIALLY APPLIED:'
        : 'Failed operations were not applied:'
    }`,
    ...failures,
    hasPartial
      ? 'Call getPageContent to get the current node ids and content before retrying; re-send only the parts of a partially applied operation that are still missing.'
      : 'Call getPageContent to get the current node ids before retrying the failed operations.',
    reviewNote,
  ]
    .filter(Boolean)
    .join('\n');
};
