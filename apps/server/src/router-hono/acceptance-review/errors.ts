import { TRPCError } from '@trpc/server';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type ReviewErrorCode =
  | 'FORBIDDEN'
  | 'INTERNAL'
  | 'INVALID_INPUT'
  | 'INVALID_STATE'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'TOO_LARGE'
  | 'UNAUTHORIZED';

export const reviewError = (
  c: Context,
  status: ContentfulStatusCode,
  code: ReviewErrorCode,
  message: string,
) => c.json({ error: { code, message } }, status);

const TRPC_CODES: Partial<Record<TRPCError['code'], [ContentfulStatusCode, ReviewErrorCode]>> = {
  BAD_REQUEST: [400, 'INVALID_INPUT'],
  CONFLICT: [409, 'INVALID_STATE'],
  FORBIDDEN: [403, 'FORBIDDEN'],
  NOT_FOUND: [404, 'NOT_FOUND'],
  PAYLOAD_TOO_LARGE: [413, 'TOO_LARGE'],
  PRECONDITION_FAILED: [409, 'INVALID_STATE'],
  TOO_MANY_REQUESTS: [429, 'RATE_LIMITED'],
  UNAUTHORIZED: [401, 'UNAUTHORIZED'],
};

export const handleReviewError = (error: Error, c: Context) => {
  const mapped = error instanceof TRPCError ? TRPC_CODES[error.code] : undefined;
  if (mapped) return reviewError(c, mapped[0], mapped[1], error.message);
  console.error('[acceptance-review]', error);
  return reviewError(c, 500, 'INTERNAL', 'Something went wrong');
};
