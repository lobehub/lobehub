import net from 'node:net';

import ipaddr from 'ipaddr.js';
import type { RequestFilteringAgentOptions } from 'request-filtering-agent';

/**
 * Options for per-call SSRF configuration overrides
 */
export interface SSRFOptions {
  /** List of IP addresses to allow */
  allowIPAddressList?: string[];
  /** Whether to allow private/local IP addresses */
  allowPrivateIPAddress?: boolean;
  /** List of IP addresses to deny, checked even when private addresses are allowed */
  denyIPAddressList?: string[];
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

export const SSRF_BLOCKED_PREFIX = 'SSRF blocked';

export const SSRF_DOCS_URL =
  'https://lobehub.com/docs/self-hosting/environment-variables/basic#ssrf-allow-private-ip-address';

/**
 * Thrown when the request (or one of its redirect hops) resolves to a private, loopback,
 * link-local or otherwise reserved address that the SSRF policy does not allow. The message
 * keeps its `SSRF blocked:` prefix so callers matching on it keep working.
 */
export class SSRFBlockedError extends Error {
  /** The resolved address that tripped the policy, when known. */
  address?: string;
  /** The hostname that resolved to `address`, when known. */
  hostname?: string;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SSRFBlockedError';
  }
}

/**
 * Return the first `SSRFBlockedError` in `error`'s `cause` chain, if any. SDKs and
 * transports wrap fetch errors (undici raises `TypeError: fetch failed` with the
 * connect error as `cause`), so the chain is walked instead of checking only the
 * outermost error.
 */
export const findSSRFBlockedError = (error: unknown): SSRFBlockedError | undefined => {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) {
    if (current instanceof SSRFBlockedError || current.message.startsWith(SSRF_BLOCKED_PREFIX))
      return current as SSRFBlockedError;
    seen.add(current);
    current = current.cause;
  }
  return undefined;
};

/**
 * Whether `error`, or any error in its `cause` chain, is an SSRF block. Callers that wrap
 * fetch errors (an SDK transport, a retry helper) keep the original as `cause`, so the
 * chain is walked instead of checking only the outermost error.
 */
export const isSSRFBlockedError = (error: unknown): boolean => !!findSSRFBlockedError(error);

/**
 * Resolve the effective request-filtering policy for a call: explicit
 * `ssrfOptions` win over the `SSRF_ALLOW_PRIVATE_IP_ADDRESS` /
 * `SSRF_ALLOW_IP_ADDRESS_LIST` environment variables.
 */
export const resolveAgentOptions = (ssrfOptions?: SSRFOptions): RequestFilteringAgentOptions => {
  const allowPrivate = ssrfOptions?.allowPrivateIPAddress ?? envAllowPrivate();
  const options: RequestFilteringAgentOptions = {
    allowIPAddressList: ssrfOptions?.allowIPAddressList ?? envAllowIPAddressList(),
    allowMetaIPAddress: allowPrivate,
    allowPrivateIPAddress: allowPrivate,
    denyIPAddressList: ssrfOptions?.denyIPAddressList ?? [],
    // The agent's built-in list matching never unwraps an IPv4-mapped IPv6
    // target, so `::ffff:169.254.169.254` would sidestep the deny list. The
    // filter receives the normalized (unwrapped) address and re-runs the same
    // policy on it.
    filter: (address, { host, family }) => {
      try {
        assertAddressAllowed(address, host ?? address, family, options);
        return true;
      } catch {
        return false;
      }
    },
  };
  return options;
};

export const envAllowPrivate = () => process.env.SSRF_ALLOW_PRIVATE_IP_ADDRESS === '1';

export const envAllowIPAddressList = () =>
  process.env.SSRF_ALLOW_IP_ADDRESS_LIST?.split(',').filter(Boolean) ?? [];

// Mirrors request-filtering-agent's toParsableAddress: the OS reads "::8.8.8.8"
// as the IPv4-compatible address ::808:808 while ipaddr.js reads it as the
// IPv4-mapped ::ffff:808:808 — rewrite the notation so the checked address is
// the address actually connected to.
const IPV4_COMPATIBLE_DOTTED_NOTATION = /^::(?=\d+\.\d+\.\d+\.\d+(?:%.*)?$)/;
const toParsableAddress = (address: string) =>
  address.replace(IPV4_COMPATIBLE_DOTTED_NOTATION, '0:0:0:0:0:0:');

