/**
 * Detect a tRPC FORBIDDEN (HTTP 403) error thrown by workspace row-level
 * ownership checks (`assertWorkspaceRowManageable`). Used by mutation error
 * handlers to show a permission-denied toast instead of a generic failure.
 */
export const isForbiddenError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;

  const data = (error as { data?: { code?: unknown; httpStatus?: unknown } }).data;
  return data?.code === 'FORBIDDEN' || data?.httpStatus === 403;
};
