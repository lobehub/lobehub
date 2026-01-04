import { type NextRequest } from 'next/server';

import { getSafeOrigin } from './getSafeOrigin';

/**
 * Get the correct origin for building callback URLs in reverse proxy scenarios.
 *
 * In Docker/reverse proxy environments, the request URL may be incorrect (e.g., https://0.0.0.0:3210).
 * This function uses standard proxy headers to get the real origin:
 * 1. x-forwarded-proto: the real protocol (https/http)
 * 2. x-forwarded-host: the real host (e.g., lobehub.com)
 * 3. Falls back to host header and nextUrl if proxy headers are not present
 *
 * SECURITY: Uses getSafeOrigin for comprehensive security validation:
 * - Protocol whitelist (http, https only)
 * - Host validation against APP_URL
 * - Multiple hosts handling (RFC 7239)
 * - Fallback logic for invalid forwarded values
 *
 * @param request - The Next.js request object
 * @returns The correct origin string (e.g., "https://lobehub.com")
 *
 * @example
 * ```ts
 * // Docker environment with reverse proxy
 * // Request URL: https://0.0.0.0:3210/settings
 * // Headers: x-forwarded-proto: https, x-forwarded-host: lobehub.com
 * getCallbackUrlOrigin(req) // Returns: "https://lobehub.com"
 *
 * // Direct access without proxy
 * // Request URL: https://example.com/settings
 * getCallbackUrlOrigin(req) // Returns: "https://example.com"
 * ```
 */
export const getCallbackUrlOrigin = (request: NextRequest): string => {
  const safeOrigin = getSafeOrigin(request);

  if (!safeOrigin) {
    // Fallback to request origin if safe origin cannot be determined
    return request.nextUrl.origin;
  }

  return safeOrigin;
};

/**
 * Build a complete callback URL with pathname and search params.
 * Uses getCallbackUrlOrigin to handle reverse proxy scenarios correctly.
 *
 * @param request - The Next.js request object
 * @returns The complete callback URL string
 *
 * @example
 * ```ts
 * // Request to: https://0.0.0.0:3210/settings?hl=zh-CN
 * // Headers: x-forwarded-proto: https, x-forwarded-host: lobehub.com
 * buildCallbackUrl(req) // Returns: "https://lobehub.com/settings?hl=zh-CN"
 * ```
 */
export const buildCallbackUrl = (request: NextRequest): string => {
  const origin = getCallbackUrlOrigin(request);
  const callbackUrl = `${origin}${request.nextUrl.pathname}${request.nextUrl.search}`;

  return callbackUrl;
};
