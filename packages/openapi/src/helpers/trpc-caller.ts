import { TRPCError } from '@trpc/server';

/**
 * Re-raise an error thrown by a server-side tRPC caller.
 *
 * A procedure's own refusal (`NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, …) is kept
 * as the `TRPCError`, which `BaseController.handleError` maps to its HTTP
 * status. A plain error escaping the procedure arrives wrapped as
 * `INTERNAL_SERVER_ERROR`; its original cause goes to `fallback` (normally the
 * service's `handleServiceError`) so it is logged and reported like any other
 * service failure.
 */
export function rethrowCallerError(error: unknown, fallback: (error: unknown) => never): never {
  if (error instanceof TRPCError) {
    if (error.code !== 'INTERNAL_SERVER_ERROR') throw error;
    return fallback(error.cause ?? error);
  }
  return fallback(error);
}
