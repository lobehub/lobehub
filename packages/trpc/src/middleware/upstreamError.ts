import { TRPCError } from '@trpc/server';

import { trpc } from '../lambda/init';

type UpstreamErrorCode = 'BAD_GATEWAY' | 'GATEWAY_TIMEOUT';

interface SdkErrorLike {
  $fault?: string;
  $metadata?: { attempts?: number; httpStatusCode?: number };
  code?: string;
  name?: string;
}

// Socket-level failures: the request never got an HTTP response from upstream.
const NETWORK_ERROR_CODES = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EPIPE',
]);

const MAX_CAUSE_DEPTH = 5;

/**
 * AWS SDK v3 errors (S3 / R2, ...) all carry `$metadata` once they leave the
 * retry middleware, whether they are service errors or network failures.
 */
const isSdkError = (error: unknown): error is SdkErrorLike =>
  !!error &&
  typeof error === 'object' &&
  '$metadata' in error &&
  !!(error as SdkErrorLike).$metadata &&
  typeof (error as SdkErrorLike).$metadata === 'object';

const classifySdkError = (error: SdkErrorLike): UpstreamErrorCode | undefined => {
  const status = error.$metadata?.httpStatusCode;

  if (typeof status === 'number') return status >= 500 ? 'BAD_GATEWAY' : undefined;
  if (error.$fault === 'server') return 'BAD_GATEWAY';

  if (error.name === 'TimeoutError' || error.code === 'ETIMEDOUT') return 'GATEWAY_TIMEOUT';
  if (error.code && NETWORK_ERROR_CODES.has(error.code)) return 'BAD_GATEWAY';

  // Anything else without a response (credentials, serialization, ...) is ours.
  return undefined;
};

/**
 * Map an error raised by an upstream dependency to the HTTP semantics it deserves:
 * upstream returned 5xx / connection failed → 502, upstream timed out → 504.
 * Returns `undefined` for anything that is not clearly an upstream failure, so
 * our own bugs keep surfacing as 500.
 */
export const toUpstreamTRPCError = (error: TRPCError): TRPCError | undefined => {
  // Respect codes routers chose deliberately; only reclassify the generic 500.
  if (error.code !== 'INTERNAL_SERVER_ERROR') return;

  let current: unknown = error.cause;
  for (let depth = 0; current && depth < MAX_CAUSE_DEPTH; depth++) {
    if (isSdkError(current)) {
      const code = classifySdkError(current);
      if (!code) return;

      const status = current.$metadata?.httpStatusCode;
      const reason = current.name || current.code || 'UnknownError';

      return new TRPCError({
        cause: current as Error,
        code,
        message: `Upstream service error${status ? ` (HTTP ${status})` : ''}: ${reason}`,
      });
    }

    current = (current as { cause?: unknown }).cause;
  }
};

/**
 * Reclassify upstream failures that bubbled up as INTERNAL_SERVER_ERROR, so an
 * R2 / S3 outage shows up as 502/504 instead of being indistinguishable from
 * our own 500s in monitoring and on the client.
 */
export const upstreamError = trpc.middleware(async ({ next }) => {
  const result = await next();
  if (result.ok) return result;

  const mapped = toUpstreamTRPCError(result.error);
  if (mapped) throw mapped;

  return result;
});
