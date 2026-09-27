import type { ModifyNodesRuntimeResult } from './types';

/**
 * Tool message for a page-agent `modifyNodes` call. Failed operations are listed
 * with their reason so the model retries them instead of assuming they applied;
 * one that failed after part of it was written is flagged so a retry does not
 * duplicate the applied part.
 */
export const formatModifyNodesResult = ({
  results,
  successCount,
  totalCount,
}: ModifyNodesRuntimeResult): string => {
  const summary = Object.entries(
    results.reduce<Record<string, number>>((acc, { action }) => {
      acc[action] = (acc[action] || 0) + 1;
      return acc;
    }, {}),
  )
    .map(([action, count]) => `${count} ${action}${count > 1 ? 's' : ''}`)
    .join(', ');

  if (successCount === totalCount) {
    return `Successfully executed ${summary} (${successCount}/${totalCount} operations succeeded).`;
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
  ].join('\n');
};
