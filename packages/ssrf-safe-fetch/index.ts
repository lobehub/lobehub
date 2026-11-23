import dns from 'node:dns';
import net from 'node:net';

import fetch from 'node-fetch';
import { RequestFilteringHttpAgent, RequestFilteringHttpsAgent } from 'request-filtering-agent';

import {
  assertAddressAllowed,
  blockedError,
  resolveAgentOptions,
  SSRF_BLOCKED_PREFIX,
  SSRF_DOCS_URL,
  SSRFBlockedError,
  type SSRFOptions,
} from './policy';

export type { CreateSsrfSafeFetchOptions } from './guardedFetch';
export { createSsrfSafeDispatcher, createSsrfSafeFetch, validateSsrfAddress } from './guardedFetch';
export type { SSRFOptions } from './policy';
export {
  findSSRFBlockedError,
  isSSRFBlockedError,
  matchIPAddressList,
  resolveAgentOptions,
  SSRF_BLOCKED_PREFIX,
  SSRF_DOCS_URL,
  SSRFBlockedError,
} from './policy';

/** Statuses whose Response must have a null body (Fetch standard "null body status"). */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

type NodeBody = NodeJS.ReadableStream & { destroy?: (error?: Error) => void };

/** A URL inside an error message (node-fetch puts the full request URL in its errors). */
const URL_IN_TEXT = /\b[a-z][\d+.a-z-]*:\/\/[^\s"'<>]+/gi;

/** Reduce every URL in `text` to its origin: paths, queries and userinfo can carry credentials. */
const redactUrls = (text: string) =>
  text.replaceAll(URL_IN_TEXT, (match) => {
    try {
      const { origin } = new URL(match);
      return origin === 'null' ? '[url]' : origin;
    } catch {
      return '[url]';
    }
  });

/** What a fetch failure is logged as: never the raw error, whose message and cause hold the URL. */
const toErrorLog = (error: unknown) => {
  if (!(error instanceof Error)) return { message: redactUrls(String(error)) };
  const { code } = error as { code?: unknown };
  return {
    ...(typeof code === 'string' && { code }),
    message: redactUrls(error.message),
    name: error.name,
  };
};

const toFetchError = (error: unknown): Error => {
  if (error instanceof SSRFBlockedError) return error;

  const errorMessage = error instanceof Error ? error.message : String(error);
  // request-filtering-agent errors contain "is not allowed" when blocking private/denied IPs
  const isSSRFBlock = errorMessage.includes('is not allowed');

  if (isSSRFBlock) {
    console.error('SSRF protection blocked request:', toErrorLog(error));
    return new SSRFBlockedError(`${SSRF_BLOCKED_PREFIX}: ${errorMessage}. See: ${SSRF_DOCS_URL}`, {
      cause: error,
    });
  }

  console.error('Fetch error:', toErrorLog(error));
  return new Error(`Fetch failed: ${errorMessage}`, { cause: error });
};

/**
 * Expose a node-fetch body as a Web stream that is pulled only as the consumer reads.
 * Ending at `cap` bytes, or a consumer cancel, destroys the node stream, which tears down
 * the HTTP connection.
 */
const toWebBody = (body: NodeBody, cap?: number): ReadableStream<Uint8Array> => {
  const iterator = (body as AsyncIterable<Uint8Array | string>)[Symbol.asyncIterator]();
  let received = 0;
  let released = false;

  const release = () => {
    if (released) return;
    released = true;
    // Destroy directly instead of only awaiting `iterator.return()`: that would queue
    // behind a pending `next()`, which never settles on an idle stream such as SSE.
    if (typeof body.destroy === 'function') body.destroy();
    else iterator.return?.().catch(() => {});
  };

  return new ReadableStream<Uint8Array>({
    cancel: release,
    async pull(controller) {
      let result: IteratorResult<Uint8Array | string>;
      try {
        result = await iterator.next();
      } catch (error) {
        // A rejection after release is the teardown we caused; nobody is reading anymore.
        if (!released) controller.error(toFetchError(error));
        return;
      }

      if (result.done) {
        released = true;
        controller.close();
        return;
      }

      const chunk = typeof result.value === 'string' ? Buffer.from(result.value) : result.value;
      if (cap && cap > 0 && received + chunk.byteLength >= cap) {
        controller.enqueue(chunk.subarray(0, cap - received));
        controller.close();
        release();
        return;
      }

      received += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
};

/**
 * Cancels the body of a Response that was garbage-collected before anyone read or cancelled
 * it, e.g. a caller that gave up on a non-2xx status. Otherwise a large or never-ending body
 * keeps its upstream connection open for as long as the server does. A locked body is being
 * read (such as an SSE consumer that kept only its reader), so it is left alone.
 */
const abandonedBodies = new FinalizationRegistry<ReadableStream<Uint8Array>>((body) => {
  if (!body.locked) body.cancel().catch(() => {});
});

/**
 * SSRF-safe fetch implementation for server-side use
 * Uses request-filtering-agent to prevent requests to private IP addresses
 *
 * Resolves once the response headers arrive; the body streams. Read the body or cancel it
 * when giving up on a response so its connection is released right away. A dropped
 * Response is cleaned up on garbage collection as a fallback, so keep the Response (or
 * lock its body with a reader) for as long as you intend to read.
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
    // Create agents for both protocols
    const httpAgent = new RequestFilteringHttpAgent(resolveAgentOptions(ssrfOptions));
    const httpsAgent = new RequestFilteringHttpsAgent(resolveAgentOptions(ssrfOptions));

    // Use node-fetch with SSRF protection agent
    // Pass a function to dynamically select agent based on URL protocol
    // This handles redirects from HTTP to HTTPS correctly
    const response = await fetch(url, {
      ...options,
      agent: (parsedURL: URL) => (parsedURL.protocol === 'https:' ? httpsAgent : httpAgent),
    } as any);

    const nodeBody = response.body as NodeBody | null;
    const status = response.status;
    let body: ReadableStream<Uint8Array> | null = null;

    if (nodeBody && NULL_BODY_STATUSES.has(status)) nodeBody.destroy?.();
    else if (nodeBody) body = toWebBody(nodeBody, ssrfOptions?.maxContentLength);

    // Resolve as soon as headers arrive: the SSRF checks run at connect time and on every
    // redirect hop, so the body can stream to the caller (e.g. a never-ending SSE response).
    const webResponse = new Response(body, {
      headers: response.headers as any,
      status,
      statusText: response.statusText,
    });
    if (webResponse.body) abandonedBodies.register(webResponse, webResponse.body);

    return webResponse;
  } catch (error) {
    throw toFetchError(error);
  }
};

/**
 * Assert that `url` does not point at a private, loopback, link-local or
 * otherwise reserved address: every address its hostname resolves to is checked
 * against the same policy `ssrfSafeFetch` enforces, including the
 * `SSRF_ALLOW_PRIVATE_IP_ADDRESS` / `SSRF_ALLOW_IP_ADDRESS_LIST` overrides.
 *
 * Use this for transports `ssrfSafeFetch` cannot cover — WebSocket clients or
 * third-party SDKs that manage their own connections — as a pre-flight check on
 * the base URL. Note the resolution happens once, ahead of the connection;
 * where the transport accepts a custom agent, prefer {@link ssrfSafeAgent}
 * which filters at connect time instead.
 *
 * @param url - The URL whose host is resolved and checked
 * @param ssrfOptions - Optional per-call SSRF configuration overrides
 * @throws {SSRFBlockedError} when any resolved address is refused by the policy
 */
export const assertSsrfSafeUrl = async (url: string, ssrfOptions?: SSRFOptions): Promise<void> => {
  const options = resolveAgentOptions(ssrfOptions);

  let hostname: string;
  try {
    // `new URL` keeps the brackets on IPv6 literals (`[::1]`); strip them for the
    // IP checks and the DNS lookup below.
    hostname = new URL(url).hostname.replaceAll(/^\[|\]$/g, '');
  } catch (error) {
    throw blockedError(`Invalid URL: ${url}`, error);
  }

  if (!hostname) {
    throw blockedError(`Invalid URL: ${url}`);
  }

  // Literal IP hostnames skip DNS and are checked directly.
  if (net.isIP(hostname) !== 0) {
    assertAddressAllowed(hostname, hostname, undefined, options);
    return;
  }

  const addresses = await dns.promises.lookup(hostname, { all: true });
  for (const { address, family } of addresses) {
    assertAddressAllowed(address, hostname, family, options);
  }
};

/**
 * Create a request-filtering agent for `url`, so transports that accept a
 * Node.js `http.Agent` / `https.Agent` (for example `ws`, which uses the agent
 * for its handshake connection) get the same connect-time SSRF policy as
 * `ssrfSafeFetch` — including DNS filtering on every connect, with no
 * resolution-vs-connect race.
 *
 * `https`/`wss` URLs get a TLS-capable agent; anything else gets the plain one.
 *
 * @param url - The URL the agent will connect to
 * @param ssrfOptions - Optional per-call SSRF configuration overrides
 */
export const ssrfSafeAgent = (url: string, ssrfOptions?: SSRFOptions) =>
  url.startsWith('https') || url.startsWith('wss')
    ? new RequestFilteringHttpsAgent(resolveAgentOptions(ssrfOptions))
    : new RequestFilteringHttpAgent(resolveAgentOptions(ssrfOptions));
