import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

import debug from 'debug';

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
const trustedOrigins = (): Set<string> => {
  const origins = new Set<string>();
  for (const candidate of [appEnv.APP_URL, fileEnv.S3_PUBLIC_DOMAIN, fileEnv.S3_ENDPOINT]) {
    if (!candidate) continue;
    try {
      origins.add(new URL(candidate).origin);
    } catch {
      // A misconfigured env value simply contributes no trusted origin.
    }
  }
  return origins;
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

const isPrivateV6 = (ip: string): boolean => {
  const address = ip.toLowerCase().split('%')[0];
  if (address === '::1' || address === '::') return true;
  // IPv4-mapped (::ffff:10.0.0.1) must be judged by the embedded v4 address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (mapped) return isPrivateV4(mapped[1]);
  // fc00::/7 unique-local, fe80::/10 link-local.
  return /^f[cd]/.test(address) || /^fe[89ab]/.test(address);
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
const resolveSafeUrl = async (raw: string, trusted: Set<string>): Promise<URL | undefined> => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    log('resolveSafeUrl: not a URL: %s', raw);
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

  if (trusted.has(url.origin)) return url;

  const host = url.hostname.replaceAll(/^\[|\]$/g, '');
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await dns.lookup(host, { all: true })).map((entry) => entry.address);
    } catch (error) {
      log('resolveSafeUrl: DNS lookup failed for %s: %O', host, error);
      return undefined;
    }
  }

  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    log('resolveSafeUrl: refusing %s — resolves to a private address', host);
    return undefined;
  }

  return url;
};

/** Redirect hops to follow before giving up. */
const MAX_REDIRECTS = 5;

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
 * Redirects are followed MANUALLY so every hop is re-validated: our own file
 * proxy answers `/f/:id` with a 302, and validating only the first URL would
 * let a public host bounce us straight to the metadata endpoint.
 */
export const fetchPublicUrl = async (
  rawUrl: string,
  timeoutMs: number,
): Promise<Response | undefined> => {
  const trusted = trustedOrigins();
  let target = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await resolveSafeUrl(target, trusted);
    if (!url) return undefined;

    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get('location');
    // Release the redirect body before following the hop.
    await response.body?.cancel().catch(() => undefined);
    if (!location) {
      log('fetchPublicUrl: %d with no location header', response.status);
      return undefined;
    }
    target = new URL(location, url).toString();
  }

  log('fetchPublicUrl: too many redirects for %s', rawUrl);
  return undefined;
};
