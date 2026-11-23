import dns from 'node:dns';
import net from 'node:net';

import { Agent, buildConnector, EnvHttpProxyAgent, getGlobalDispatcher, ProxyAgent } from 'undici';

import type { SSRFOptions } from './policy';
import { assertAddressAllowed, SSRFBlockedError } from './policy';

/**
 * A WHATWG-compatible `fetch` that refuses connections to private or reserved
 * addresses, built on Node's undici stack instead of node-fetch.
 *
 * Unlike `ssrfSafeFetch` (which swaps in a node-fetch response), the response
 * here is the undici `Response` streaming untouched, so the returned function
 * can be handed to SDK clients (`new OpenAI({ fetch })`, `new Anthropic({ fetch
 * })`) for streaming chat completions without changing body semantics.
 */

/** Check one resolved address against the policy. Returns the block, if any. */
export const validateSsrfAddress = (
  address: string,
  policy: SSRFOptions,
  hostname?: string,
): SSRFBlockedError | undefined => {
  try {
    assertAddressAllowed(address, hostname ?? address, undefined, {
      allowIPAddressList: policy.allowIPAddressList ?? [],
      allowMetaIPAddress: policy.allowPrivateIPAddress ?? false,
      allowPrivateIPAddress: policy.allowPrivateIPAddress ?? false,
      denyIPAddressList: policy.denyIPAddressList ?? [],
    });
    return undefined;
  } catch (error) {
    return error instanceof SSRFBlockedError ? error : new SSRFBlockedError(String(error));
  }
};

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

/**
 * A `dns.lookup` replacement that rejects the connection when any resolved
 * address is blocked. Because the socket connects to exactly what this
 * returned, there is no window for DNS rebinding between check and use.
 */
const createGuardedLookup =
  (policy: SSRFOptions) =>
  (hostname: string, options: dns.LookupOptions, callback: LookupCallback) => {
    dns.lookup(hostname, options, (error, address, family) => {
      if (error) return callback(error, address, family);

      const resolved = Array.isArray(address) ? address : [{ address, family }];
      for (const entry of resolved) {
        const blocked = validateSsrfAddress(entry.address, policy, hostname);
        if (blocked) return callback(blocked, address, family);
      }

      callback(null, address, family);
    });
  };

const stripBrackets = (hostname: string) => hostname.replaceAll(/^\[|\]$/g, '');

/**
 * An undici dispatcher whose every connection — including each redirect hop —
 * is validated against the policy after DNS resolution and before connecting.
 */
export const createSsrfSafeDispatcher = (policy: SSRFOptions) => {
  const connector = buildConnector({ lookup: createGuardedLookup(policy) } as any);

  return new Agent({
    connect: (options, callback) => {
      // IP literals never reach `lookup`, so validate them here
      const host = stripBrackets(options.hostname);
      if (net.isIP(host)) {
        const blocked = validateSsrfAddress(host, policy);
        if (blocked) return callback(blocked, null);
      }

      connector(options, callback);
    },
  });
};

const PROXY_ENV_KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'];

/** Node only routes fetch through `HTTP(S)_PROXY` when `NODE_USE_ENV_PROXY=1` */
const isEnvProxyActive = () =>
  process.env.NODE_USE_ENV_PROXY === '1' && PROXY_ENV_KEYS.some((key) => !!process.env[key]);

/**
 * Whether the process proxies requests through a global dispatcher installed
 * with `setGlobalDispatcher` (the dev server installs an `EnvHttpProxyAgent`
 * when `HTTP(S)_PROXY` is set — see `libs/better-auth/define-config.ts`). A
 * per-request `dispatcher` would silently bypass that proxy and break
 * connectivity for deployments that need it to reach the outside, so those
 * requests take the application-layer path instead — same as env-proxy mode.
 */
const globalDispatcherIsProxy = () => {
  const dispatcher = getGlobalDispatcher();
  return dispatcher instanceof ProxyAgent || dispatcher instanceof EnvHttpProxyAgent;
};

/**
 * Bun's fetch — and the `undici` shim it maps the package specifier to —
 * ignores `init.dispatcher`, so connect-time filtering is impossible there.
 * `dev:bun` is a supported server runtime, so fall back to resolving and
 * vetting every target at the application layer, as with proxy transports.
 */
const isBunRuntime = () => !!process.versions.bun;

const resolveRequestUrl = (input: RequestInfo | URL) =>
  new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

/**
 * With an egress proxy the socket goes to the proxy, so connection-time checks
 * would validate the proxy's address instead of the target. Fall back to an
 * application-layer resolution check. This leaves a DNS-rebinding window;
 * deployments with a proxy should enforce a private-network ACL on the proxy
 * itself.
 */
