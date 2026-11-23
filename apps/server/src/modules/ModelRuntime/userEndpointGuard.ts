import { AsyncLocalStorage } from 'node:async_hooks';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { AgentRuntimeError } from '@lobechat/model-runtime';
import type { SSRFOptions } from '@lobechat/ssrf-safe-fetch';
import {
  createSsrfSafeFetch,
  findSSRFBlockedError,
  SSRF_BLOCKED_PREFIX,
  SSRF_DOCS_URL,
  SSRFBlockedError,
  ssrfSafeAgent,
} from '@lobechat/ssrf-safe-fetch';
import { AgentRuntimeErrorType } from '@lobechat/types';
import debug from 'debug';

const log = debug('model-runtime:user-endpoint-guard');

/**
 * SSRF guard for model requests sent to user-supplied endpoints (a provider
 * `baseURL` from keyVaults or the client payload).
 *
 * Provider SDKs and the providers' own raw `fetch` calls all go through
 * `globalThis.fetch`, so rather than threading a `fetch` option through ~90
 * provider implementations, every method call on a guarded runtime runs inside
 * an AsyncLocalStorage scope. A one-time wrapper around `globalThis.fetch`
 * routes requests whose host matches one of the user's endpoints through an
 * SSRF-safe fetch that validates the resolved address of every connection,
 * redirect hops included. Requests to any other host are untouched.
 *
 * Platform-configured endpoints (`*_PROXY_URL` env, built-in provider URLs) are
 * operator-trusted and never guarded.
 */

/**
 * Cloud is multi-tenant, so user endpoints may never reach private networks.
 * Self-hosted deployments keep reaching private endpoints by default — a
 * LobeHub container talking to `http://ollama:11434` on the same docker
 * network is a common, legitimate setup — and opt in to blocking with
 * `SSRF_ALLOW_PRIVATE_IP_ADDRESS=0`. `SSRF_ALLOW_IP_ADDRESS_LIST` allow-lists
 * specific addresses / CIDRs in both cases.
 */
export const resolveUserEndpointSsrfPolicy = (): SSRFOptions => ({
  allowIPAddressList:
    process.env.SSRF_ALLOW_IP_ADDRESS_LIST?.split(',')
      .map((item) => item.trim())
      .filter(Boolean) ?? [],
  allowPrivateIPAddress: ENABLE_BUSINESS_FEATURES
    ? false
    : process.env.SSRF_ALLOW_PRIVATE_IP_ADDRESS !== '0',
  /**
   * Link-local stays denied even when a self-hosted deployment allows private
   * endpoints: an open-registration instance must not hand every user a path
   * to the cloud metadata service (169.254.169.254). The NAT64 prefixes cover
   * the same destinations in translated form on NAT64 networks.
   * `SSRF_ALLOW_IP_ADDRESS_LIST` still wins for an operator who genuinely
   * needs such an endpoint.
   */
  denyIPAddressList: ['169.254.0.0/16', 'fe80::/10', '64:ff9b::/96', '64:ff9b:1::/48'],
});

interface GuardScope {
  agents: { http: http.Agent; https: https.Agent };
  blocked?: SSRFBlockedError;
  fetch: typeof fetch;
  hosts: ReadonlySet<string>;
  provider: string;
}

const scopeStorage = new AsyncLocalStorage<GuardScope>();

const normalizeHostname = (hostname: string) => hostname.replaceAll(/^\[|\]$/g, '').toLowerCase();

const getEndpointHostname = (endpoint: string | undefined) => {
  if (!endpoint) return;
  try {
    return normalizeHostname(new URL(endpoint).hostname);
  } catch {
    // Not a URL, e.g. a Cloudflare account id in `cloudflareBaseURLOrAccountID`
  }
};

const getRequestHostname = (input: RequestInfo | URL) => {
  try {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return normalizeHostname(new URL(url).hostname);
  } catch {
    return;
  }
};

/**
 * The hostname a `http(s).request(url[, options][, cb])` /
 * `http(s).request(options[, cb])` call targets. `options.host` may carry a
 * port, `options.hostname` never does.
 */
type NodeRequestCallback = (res: http.IncomingMessage) => void;

const getNodeRequestHostname = (args: unknown[]) => {
  const [urlOrOptions, options] = args as [
    string | URL | http.RequestOptions | undefined,
    (http.RequestOptions | NodeRequestCallback) | undefined,
  ];
  if (typeof urlOrOptions === 'string' || urlOrOptions instanceof URL) {
    try {
      return normalizeHostname(new URL(urlOrOptions).hostname);
    } catch {
      return;
    }
  }
  const host =
    (urlOrOptions as http.RequestOptions | undefined)?.hostname ??
    (urlOrOptions as http.RequestOptions | undefined)?.host ??
    (options as http.RequestOptions | undefined)?.hostname ??
    (options as http.RequestOptions | undefined)?.host;
  if (typeof host !== 'string') return;
  // A bare IP never carries a port; only strip `:port` from names and
  // bracketed IPv6 so `::1` is not mangled into a bypass.
  if (net.isIP(host) !== 0) return normalizeHostname(host);
  return normalizeHostname(host.replace(/:\d+$/, ''));
};

