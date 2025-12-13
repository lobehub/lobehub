/**
 * Browser version of SSRF-safe fetch
 * In browser environments, we simply use the native fetch API
 * as SSRF attacks are not applicable in client-side code
 */

/**
 * Browser-safe fetch implementation
 * Uses native fetch API in browser environments
 */
// eslint-disable-next-line no-undef
export const ssrfSafeFetch = async (url: string, options?: RequestInit): Promise<Response> => {
  return fetch(url, options);
};