// Mirrors request-filtering-agent's getRange: IANA allocates only 2000::/3 as
// IPv6 global unicast, so an IPv6 address ipaddr.js reports as "unicast"
// outside it (e.g. deprecated ranges, NAT64 64:ff9b::/96) is not public.
const IPV6_GLOBAL_UNICAST_RANGE = ipaddr.parseCIDR('2000::/3');
const getRange = (parsed: ipaddr.IPv4 | ipaddr.IPv6) => {
  const range = parsed.range();
  if (
    range === 'unicast' &&
    parsed.kind() === 'ipv6' &&
    // eslint-disable-next-line unicorn/prefer-regexp-test -- ipaddr.js API, not String.prototype.match
    !parsed.match(IPV6_GLOBAL_UNICAST_RANGE)
  ) {
    return 'reserved';
  }
  return range;
};

/** `parsed` when it is an IPv4-mapped IPv6 address, unwrapped to its IPv4 form. */
const unwrappedIPv4 = (parsed: ipaddr.IPv4 | ipaddr.IPv6) =>
  parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()
    ? parsed.toIPv4Address()
    : undefined;

/** Whether `address` (raw or parsed) matches an IP or CIDR entry of `ipAddressList`. */
export const matchIPAddressList = (
  address: string,
  parsed: ipaddr.IPv4 | ipaddr.IPv6,
  ipAddressList: string[],
) => {
  for (const ipOrCIDR of ipAddressList) {
    if (net.isIP(ipOrCIDR) !== 0) {
      // An IPv4-mapped IPv6 literal is the same destination as its IPv4 form;
      // match both so `::ffff:169.254.169.254` cannot sidestep the list.
      if (ipOrCIDR === address || unwrappedIPv4(parsed)?.toString() === ipOrCIDR) return true;
      continue;
    }
    try {
      const cidr = ipaddr.parseCIDR(ipOrCIDR);
      // `parsed.match` throws on a family mismatch, so pick the comparison
      // target first: an IPv4-mapped IPv6 target matches IPv4 entries in its
      // unwrapped form.
      const target = cidr[0].kind() === parsed.kind() ? parsed : unwrappedIPv4(parsed);
      if (target?.match(cidr)) return true;
    } catch {
      // Invalid CIDR entries are ignored, matching request-filtering-agent behavior.
    }
  }
  return false;
};

export const blockedError = (
  detail: string,
  cause?: unknown,
  fields?: Pick<SSRFBlockedError, 'address' | 'hostname'>,
) => {
  const error = new SSRFBlockedError(`${SSRF_BLOCKED_PREFIX}: ${detail}. See: ${SSRF_DOCS_URL}`, {
    cause,
  });
  if (fields?.address) error.address = fields.address;
  if (fields?.hostname) error.hostname = fields.hostname;
  return error;
};

/**
 * Apply the same address policy `request-filtering-agent` enforces at connect
 * time to a resolved `address`. The messages keep the agent's wording so the
 * `SSRF blocked:` contract is identical whichever check trips.
 */
export const assertAddressAllowed = (
  address: string,
  host: string,
  family: number | undefined,
  options: RequestFilteringAgentOptions,
): void => {
  if (net.isIP(address) === 0) return;

  const parsed = ipaddr.parse(toParsableAddress(address));

  if (
    options.allowIPAddressList?.length &&
    matchIPAddressList(address, parsed, options.allowIPAddressList)
  ) {
    return;
  }

  const range = getRange(parsed);
  const where = `DNS lookup ${address}(family:${family}, host:${host}) is not allowed`;
  const fields = { address, hostname: host };

  if (!options.allowMetaIPAddress && range === 'unspecified') {
    throw blockedError(`${where}. Because, It is meta IP address.`, undefined, fields);
  }

  if (!options.allowPrivateIPAddress && range !== 'unicast') {
    throw blockedError(`${where}. Because, It is private IP address.`, undefined, fields);
  }

  if (
    options.denyIPAddressList?.length &&
    matchIPAddressList(address, parsed, options.denyIPAddressList)
  ) {
    throw blockedError(`${where}. Because It is defined in denyIPAddressList.`, undefined, fields);
  }
};
