import debug from 'debug';
import { NextRequest } from 'next/server';

import { validateRedirectHost } from './validateRedirectHost';

const log = debug('lobe-oidc:correctOIDCUrl');

// Allowed protocols for security
const ALLOWED_PROTOCOLS = ['http', 'https'] as const;

/**
 * Fix OIDC redirect URL issues in proxy environments
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
 * @param req - Next.js request object
 * @param url - URL object to fix
 * @returns Fixed URL object
 */
export const correctOIDCUrl = (req: NextRequest, url: URL): URL => {
  log('Input URL: %s', url.toString());

  // Get request headers for origin determination
  const requestHost = req.headers.get('host');
  const forwardedHost = req.headers.get('x-forwarded-host');
  const forwardedProto =
    req.headers.get('x-forwarded-proto') || req.headers.get('x-forwarded-protocol');

  log(
    'Getting safe origin - requestHost: %s, forwardedHost: %s, forwardedProto: %s',
    requestHost,
    forwardedHost,
    forwardedProto,
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
  // Use URL's protocol as fallback to preserve original behavior
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

  // Fallback protocol priority: URL protocol > request.nextUrl.protocol > 'https'
  if (!actualProto) {
    actualProto = url.protocol === 'https:' ? 'https' : 'http';
  }

  // If unable to determine valid hostname, return original URL
  if (!actualHost || actualHost === 'null') {
    log('Warning: Cannot determine valid host, returning original URL');
    return url;
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
      log('Error: No valid host available after validation, returning original URL');
      return url;
    }
  }

  // Build safe origin
  const safeOrigin = `${actualProto}://${actualHost}`;
  log('Safe origin: %s', safeOrigin);

  // Parse safe origin to get hostname and protocol
  let safeOriginUrl: URL;
  try {
    safeOriginUrl = new URL(safeOrigin);
  } catch (error) {
    log('Error parsing safe origin: %O', error);
    return url;
  }

  // Correct URL if it points to localhost or hostname doesn't match actual request host
  const needsCorrection =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '0.0.0.0' ||
    url.hostname !== safeOriginUrl.hostname;

  if (!needsCorrection) {
    log('URL does not need correction, returning original: %s', url.toString());
    return url;
  }

  log(
    'URL needs correction. Original hostname: %s, correcting to: %s',
    url.hostname,
    safeOriginUrl.hostname,
  );

  try {
    const correctedUrl = new URL(url.toString());
    correctedUrl.protocol = safeOriginUrl.protocol;
    correctedUrl.host = safeOriginUrl.host;

    log('Corrected URL: %s', correctedUrl.toString());
    return correctedUrl;
  } catch (error) {
    log('Error creating corrected URL, returning original: %O', error);
    return url;
  }
};
