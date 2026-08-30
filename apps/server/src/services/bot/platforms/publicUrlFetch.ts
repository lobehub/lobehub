import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

import debug from 'debug';
import { Agent, EnvHttpProxyAgent, getGlobalDispatcher, ProxyAgent } from 'undici';

import { appEnv } from '@/envs/app';
import { fileEnv } from '@/envs/file';

const log = debug('bot-platform:public-url-fetch');

/**
 * Origins we serve ourselves. They are trusted even when they resolve to a
 * private address, because a self-hosted deployment legitimately runs its app
 * and its object storage on an internal network — and in dev `getFileAccessUrl`
 * hands back a `localhost` storage URL. These are OUR origins, not
 * caller-supplied ones, so trusting them adds no attacker-reachable surface.
 */
interface TrustedOrigin {
  hostname: string;
  port: string;
  protocol: string;
}

const trustedOrigins = (): TrustedOrigin[] => {
  const origins: TrustedOrigin[] = [];
  for (const candidate of [appEnv.APP_URL, fileEnv.S3_PUBLIC_DOMAIN, fileEnv.S3_ENDPOINT]) {
    if (!candidate) continue;
    try {
      const { hostname, port, protocol } = new URL(candidate);
      origins.push({ hostname, port, protocol });
    } catch {
      // A misconfigured env value simply contributes no trusted origin.
    }
  }
  return origins;
};

/**
 * Whether a URL points at storage/app infrastructure we configured ourselves.
 *
 * The bucket subdomain is why this is not a plain origin comparison: S3 and
 * every S3-compatible service default to VIRTUAL-HOSTED-style addressing, so
 * the presigned URL our own file service hands out lives on
 * `<bucket>.<S3_ENDPOINT host>` and never equals the configured endpoint
 * origin. Without this, our own storage falls through to the private-address
 * check — which is exactly the case the trusted list exists to cover, and it
 * bit us for real: every WeChat/Telegram attachment silently degraded to a
 * download link because its bytes could not be fetched.
 *
 * Matching is anchored on a `.` boundary and still requires the same scheme and
 * port, so this trusts strictly more of OUR endpoint and nothing else — a
 * caller cannot reach `evil-<endpoint>` or a different port with it.
 */
const isTrustedOrigin = (url: URL, trusted: TrustedOrigin[]): boolean =>
  trusted.some(
    (origin) =>
      origin.protocol === url.protocol &&
      origin.port === url.port &&
      (origin.hostname === url.hostname || url.hostname.endsWith(`.${origin.hostname}`)),
  );

/**
 * A URL reduced to what is safe to write into a log line: origin + path.
 *
 * The query string is where the secrets are. A presigned storage URL carries
 * `X-Amz-Credential` and `X-Amz-Signature` there, and this chain logs URLs that
 * can come from a caller — `botMessage` accepts a `fetchUrl`. Logs outlive the
 * signature they would leak, so the whole search component is dropped rather
 * than filtered key by key, and a value that will not even parse is never
 * echoed back.
 */
export const redactUrlForLog = (raw: string | URL): string => {
  try {
    const url = raw instanceof URL ? raw : new URL(raw);
    // `origin` already excludes any `user:pass@` credentials.
    return `${url.origin}${url.pathname}`;
  } catch {
    return '(unparseable url)';
  }
};

const inV4Range = (ip: string, prefix: string, bits: number): boolean => {
  const toInt = (value: string) =>
    value.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
  const mask = bits === 0 ? 0 : (0xff_ff_ff_ff << (32 - bits)) >>> 0;
  return (toInt(ip) & mask) === (toInt(prefix) & mask);
};

/**
 * Address ranges that must never be reachable through a caller-supplied URL:
 * loopback, the link-local metadata endpoint (169.254.169.254 on every major
 * cloud), RFC1918 networks, CGNAT, benchmarking, multicast and reserved space.
 */
const isPrivateV4 = (ip: string): boolean =>
  [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ].some(([prefix, bits]) => inV4Range(ip, prefix as string, bits as number));

/**
 * Expand an IPv6 address into its 8 hextets.
 *
 * Parsing rather than pattern-matching is the point: `new URL()` canonicalizes
 * `[::ffff:10.0.0.1]` to `::ffff:a00:1`, so a regex looking for a dotted quad
 * silently misses the mapped form the browser/Node actually hands us — and the
 * embedded address is what decides whether it is private.
 */
