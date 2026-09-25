import type { ModifyNodesRuntimeResult } from './types';

/**
 * Tool message for a page-agent `modifyNodes` call. Failed operations are listed
 * with their reason so the model retries them instead of assuming they applied.
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
    .map((result, index) =>
      result.success
        ? undefined
        : `- Operation ${index + 1} (${result.action}): ${result.error ?? 'not applied'}`,
    )
    .filter(Boolean);

  return [
    `Only ${successCount}/${totalCount} operations succeeded (${summary} requested). Failed operations were not applied:`,
    ...failures,
    'Call getPageContent to get the current node ids before retrying the failed operations.',
  ].join('\n');
};
