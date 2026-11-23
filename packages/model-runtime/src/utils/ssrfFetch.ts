import type { SSRFOptions } from '@lobechat/ssrf-safe-fetch';

/**
 * Fetch that applies the server-side SSRF policy to caller-supplied URLs.
 * Every outbound download of a user- or provider-controlled URL must go
 * through this instead of bare `fetch`, so intranet and instance-metadata
 * endpoints stay unreachable (see `SSRF_ALLOW_PRIVATE_IP_ADDRESS` /
 * `SSRF_ALLOW_IP_ADDRESS_LIST` for self-host overrides).
 *
 * Browser builds fall back to native `fetch`: SSRF does not apply
 * client-side, and `@lobechat/ssrf-safe-fetch` degrades to native fetch there.
 */
export const ssrfFetch = (url: string, init?: RequestInit, ssrfOptions?: SSRFOptions) =>
  typeof window === 'undefined'
    ? import('@lobechat/ssrf-safe-fetch').then((m) => m.ssrfSafeFetch(url, init, ssrfOptions))
    : fetch(url, init);
