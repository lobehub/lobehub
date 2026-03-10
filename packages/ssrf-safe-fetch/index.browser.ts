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
}

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
