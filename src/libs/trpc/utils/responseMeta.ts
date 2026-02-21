import { AUTH_REQUIRED_HEADER, TRPC_ERROR_CODE_UNAUTHORIZED } from '@lobechat/desktop-bridge';
import { type TRPCError } from '@trpc/server';

interface ResponseMetaParams {
  ctx?: unknown;
  errors: TRPCError[];
}

/**
 * Create response metadata for TRPC handlers.
 *
 * This function handles:
 * 1. Forwarding custom headers from context (ctx.resHeaders)
 * 2. Adding X-Auth-Required header for UNAUTHORIZED errors
 *
 * The X-Auth-Required header allows the desktop app (BackendProxyProtocolManager)
 * to distinguish between real authentication failures (e.g., token expired)
 * and other 401 errors (e.g., invalid API keys).
 */
export function createResponseMeta({ ctx, errors }: ResponseMetaParams): {
  headers: Headers | undefined;
} {
  const resHeaders =
    ctx && typeof ctx === 'object' && 'resHeaders' in ctx
      ? (ctx as { resHeaders?: HeadersInit }).resHeaders
      : undefined;
  const headers = resHeaders ? new Headers(resHeaders) : new Headers();

  const hasUnauthorizedError = errors.some((error) => error.code === TRPC_ERROR_CODE_UNAUTHORIZED);
  if (hasUnauthorizedError) {
    headers.set(AUTH_REQUIRED_HEADER, 'true');
  }

  // Only return headers if there's content or auth error
  if (hasUnauthorizedError || resHeaders) {
    return { headers };
  }

  return { headers: undefined };
}
