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

type TRPCErrorWithHttpStatus = TRPCError & { httpStatus?: number };

const getRuntimeHttpStatus = (error: TRPCError): number | undefined => {
  const status = (error as TRPCErrorWithHttpStatus).httpStatus;
  if (typeof status !== 'number' || !Number.isInteger(status)) return;
  if (status < 400 || status > 599) return;
  return status;
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
  status?: number;
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
      !getRuntimeHttpStatus(error),
  );
  if (hasUnauthorizedError) {
    headers.set(AUTH_REQUIRED_HEADER, 'true');
  }

  const runtimeHttpStatus = errors.map(getRuntimeHttpStatus).find((status) => status !== undefined);

  // Only return headers if there's content or auth error
  if (hasUnauthorizedError || resHeaders || runtimeHttpStatus) {
    return { headers, status: runtimeHttpStatus };
  }

  return { headers: undefined };
}
