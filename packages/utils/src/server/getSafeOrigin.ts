import debug from 'debug';
import { NextRequest } from 'next/server';

import { validateRedirectHost } from './validateRedirectHost';

const log = debug('lobe-oidc:getSafeOrigin');

// Allowed protocols for security
const ALLOWED_PROTOCOLS = ['http', 'https'] as const;

/**
 * Get safe origin from request headers with comprehensive security validation.
 *
 * This function:
 * 1. Validates protocol against whitelist (http, https only)
 * 2. Handles X-Forwarded-Host with multiple values (RFC 7239)
 * 3. Validates X-Forwarded-Host against APP_URL to prevent open redirect attacks
 * 4. Provides fallback logic for invalid forwarded values
 *
 * Note: Only X-Forwarded-Host is validated, not the Host header. This is because:
 * - X-Forwarded-Host can be injected by attackers
 * - Host header comes from the reverse proxy or direct access, which is trusted
 *
 * @param request - Next.js request object
 * @param fallbackProtocol - Optional fallback protocol (defaults to request.nextUrl.protocol or 'https')
 * @returns Safe origin string (e.g., "https://example.com") or null if unable to determine
 */
export const getSafeOrigin = (
  request: NextRequest,
  fallbackProtocol?: 'http' | 'https',
): string | null => {
  const requestHost = request.headers.get('host');
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto =
    request.headers.get('x-forwarded-proto') || request.headers.get('x-forwarded-protocol');

  log(
    'Getting safe origin - requestHost: %s, forwardedHost: %s, forwardedProto: %s, fallbackProtocol: %s',
    requestHost,
    forwardedHost,
    forwardedProto,
    fallbackProtocol,
  );

  // Determine actual hostname with fallback values
  // Handle multiple hosts in X-Forwarded-Host (RFC 7239: comma-separated)
  let actualHost = forwardedHost || requestHost;
  if (forwardedHost && forwardedHost.includes(',')) {
    // Take the first (leftmost) host as the original client's request
    actualHost = forwardedHost.split(',')[0]!.trim();
    log('Multiple hosts in X-Forwarded-Host, using first: %s', actualHost);
  }

  // Determine actual protocol with validation
  let actualProto: string | null | undefined = forwardedProto;
  if (actualProto) {
    // Validate protocol is http or https
    const protoLower = actualProto.toLowerCase();
    if (!ALLOWED_PROTOCOLS.includes(protoLower as any)) {
      log('Warning: Invalid protocol %s, ignoring', actualProto);
      actualProto = null;
    } else {
      actualProto = protoLower;
    }
  }

  // Fallback protocol priority: fallbackProtocol > request.nextUrl.protocol > 'https'
  if (!actualProto) {
    if (fallbackProtocol) {
      actualProto = fallbackProtocol;
    } else {
      // Try nextUrl.protocol first, fall back to 'https' if not available
      try {
        actualProto = request.nextUrl?.protocol?.slice(0, -1) || 'https';
      } catch {
        actualProto = 'https';
      }
    }
  }

  // If unable to determine valid hostname, return null
  if (!actualHost || actualHost === 'null') {
    log('Warning: Cannot determine valid host');
    return null;
  }

  // Validate only X-Forwarded-Host for security, prevent Open Redirect attacks
  // Host header is trusted (comes from reverse proxy or direct access)
  if (forwardedHost && !validateRedirectHost(actualHost)) {
    log('Warning: X-Forwarded-Host %s failed validation, falling back to request host', actualHost);
    // Try to fall back to request host if forwarded host is invalid
    if (requestHost) {
      actualHost = requestHost;
    } else {
      // No valid host available
      log('Error: No valid host available after validation');
      return null;
    }
  }

  const origin = `${actualProto}://${actualHost}`;
  log('Returning safe origin: %s', origin);

  return origin;
};
