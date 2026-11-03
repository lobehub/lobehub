export interface MoveResultItem {
  success: boolean;
}

export const formatMoveResults = (results: MoveResultItem[]): string => {
  const successCount = results.filter((r) => r.success).length;
  const failedCount = results.length - successCount;
  const allSucceeded = failedCount === 0;
  const allFailed = successCount === 0;

  if (allSucceeded) {
    return `Successfully moved ${results.length} item(s).`;
  }

  if (allFailed) {
    return `Failed to move all ${results.length} item(s).`;
  }

  return `Moved ${successCount} item(s) successfully. Failed to move ${failedCount} item(s).`;
};
