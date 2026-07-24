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

/**
 * Detect the owner-only FORBIDDEN variant: the caller may be the resource's
 * creator, but the delete/transfer would take other members' conversations
 * with it (`transferHasForeignRows` guards). These need a different toast than
 * the generic "only the creator can do this" copy.
 */
export const isOwnerOnlyForbiddenError = (error: unknown): boolean => {
  if (!isForbiddenError(error)) return false;

  const data = (error as { data?: { errorData?: { code?: unknown } } }).data;
  return data?.errorData?.code === 'OWNER_ONLY';
};
