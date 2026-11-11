import { toRecord } from '@lobechat/utils/object';

/**
 * Build the `cause` for a TRPCError raised from a model-runtime error.
 *
 * The lambda errorFormatter forwards `cause.data` to the client as
 * `errorData`. A plain runtime error payload is exposed there, so callers such
 * as the input-completion alert can read its structured details (for example
 * which budget rule blocked), the same payload the chat error card receives.
 * Errors that are `Error` instances or already carry `data` pass through.
 */
export const toRuntimeErrorCause = (error: unknown): unknown => {
  const record = toRecord(error);
  if (!record || error instanceof Error || 'data' in record) return error;

  return { ...record, data: record };
};
