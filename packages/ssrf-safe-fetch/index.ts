import fetch from 'node-fetch';
import { RequestFilteringAgentOptions, useAgent as ssrfAgent } from 'request-filtering-agent';

/**
 * Options for per-call SSRF configuration overrides
 */
export interface SSRFOptions {
  /** List of IP addresses to allow */
  allowIPAddressList?: string[];
  /** Whether to allow private/local IP addresses */
  allowPrivateIPAddress?: boolean;
}

/**
 * SSRF-safe fetch implementation for server-side use
 * Uses request-filtering-agent to prevent requests to private IP addresses
 *
 * @param url - The URL to fetch
 * @param options - Standard fetch options
 * @param ssrfOptions - Optional per-call SSRF configuration overrides
 * @see https://lobehub.com/docs/self-hosting/environment-variables/basic#ssrf-allow-private-ip-address
 */
export const ssrfSafeFetch = async (
  url: string,
  // eslint-disable-next-line no-undef
  options?: RequestInit,
  ssrfOptions?: SSRFOptions,
  // eslint-disable-next-line no-undef
): Promise<Response> => {
  try {
    // Configure SSRF protection options with proper precedence using nullish coalescing
    const envAllowPrivate = process.env.SSRF_ALLOW_PRIVATE_IP_ADDRESS === '1';
    const allowPrivate = ssrfOptions?.allowPrivateIPAddress ?? envAllowPrivate;

    const agentOptions: RequestFilteringAgentOptions = {
      allowIPAddressList:
        ssrfOptions?.allowIPAddressList ??
        process.env.SSRF_ALLOW_IP_ADDRESS_LIST?.split(',').filter(Boolean) ??
        [],
      allowMetaIPAddress: allowPrivate,
      allowPrivateIPAddress: allowPrivate,
      denyIPAddressList: [],
    };

    // Use node-fetch with SSRF protection agent
    const response = await fetch(url, {
      ...options,
      agent: ssrfAgent(url, agentOptions),
    } as any);

    // Convert node-fetch Response to standard Response
    return new Response(await response.arrayBuffer(), {
      headers: response.headers as any,
      status: response.status,
      statusText: response.statusText,
    });
  } catch (error) {
    console.error('SSRF-safe fetch error:', error);
    throw new Error(
      `SSRF-safe fetch failed: ${error instanceof Error ? error.message : String(error)}. ` +
        'See: https://lobehub.com/docs/self-hosting/environment-variables/basic#ssrf-allow-private-ip-address',
    );
  }
};