/** request-filtering-agent refuses with an "… is not allowed" message. */
const toBlockedFromAgentError = (error: Error) =>
  error.message.includes('is not allowed') || error instanceof SSRFBlockedError
    ? new SSRFBlockedError(`${SSRF_BLOCKED_PREFIX}: ${error.message}. See: ${SSRF_DOCS_URL}`, {
        cause: error,
      })
    : undefined;

/**
 * SDKs retry a rejected fetch as a connection error (the OpenAI SDK twice, with
 * backoff), which would re-send the request to an allowed first hop on every
 * attempt. A non-retryable 403 ends the attempt immediately; the guarded call
 * then reports `ProviderBaseURLBlocked` from `scope.blocked`, whatever error
 * the provider derived from this response.
 */
const createBlockedResponse = (blocked: SSRFBlockedError) =>
  Response.json(
    { error: { code: 'provider_base_url_blocked', message: blocked.message } },
    { status: 403, statusText: 'Forbidden' },
  );

let originalFetch: typeof fetch | undefined;
let nodeRequestsWrapped = false;

/**
 * Wrap `http.request` / `https.request` once. Some SDK transports bypass
 * `fetch` entirely (e.g. `@typespec/ts-http-runtime` used by
 * `@azure-rest/ai-inference` calls `node:https` directly), so endpoint-host
 * requests made inside a guard scope get a request-filtering agent injected
 * that applies the same connect-time policy — redirects included.
 */
const wrapNodeRequest = (
  module: typeof http | typeof https,
  agent: 'http' | 'https',
  method: 'request' | 'get',
) => {
  const original = module[method] as (...args: unknown[]) => http.ClientRequest;

  module[method] = function (this: unknown, ...args: unknown[]) {
    const scope = scopeStorage.getStore();
    const hostname = scope && getNodeRequestHostname(args);

    if (!scope || !hostname || !scope.hosts.has(hostname)) {
      return original.apply(this, args as []);
    }

    if (scope.blocked) {
      // Return a pre-failed request — a bare `new ClientRequest({})` would
      // still open a socket to localhost:80.
      const request = new http.ClientRequest({ createConnection: () => new net.Socket() });
      queueMicrotask(() => request.destroy(scope.blocked));
      return request;
    }

    const [urlOrOptions, options, callback] = args as [
      string | URL | http.RequestOptions | undefined,
      (http.RequestOptions | NodeRequestCallback) | undefined,
      NodeRequestCallback | undefined,
    ];
    const filteringAgent = scope.agents[agent];

    const wrappedArgs =
      typeof urlOrOptions === 'string' || urlOrOptions instanceof URL
        ? typeof options === 'function'
          ? [urlOrOptions, { agent: filteringAgent }, options]
          : [urlOrOptions, { ...(options as http.RequestOptions), agent: filteringAgent }, callback]
        : typeof options === 'function'
          ? [{ ...(urlOrOptions as http.RequestOptions), agent: filteringAgent }, options]
          : [
              { ...(urlOrOptions as http.RequestOptions), agent: filteringAgent },
              options === undefined ? undefined : (options as NodeRequestCallback),
            ];

    const request = original.apply(this, wrappedArgs as []);
    request.on('error', (error) => {
      if (scope.blocked) return;
      const blocked = toBlockedFromAgentError(error);
      if (blocked) {
        log(
          'blocked %s request to %s for provider %s: %s',
          agent,
          hostname,
          scope.provider,
          blocked.message,
        );
        scope.blocked = blocked;
      }
    });
    return request;
  } as typeof module.request;
};

const wrapNodeRequests = () => {
  if (nodeRequestsWrapped) return;
  nodeRequestsWrapped = true;
  // `get` calls an internal `request`, not `module.request`, so both are wrapped.
  wrapNodeRequest(http, 'http', 'request');
  wrapNodeRequest(http, 'http', 'get');
  wrapNodeRequest(https, 'https', 'request');
  wrapNodeRequest(https, 'https', 'get');
};

/**
 * Wrap `globalThis.fetch` once. SDKs capture the global fetch when a client is
 * constructed, so this must run before the guarded runtime is created.
 */
