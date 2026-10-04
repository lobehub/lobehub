import { TRPCError } from '@trpc/server';

import { ScopeLevelError } from '@/database/utils/scopeLevel';
import { WidgetFlowError } from '@/server/services/widget';

const FLOW_ERROR_CODES = {
  DRY_RUN_REQUIRED: 'PRECONDITION_FAILED',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_SCHEDULE: 'BAD_REQUEST',
  NOT_FOUND: 'NOT_FOUND',
  NOT_ROLLBACK_TARGET: 'BAD_REQUEST',
  NO_VERSION: 'PRECONDITION_FAILED',
} as const;

export const notFound = (what: string) =>
  new TRPCError({ code: 'NOT_FOUND', message: `${what} not found` });

/**
 * Map widget / dashboard domain errors to TRPC errors. Missing and invisible
 * parents both read as NOT_FOUND so ids from other scopes are not confirmed
 * to exist; anything unexpected is logged and surfaces as a 500.
 */
export function mapWidgetError(error: unknown, domain: string, operation: string): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof WidgetFlowError) {
    throw new TRPCError({ code: FLOW_ERROR_CODES[error.code], message: error.message });
  }
  if (error instanceof ScopeLevelError) {
    throw new TRPCError({
      code: error.code === 'SCOPE_MISMATCH' ? 'BAD_REQUEST' : 'NOT_FOUND',
      message: error.message,
    });
  }
  console.error(`[${domain}:${operation}]`, error);
  throw new TRPCError({
    cause: error,
    code: 'INTERNAL_SERVER_ERROR',
    message: `Failed to ${operation}`,
  });
}