const toHextets = (raw: string): number[] | undefined => {
  let address = raw.toLowerCase().split('%')[0];

  // A trailing dotted quad (::ffff:10.0.0.1) is two hextets.
  const dotted = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(address);
  if (dotted) {
    const octets = dotted[1].split('.').map(Number);
    if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255))
      return undefined;
    address =
      address.slice(0, dotted.index) +
      [
        ((octets[0] << 8) | octets[1]).toString(16),
        ((octets[2] << 8) | octets[3]).toString(16),
      ].join(':');
  }

  const halves = address.split('::');
  if (halves.length > 2) return undefined;

  const parse = (part: string) =>
    part ? part.split(':').map((hextet) => Number.parseInt(hextet, 16)) : [];
  const left = parse(halves[0]);
  const right = halves.length === 2 ? parse(halves[1]) : [];
  if ([...left, ...right].some((value) => !Number.isInteger(value) || value < 0 || value > 0xff_ff))
    return undefined;

  if (halves.length === 1) return left.length === 8 ? left : undefined;

  const gap = 8 - left.length - right.length;
  if (gap < 1) return undefined;
  return [...left, ...Array.from({ length: gap }, () => 0), ...right];
};

const isPrivateV6 = (ip: string): boolean => {
  const hextets = toHextets(ip);
  // Anything we cannot parse is refused rather than assumed public.
  if (!hextets) return true;

  // `::` (unspecified) and `::1` (loopback).
  if (hextets.slice(0, 7).every((hextet) => hextet === 0) && hextets[7] <= 1) return true;

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) are decided by
  // the embedded v4 address, in whichever textual form they arrived.
  if (
    hextets.slice(0, 5).every((hextet) => hextet === 0) &&
    (hextets[5] === 0xff_ff || hextets[5] === 0)
  ) {
    const embedded = [hextets[6] >> 8, hextets[6] & 0xff, hextets[7] >> 8, hextets[7] & 0xff].join(
      '.',
    );
    return isPrivateV4(embedded);
  }

  // fc00::/7 unique-local, fe80::/10 link-local.
  if ((hextets[0] & 0xfe_00) === 0xfc_00) return true;
  return (hextets[0] & 0xff_c0) === 0xfe_80;
};

const isPrivateAddress = (ip: string): boolean =>
  isIP(ip) === 6 ? isPrivateV6(ip) : isPrivateV4(ip);

/**
 * Resolve a caller-supplied URL and refuse anything that points inside the
 * network. Returns the parsed URL when it is safe to fetch.
 *
 * Hostnames are resolved and EVERY answer is checked: a name that resolves to
 * `169.254.169.254` is just as dangerous as the literal address, and cloud
 * metadata is the classic target.
 */
interface SafeTarget {
  /** The vetted address, so the request can be pinned to the answer we checked. */
  pinned?: { address: string; family: number };
  url: URL;
}

const resolveSafeUrl = async (
  raw: string,
  trusted: TrustedOrigin[],
): Promise<SafeTarget | undefined> => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    log('resolveSafeUrl: not a URL: %s', redactUrlForLog(raw));
    return undefined;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    log('resolveSafeUrl: refusing protocol %s', url.protocol);
    return undefined;
  }

  // Credentials in the URL are never legitimate here and can confuse
  // downstream parsers about which host is really being contacted.
  if (url.username || url.password) {
    log('resolveSafeUrl: refusing URL carrying credentials');
    return undefined;
  }

  if (isTrustedOrigin(url, trusted)) return { url };

  const host = url.hostname.replaceAll(/^\[|\]$/g, '');
  let answers: Array<{ address: string; family: number }>;
  if (isIP(host)) {
    answers = [{ address: host, family: isIP(host) }];
  } else {
    try {
      answers = await dns.lookup(host, { all: true });
    } catch (error) {
      log('resolveSafeUrl: DNS lookup failed for %s: %O', host, error);
      return undefined;
    }
  }

  if (answers.length === 0 || answers.some((entry) => isPrivateAddress(entry.address))) {
    log('resolveSafeUrl: refusing %s — resolves to a private address', host);
    return undefined;
  }

  return { pinned: answers[0], url };
};

/**
 * Whether `NO_PROXY` tells the proxy agent to send this host directly.
 *
 * `EnvHttpProxyAgent` applies this per destination, so a proxy being installed
 * does not mean THIS request is proxied — and a bypassed request is dispatched
 * directly, where the pin is exactly what we still need.
 */
const bypassesProxy = (hostname: string): boolean => {
  const configured = process.env.NO_PROXY || process.env.no_proxy;
  if (!configured) return false;

  const host = hostname.toLowerCase();
  return configured
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => {
      if (entry === '*') return true;
      // Entries may carry a port and may lead with `.` or `*.`; all of those
      // forms mean "this host and anything under it".
      const bare = entry.replace(/:\d+$/, '').replace(/^\*?\./, '');
      return host === bare || host.endsWith(`.${bare}`);
    });
};

