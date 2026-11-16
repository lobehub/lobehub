/**
 * Browser version of SSRF-safe fetch
 * In browser environments, we simply use the native fetch API
 * as SSRF attacks are not applicable in client-side code
 */

/**
 * Options for per-call SSRF configuration overrides
 * (ignored in browser - kept for API parity with server version)
 */
export interface SSRFOptions {
  /** List of IP addresses to allow */
  allowIPAddressList?: string[];
  /** Whether to allow private/local IP addresses */
  allowPrivateIPAddress?: boolean;
  /** Maximum response body size in bytes (server-only; ignored in browser) */
  maxContentLength?: number;
}

/** Kept for API parity with the server version; the browser fetch never throws it. */
export class SSRFBlockedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SSRFBlockedError';
  }
}

/** Kept for API parity with the server version. */
export const isSSRFBlockedError = (error: unknown): boolean => {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) {
    if (current instanceof SSRFBlockedError || current.message.startsWith('SSRF blocked'))
      return true;
    seen.add(current);
    current = current.cause;
  }
  return false;
};

/**
 * Browser-safe fetch implementation
 * Uses native fetch API in browser environments
 * @param url - The URL to fetch
 * @param options - Standard fetch options
 * @param _ssrfOptions - Ignored in browser (kept for API parity)
 */
export const ssrfSafeFetch = async (
  url: string,

  options?: RequestInit,

  _ssrfOptions?: SSRFOptions,
): Promise<Response> => {
  return fetch(url, options);
};
