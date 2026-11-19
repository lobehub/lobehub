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
   * Maximum response body size in bytes. When set, the body stream ends as soon as
   * the cap is reached and the upstream connection is closed. Readers get only the
   * bytes received up to that point (soft truncation — still considered a
   * successful response).
   *
   * Use this for any fetch that downloads untrusted content (e.g. web crawlers)
   * so a large or malicious response cannot be buffered without bound by
   * callers that read the whole body.
   */
  maxContentLength?: number;
}

/** Statuses whose Response must have a null body (Fetch standard "null body status"). */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

type NodeBody = NodeJS.ReadableStream & { destroy?: (error?: Error) => void };

const SSRF_BLOCKED_PREFIX = 'SSRF blocked';

/**
 * Thrown when the request (or one of its redirect hops) resolves to a private, loopback,
 * link-local or otherwise reserved address that the SSRF policy does not allow. The message
 * keeps its `SSRF blocked:` prefix so callers matching on it keep working.
 */
export class SSRFBlockedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SSRFBlockedError';
  }
}

/**
 * Whether `error`, or any error in its `cause` chain, is an SSRF block. Callers that wrap
 * fetch errors (an SDK transport, a retry helper) keep the original as `cause`, so the
 * chain is walked instead of checking only the outermost error.
 */
export const isSSRFBlockedError = (error: unknown): boolean => {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) {
    if (current instanceof SSRFBlockedError || current.message.startsWith(SSRF_BLOCKED_PREFIX))
      return true;
    seen.add(current);
    current = current.cause;
  }
  return false;
};

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
    return new SSRFBlockedError(
      `${SSRF_BLOCKED_PREFIX}: ${errorMessage}. ` +
        'See: https://lobehub.com/docs/self-hosting/environment-variables/basic#ssrf-allow-private-ip-address',
      { cause: error },
    );
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
