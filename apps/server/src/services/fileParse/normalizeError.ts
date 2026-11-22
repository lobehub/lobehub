import { isFileParseBudgetError } from '@lobechat/file-loaders';
import { TRPCError } from '@trpc/server';

import { isFileParseError, isUnsupportedFileTypeError } from './errors';

const FILE_PARSE_TRPC_CODES = {
  INPUT_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  LOAD_FAILED: 'UNPROCESSABLE_CONTENT',
  OUT_OF_MEMORY: 'PAYLOAD_TOO_LARGE',
  QUEUE_FULL: 'TOO_MANY_REQUESTS',
  QUEUE_TIMEOUT: 'TOO_MANY_REQUESTS',
  START_FAILED: 'SERVICE_UNAVAILABLE',
  TIMEOUT: 'TIMEOUT',
  UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

/**
 * Maps a parse failure to a TRPCError; anything else is returned untouched. Every check is by
 * name/code so the mapping survives errors created by another copy of the error classes.
 */
export const normalizeParseFileError = (error: unknown) => {
  if (isUnsupportedFileTypeError(error)) {
    return new TRPCError({ cause: error, code: 'BAD_REQUEST', message: error.message });
  }

  // A structural refusal (zip size, entries, cell area) is a client-side "file too large", not a
  // 500. The budget error stays as `cause` so callers can read reason / limit / actual.
  if (isFileParseBudgetError(error)) {
    return new TRPCError({ cause: error, code: 'PAYLOAD_TOO_LARGE', message: error.message });
  }

  if (isFileParseError(error)) {
    return new TRPCError({
      cause: error,
      code:
        FILE_PARSE_TRPC_CODES[error.code as keyof typeof FILE_PARSE_TRPC_CODES] ??
        'INTERNAL_SERVER_ERROR',
      message: error.message,
    });
  }

  return error;
};