const installScopedFetch = () => {
  if (originalFetch) return originalFetch;

  const baseFetch = globalThis.fetch;
  originalFetch = baseFetch;

  const scopedFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const scope = scopeStorage.getStore();
    const hostname = scope && getRequestHostname(input);

    if (!scope || !hostname || !scope.hosts.has(hostname)) return baseFetch(input, init);

    if (scope.blocked) return Promise.resolve(createBlockedResponse(scope.blocked));

    return scope.fetch(input, init).catch((error: unknown) => {
      const blocked = findSSRFBlockedError(error);
      if (!blocked) throw error;

      log('blocked fetch to %s for provider %s: %s', hostname, scope.provider, blocked.message);
      scope.blocked = blocked;
      return createBlockedResponse(blocked);
    });
  }) as typeof fetch;

  // Keep markers that frameworks put on fetch (e.g. Next.js `__nextPatched`) so
  // they do not wrap it a second time.
  Object.assign(scopedFetch, baseFetch);
  globalThis.fetch = scopedFetch;
  wrapNodeRequests();

  return baseFetch;
};

const guardedFetchCache = new Map<string, typeof fetch>();

const getGuardedFetch = (policy: SSRFOptions, baseFetch: typeof fetch) => {
  const key = JSON.stringify(policy);
  let guardedFetch = guardedFetchCache.get(key);
  if (!guardedFetch) {
    guardedFetch = createSsrfSafeFetch(policy, { fetch: baseFetch });
    guardedFetchCache.set(key, guardedFetch);
  }
  return guardedFetch;
};

const guardedAgentCache = new Map<string, GuardScope['agents']>();

const getGuardedAgents = (policy: SSRFOptions): GuardScope['agents'] => {
  const key = JSON.stringify(policy);
  let agents = guardedAgentCache.get(key);
  if (!agents) {
    agents = {
      http: ssrfSafeAgent('http://endpoint.invalid', policy) as http.Agent,
      https: ssrfSafeAgent('https://endpoint.invalid', policy) as https.Agent,
    };
    guardedAgentCache.set(key, agents);
  }
  return agents;
};

export const createProviderBaseURLBlockedError = (provider: string, blocked: SSRFBlockedError) =>
  AgentRuntimeError.chat({
    error: {
      hostname: blocked.hostname,
      // Never return the resolved address — that would leak internal DNS
      // results to whoever configured the endpoint.
      message:
        'The provider endpoint resolves to a private or reserved network address that the server is not allowed to reach.',
    },
    errorType: AgentRuntimeErrorType.ProviderBaseURLBlocked,
    provider,
  });

const toBlockedError = (provider: string, scope: GuardScope, error: unknown) => {
  const blocked = scope.blocked ?? findSSRFBlockedError(error);
  return blocked ? createProviderBaseURLBlockedError(provider, blocked) : error;
};

const isPromise = (value: unknown): value is Promise<unknown> =>
  !!value && typeof (value as PromiseLike<unknown>).then === 'function';

const runInScope = <T>(provider: string, scope: GuardScope, fn: () => T): T =>
  scopeStorage.run(scope, () => {
    try {
      const result = fn();

      if (isPromise(result)) {
        return result.then(
          (value) => {
            // Some providers swallow a non-OK response (e.g. `models()` falling
            // back to an empty list); a blocked request must still fail loudly
            if (scope.blocked) throw createProviderBaseURLBlockedError(provider, scope.blocked);
            return value;
          },
          (error: unknown) => {
            throw toBlockedError(provider, scope, error);
          },
        ) as T;
      }

      return result;
    } catch (error) {
      throw toBlockedError(provider, scope, error);
    }
  });

/**
 * Build a provider runtime whose requests to the given user endpoints are
 * SSRF-guarded. Returns the plain runtime when no endpoint is user-supplied.
 * Self-hosted deployments still go through the guard: the policy allows
 * private addresses there but keeps link-local (metadata) denied.
 *
 * A blocked connection surfaces as `ProviderBaseURLBlocked` instead of the
 * SDK's generic `Connection error.`.
 */
export const createUserEndpointGuardedRuntime = <T extends object>(params: {
  create: () => T;
  endpoints: (string | undefined)[];
  provider: string;
}): T => {
  const { create, endpoints, provider } = params;
  const policy = resolveUserEndpointSsrfPolicy();
  const hosts = new Set(endpoints.map(getEndpointHostname).filter((host) => !!host) as string[]);

  if (hosts.size === 0) return create();

  const baseFetch = installScopedFetch();
  const guardedFetch = getGuardedFetch(policy, baseFetch);
  const agents = getGuardedAgents(policy);
  const runtime = create();

  return new Proxy(runtime, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function' || property === 'constructor') return value;

      return (...args: unknown[]) =>
        runInScope(provider, { agents, fetch: guardedFetch, hosts, provider }, () =>
          value.apply(target, args),
        );
    },
  });
};