const assertResolvedTargetAllowed = async (url: URL, policy: SSRFOptions) => {
  const hostname = stripBrackets(url.hostname);
  const addresses = net.isIP(hostname)
    ? [{ address: hostname, family: undefined }]
    : await dns.promises.lookup(hostname, { all: true });

  for (const { address } of addresses) {
    const blocked = validateSsrfAddress(address, policy, hostname);
    if (blocked) throw new TypeError('fetch failed', { cause: blocked });
  }
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SENSITIVE_HEADERS = ['authorization', 'proxy-authorization', 'cookie', 'cookie2'];
const MAX_REDIRECTS = 5;

/**
 * Proxy mode cannot rely on the dispatcher to vet redirect hops, so follow
 * redirects manually and re-check every target before requesting it.
 */
const fetchThroughEnvProxy = async (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  policy: SSRFOptions,
  baseFetch: typeof fetch,
) => {
  /**
   * Flatten a `Request` input into `init`: the loop below re-issues every hop
   * from a string URL, which would otherwise drop the request's method,
   * headers and body after the first redirect. Explicit `init` fields win.
   */
  let requestInit: RequestInit;
  if (input instanceof Request) {
    const headers = new Headers(input.headers);
    if (init?.headers) new Headers(init.headers).forEach((v, k) => headers.set(k, v));
    requestInit = {
      ...init,
      // `input.body` is locked to the Request; read it once so every hop can resend it
      body: init?.body ?? (input.body ? await input.arrayBuffer() : undefined),
      headers,
      method: init?.method ?? input.method,
      redirect: init?.redirect ?? input.redirect,
      signal: init?.signal ?? input.signal,
    };
  } else {
    requestInit = { ...init };
  }

  const followRedirects = (requestInit.redirect ?? 'follow') === 'follow';
  if (followRedirects) requestInit.redirect = 'manual';

  let url = resolveRequestUrl(input);
  let method = (requestInit.method ?? 'GET').toUpperCase();

  for (let hop = 0; ; hop++) {
    await assertResolvedTargetAllowed(url, policy);

    const response = await baseFetch(url.href, requestInit);
    const location = response.headers.get('location');
    if (!followRedirects || !REDIRECT_STATUSES.has(response.status) || !location) return response;

    await response.body?.cancel();
    if (hop >= MAX_REDIRECTS) {
      throw new TypeError('fetch failed', { cause: new Error('Too many redirects') });
    }

    const next = new URL(location, url);
    if (next.origin !== url.origin && requestInit.headers) {
      // Native fetch strips credentials when a redirect crosses origins
      const headers = new Headers(requestInit.headers);
      for (const name of SENSITIVE_HEADERS) headers.delete(name);
      requestInit = { ...requestInit, headers };
    }

    // Mirror fetch's redirect semantics: 303, and 301/302 after a POST, become a body-less GET
    const switchToGet =
      (response.status === 303 && method !== 'HEAD') ||
      ((response.status === 301 || response.status === 302) && method === 'POST');
    if (switchToGet) {
      method = 'GET';
      requestInit = { ...requestInit, body: undefined, method };
    }

    url = next;
  }
};

export interface CreateSsrfSafeFetchOptions {
  /** The fetch to wrap; defaults to the global fetch at call time */
  fetch?: typeof fetch;
}

/**
 * Build a WHATWG-compatible `fetch` that refuses to connect to private or
 * reserved addresses. Unlike `ssrfSafeFetch`, the response body is streamed
 * untouched, so it can be handed to SDKs (`new OpenAI({ fetch })`) for
 * streaming chat completions.
 *
 * `maxContentLength` in {@link SSRFOptions} does not apply here: the undici
 * response streams straight through.
 */
export const createSsrfSafeFetch = (
  policy: SSRFOptions = {},
  options: CreateSsrfSafeFetchOptions = {},
): typeof fetch => {
  const getBaseFetch = () => options.fetch ?? globalThis.fetch;

  // Passthrough only when nothing can still be denied; a deny list applies
  // even when private addresses are allowed.
  if (policy.allowPrivateIPAddress && !policy.denyIPAddressList?.length)
    return ((input, init) => getBaseFetch()(input, init)) as typeof fetch;

  const dispatcher = createSsrfSafeDispatcher(policy);

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (isEnvProxyActive() || globalDispatcherIsProxy() || isBunRuntime()) {
      return fetchThroughEnvProxy(input, init, policy, getBaseFetch());
    }

    return getBaseFetch()(input, { ...init, dispatcher } as RequestInit);
  }) as typeof fetch;
};