/**
 * Whether THIS request actually goes through a proxy.
 *
 * Decided from the dispatcher in force, NOT from proxy environment variables:
 * `setGlobalDispatcher(EnvHttpProxyAgent)` only happens under
 * `NODE_ENV === 'development'` (see `libs/better-auth/define-config.ts`), so in
 * production a stray `HTTPS_PROXY` in the environment proxies nothing — and
 * skipping the pin on that basis would hand the hostname back to undici to
 * resolve a second time, reopening the rebinding hole.
 *
 * When a proxy IS in force for this destination, the proxy resolves DNS itself;
 * pinning a locally resolved address would bypass it along with the egress
 * policy it enforces, and would mean nothing anyway.
 */
const requestIsProxied = (url: URL): boolean => {
  const dispatcher = getGlobalDispatcher();
  const proxying = dispatcher instanceof ProxyAgent || dispatcher instanceof EnvHttpProxyAgent;
  return proxying && !bypassesProxy(url.hostname);
};

/** Redirect hops to follow before giving up. */
const MAX_REDIRECTS = 5;

export interface PublicFetchOptions {
  /**
   * Accept our own configured origins (APP_URL / S3) without the private-address
   * check. Only for URLs the SERVER produced from an owned record — a
   * caller-supplied URL that happens to sit on a configured origin is not
   * owned, and would otherwise walk straight through the guard.
   */
  allowConfiguredOrigins?: boolean;
  method?: 'GET' | 'HEAD';
}

export interface PublicFetchResult {
  /** Releases the pinned connection pool. Call once the body has been read. */
  dispose: () => Promise<void>;
  response: Response;
}

/**
 * `fetch` for a URL that may have come from a caller.
 *
 * Attachments reach the outbound senders in two ways: the push path resolves an
 * owned `fileId` server-side, but the agent-facing `botMessage` procedures
 * accept a raw `fetchUrl`. Downloading that URL server-side (which every
 * platform sender now does, in order to upload the bytes) would otherwise be an
 * SSRF primitive — and the response is handed to the chat platform, so it is an
 * exfiltration path too.
 *
 * Two properties make the check hold:
 *
 * - The connection is PINNED to the address we vetted. Validating a hostname
 *   and then letting undici resolve it again is a DNS-rebinding hole: the
 *   attacker's name answers publicly for our lookup and privately for the
 *   connection. (Skipped behind a proxy — see `proxyConfigured`.)
 * - Redirects are followed MANUALLY so every hop is re-validated: our own file
 *   proxy answers `/f/:id` with a 302, so they cannot simply be refused, and
 *   validating only the first URL would let a public host bounce us straight to
 *   the metadata endpoint.
 */
export const fetchPublicUrl = async (
  rawUrl: string,
  timeoutMs: number,
  { allowConfiguredOrigins = false, method = 'GET' }: PublicFetchOptions = {},
): Promise<PublicFetchResult | undefined> => {
  // Not opting in simply contributes no trusted origins, so a caller-supplied
  // URL on a configured private origin still faces the private-address check.
  const trusted = allowConfiguredOrigins ? trustedOrigins() : [];
  const pools: Agent[] = [];
  const dispose = async () => {
    await Promise.all(pools.map((pool) => pool.close().catch(() => pool.destroy())));
  };

  let target = rawUrl;

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const safe = await resolveSafeUrl(target, trusted);
      if (!safe) {
        await dispose();
        return undefined;
      }

      let dispatcher: Agent | undefined;
      if (safe.pinned && !requestIsProxied(safe.url)) {
        const { address, family } = safe.pinned;
        dispatcher = new Agent({
          connect: {
            // Hand undici the address we vetted instead of letting it resolve
            // the name a second time. Host/SNI still come from the URL.
            lookup: (_hostname, _options, callback) => callback(null, address, family),
          },
        });
        pools.push(dispatcher);
      }

      const response = await fetch(safe.url, {
        dispatcher,
        method,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      } as RequestInit);

      if (response.status < 300 || response.status >= 400) return { dispose, response };

      const location = response.headers.get('location');
      // Release the redirect body before following the hop.
      await response.body?.cancel().catch(() => undefined);
      if (!location) {
        log('fetchPublicUrl: %d with no location header', response.status);
        await dispose();
        return undefined;
      }
      target = new URL(location, safe.url).toString();
    }

    log('fetchPublicUrl: too many redirects for %s', redactUrlForLog(rawUrl));
    await dispose();
    return undefined;
  } catch (error) {
    await dispose();
    throw error;
  }
};
