import { TransferErrorCode } from '@/types/transferError';

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

/**
 * Detect the tRPC CONFLICT (HTTP 409) a delete gets while an async history
 * backfill (transfer or copy) still covers the resource. The refusal is
 * temporary — the drain finishes within minutes — so the toast must say
 * "wait", not the generic "operation failed, please try again", which reads
 * as "retry now" and keeps failing until the job completes.
 */
export const isHistoryMigratingError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;

  const data = (
    error as { data?: { code?: unknown; errorData?: { code?: unknown }; httpStatus?: unknown } }
  ).data;
  if (data?.code !== 'CONFLICT' && data?.httpStatus !== 409) return false;

  const code = data.errorData?.code;
  return code === TransferErrorCode.TransferInProgress || code === TransferErrorCode.CopyInProgress;
};

/**
 * Map a failed agent/group delete to its `common`-namespace toast copy, from
 * most to least specific: still-migrating history, owner-only refusal, plain
 * permission refusal, then the generic fallback. Every delete surface shows
 * the same set of refusals, so the mapping lives here instead of being
 * re-spelled as a ternary chain at each call site.
 */
export const getDeleteErrorMessageKey = (
  error: unknown,
): 'deleteHistoryMigrating' | 'deleteSharedOwnerOnly' | 'manageOnlyCreator' | 'operationFailed' => {
  if (isHistoryMigratingError(error)) return 'deleteHistoryMigrating';
  if (isOwnerOnlyForbiddenError(error)) return 'deleteSharedOwnerOnly';
  if (isForbiddenError(error)) return 'manageOnlyCreator';
  return 'operationFailed';
};
