import {
  AUTH_REQUIRED_HEADER,
  MARKET_AUTH_REQUIRED_MESSAGE,
  TRPC_ERROR_CODE_UNAUTHORIZED,
} from '@lobechat/desktop-bridge';
import { type TRPCError } from '@trpc/server';

interface ResponseMetaParams {
  ctx?: unknown;
  errors: TRPCError[];
}

const isRuntimeError = (error: TRPCError) => {
  const cause = error.cause;
  if (!cause || typeof cause !== 'object') return false;

  return typeof (cause as { errorType?: unknown }).errorType === 'string';
};

/**
 * Create response metadata for TRPC handlers.
 *
 * This function handles:
 * 1. Forwarding custom headers from context (ctx.resHeaders)
 * 2. Adding X-Auth-Required header for LobeHub session UNAUTHORIZED errors
 *
 * The X-Auth-Required header allows the desktop app (BackendProxyProtocolManager)
 * to distinguish between real LobeHub session failures (e.g., token expired)
 * and other 401 errors (e.g., invalid API keys, Market OAuth expiry).
 */
export function createResponseMeta({ ctx, errors }: ResponseMetaParams): {
  headers: Headers | undefined;
} {
  const resHeaders =
    ctx && typeof ctx === 'object' && 'resHeaders' in ctx
      ? (ctx as { resHeaders?: HeadersInit }).resHeaders
      : undefined;
  const headers = resHeaders ? new Headers(resHeaders) : new Headers();

  // Only set X-Auth-Required for LobeHub session failures, not for Market OAuth failures.
  // Market auth errors use MARKET_AUTH_REQUIRED_MESSAGE and are handled by the market-unauthorized
  // event flow (MarketAuthProvider) rather than the desktop re-login modal.
  const hasUnauthorizedError = errors.some(
    (error) =>
      error.code === TRPC_ERROR_CODE_UNAUTHORIZED &&
      error.message !== MARKET_AUTH_REQUIRED_MESSAGE &&
      !isRuntimeError(error),
  );
  if (hasUnauthorizedError) {
    headers.set(AUTH_REQUIRED_HEADER, 'true');
  }

  // Only return headers if there's content or auth error
  if (hasUnauthorizedError || resHeaders) {
    return { headers };
  }

  return { headers: undefined };
}
