import fetch from 'node-fetch';
import type { RequestFilteringAgentOptions } from 'request-filtering-agent';
import { RequestFilteringHttpAgent, RequestFilteringHttpsAgent } from 'request-filtering-agent';

/**
 * Options for per-call SSRF configuration overrides
 */
export interface SSRFOptions {
  /** List of IP addresses to allow */
  allowIPAddressList?: string[];
  /** Whether to allow private/local IP addresses */
  allowPrivateIPAddress?: boolean;
  /**
   * Maximum response body size in bytes. When set, the body is consumed
   * incrementally and reading stops as soon as the cap is reached. The returned
   * Response contains only the bytes received up to that point (soft truncation —
   * still considered a successful response).
   *
   * Use this for any fetch that downloads untrusted content (e.g. web crawlers)
   * to prevent unbounded buffering of large or malicious responses from blowing
   * up serverless function memory.
   */
  maxContentLength?: number;
}

/**
 * Consume a node-fetch Response body up to `cap` bytes, then stop. Breaking out
 * of `for await` closes the async iterator, which destroys the underlying stream
 * and releases the HTTP connection.
 */
const readBodyWithCap = async (
  body: NodeJS.ReadableStream | null,
  cap: number,
): Promise<Uint8Array> => {
  if (!body) return new Uint8Array(0);

  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = cap - total;
    if (buf.length >= remaining) {
      chunks.push(buf.subarray(0, remaining));
      total = cap;
      break;
    }
    chunks.push(buf);
    total += buf.length;
  }

  return Buffer.concat(chunks, total);
};

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

  options?: RequestInit,
  ssrfOptions?: SSRFOptions,
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

    // Create agents for both protocols
    const httpAgent = new RequestFilteringHttpAgent(agentOptions);
    const httpsAgent = new RequestFilteringHttpsAgent(agentOptions);

    // Use node-fetch with SSRF protection agent
    // Pass a function to dynamically select agent based on URL protocol
    // This handles redirects from HTTP to HTTPS correctly
    const response = await fetch(url, {
      ...options,
      agent: (parsedURL: URL) => (parsedURL.protocol === 'https:' ? httpsAgent : httpAgent),
    } as any);

    const cap = ssrfOptions?.maxContentLength;
    const body: BodyInit =
      cap && cap > 0
        ? // Buffer is a Uint8Array subclass; the Response constructor accepts it at
          // runtime even though the BodyInit lib type doesn't list Uint8Array.
          ((await readBodyWithCap(response.body as NodeJS.ReadableStream | null, cap)) as any)
        : await response.arrayBuffer();

    // Convert node-fetch Response to standard Response
    return new Response(body, {
      headers: response.headers as any,
      status: response.status,
      statusText: response.statusText,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // request-filtering-agent errors contain "is not allowed" when blocking private/denied IPs
    const isSSRFBlock = errorMessage.includes('is not allowed');

    if (isSSRFBlock) {
      console.error('SSRF protection blocked request:', error);
      throw new Error(
        `SSRF blocked: ${errorMessage}. ` +
          'See: https://lobehub.com/docs/self-hosting/environment-variables/basic#ssrf-allow-private-ip-address',
        { cause: error },
      );
    }

    console.error('Fetch error:', error);
    throw new Error(`Fetch failed: ${errorMessage}`, { cause: error });
  }
};
