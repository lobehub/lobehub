import { AsyncLocalStorage } from 'node:async_hooks';

import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { AgentRuntimeError } from '@lobechat/model-runtime';
import type { SSRFBlockedError, SSRFOptions } from '@lobechat/ssrf-safe-fetch';
import { createSsrfSafeFetch, findSSRFBlockedError } from '@lobechat/ssrf-safe-fetch';
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
});

interface GuardScope {
  blocked?: SSRFBlockedError;
  fetch: typeof fetch;
  hosts: ReadonlySet<string>;
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

      log('blocked request to %s: %s', hostname, blocked.message);
      scope.blocked = blocked;
      return createBlockedResponse(blocked);
    });
  }) as typeof fetch;

  // Keep markers that frameworks put on fetch (e.g. Next.js `__nextPatched`) so
  // they do not wrap it a second time.
  Object.assign(scopedFetch, baseFetch);
  globalThis.fetch = scopedFetch;

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

export const createProviderBaseURLBlockedError = (provider: string, blocked: SSRFBlockedError) =>
  AgentRuntimeError.chat({
    error: {
      address: blocked.address,
      hostname: blocked.hostname,
      message: blocked.message,
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
 * SSRF-guarded. Returns the plain runtime when the policy allows private
 * addresses or no endpoint is user-supplied.
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

  if (policy.allowPrivateIPAddress || hosts.size === 0) return create();

  const baseFetch = installScopedFetch();
  const guardedFetch = getGuardedFetch(policy, baseFetch);
  const runtime = create();

  return new Proxy(runtime, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function' || property === 'constructor') return value;

      return (...args: unknown[]) =>
        runInScope(provider, { fetch: guardedFetch, hosts }, () => value.apply(target, args));
    },
  });
};
