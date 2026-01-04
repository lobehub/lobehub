import debug from 'debug';
import { NextRequest } from 'next/server';

import { getSafeOrigin } from './getSafeOrigin';

const log = debug('lobe-oidc:correctOIDCUrl');

/**
 * Fix OIDC redirect URL issues in proxy environments
 * @param req - Next.js request object
 * @param url - URL object to fix
 * @returns Fixed URL object
 */
export const correctOIDCUrl = (req: NextRequest, url: URL): URL => {
  log('Input URL: %s', url.toString());

  // Get safe origin using centralized security logic
  // Use URL's protocol as fallback to preserve original behavior
  const fallbackProtocol = url.protocol === 'https:' ? 'https' : 'http';
  const safeOrigin = getSafeOrigin(req, fallbackProtocol);

  if (!safeOrigin) {
    log('Warning: Unable to determine safe origin from request headers, returning original URL');
    return url;
  }

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
