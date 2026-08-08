import type { TRPC_ERROR_CODE_KEY } from '@trpc/server/rpc';

/**
 * Detect a tRPC client error carrying the given error code.
 *
 * Structural check instead of `instanceof TRPCClientError` so it also matches
 * plain-shaped errors (e.g. rethrown/serialized across boundaries), while
 * `TRPC_ERROR_CODE_KEY` keeps the `code` literal type-checked against tRPC's
 * error-code table.
 */
export const isTrpcErrorCode = (error: unknown, code: TRPC_ERROR_CODE_KEY): boolean => {
  if (typeof error !== 'object' || error === null) return false;

  return (error as { data?: { code?: unknown } }).data?.code === code;
};
