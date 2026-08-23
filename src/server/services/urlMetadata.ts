import type { LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { parseHTML } from 'linkedom';
import { Agent, fetch as undiciFetch } from 'undici';

const FETCH_TIMEOUT_MS = 5000;
const MAX_HTML_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;
const METADATA_CACHE_TTL_MS = 30_000;
const METADATA_CACHE_MAX_ENTRIES = 500;
const METADATA_RATE_LIMIT_MAX = 30;
const METADATA_RATE_LIMIT_MAX_BUCKETS = 10_000;
const METADATA_RATE_LIMIT_WINDOW_MS = 60_000;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

type LookupImpl = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<LookupAddress[]>;

type MetadataFetchImpl = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface UrlMetadata {
  description?: string;
  icon: string;
  title: string;
  url: string;
}

interface FetchUrlMetadataOptions {
  allowLocalhost?: boolean;
  cache?: boolean;
  cacheMaxEntries?: number;
  cacheTtlMs?: number;
  fetchImpl?: MetadataFetchImpl;
  lookupImpl?: LookupImpl;
  now?: () => number;
}

export class UrlMetadataError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = 'UrlMetadataError';
  }
}

export const getLobeDocumentIdentifierFromUrl = (
  rawUrl: string,
  applicationUrl: string,
  allowLoopback = false,
): string | undefined => {
  let target: URL;
  let application: URL;

  try {
    target = new URL(rawUrl);
    application = new URL(applicationUrl);
  } catch {
    return;
  }

  const isSameOrigin = target.origin === application.origin;
  const isSameLoopbackApplication =
    allowLoopback &&
    LOOPBACK_HOSTS.has(target.hostname) &&
    LOOPBACK_HOSTS.has(application.hostname) &&
    target.port === application.port;
  if (!isSameOrigin && !isSameLoopbackApplication) return;

  const match = target.pathname.match(/^\/(?:page|share\/page)\/([^/]+)\/?$/);
  if (!match?.[1]) return;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return;
  }
};

export const isBlockedUrlMetadataAddress = (address: string): boolean => {
  const normalized = address.toLowerCase().split('%')[0];

  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }

  if (isIP(normalized) === 6) {
    if (normalized === '::' || normalized === '::1') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (/^fe[89ab]/.test(normalized)) return true;
    if (normalized.startsWith('2001:db8:')) return true;
    if (normalized.startsWith('::ffff:')) {
      return isBlockedUrlMetadataAddress(normalized.slice('::ffff:'.length));
    }
  }

  return false;
};

const resolveSafeAddress = async (
  url: URL,
  allowLocalhost: boolean,
  lookupImpl: LookupImpl = lookup,
): Promise<LookupAddress> => {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlMetadataError('Only http and https URLs are supported');
  }

  if (url.username || url.password) {
    throw new UrlMetadataError('URLs containing credentials are not supported');
  }

  let addresses: LookupAddress[];
  try {
    addresses = await lookupImpl(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new UrlMetadataError('Unable to resolve URL hostname', 422);
  }

  const isAllowedLoopback = allowLocalhost && LOOPBACK_HOSTS.has(url.hostname);
  if (
    addresses.length === 0 ||
    (!isAllowedLoopback && addresses.some(({ address }) => isBlockedUrlMetadataAddress(address)))
  ) {
    throw new UrlMetadataError('Private or non-routable URL targets are not allowed', 403);
  }

  return addresses[0];
};

const createPinnedDispatcher = (address: LookupAddress) =>
  new Agent({
    connect: {
      // Keep the URL hostname untouched so Undici sends the original Host and
      // uses it for TLS SNI, while this lookup callback pins the socket to the
      // address that passed the SSRF check above.
      lookup: (_lookupHostname, options, callback) => {
        if (options.all) callback(null, [{ address: address.address, family: address.family }]);
        else callback(null, address.address, address.family);
      },
    },
  });

const readLimitedHtml = async (response: Response): Promise<string> => {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_HTML_BYTES) {
    throw new UrlMetadataError('URL response is too large', 422);
  }

  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let html = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    bytes += value.byteLength;
    if (bytes > MAX_HTML_BYTES) {
      await reader.cancel();
      throw new UrlMetadataError('URL response is too large', 422);
    }
    html += decoder.decode(value, { stream: true });
  }

  return html + decoder.decode();
};

const resolveMetadataUrl = (value: string | null | undefined, pageUrl: string) => {
  if (!value) return;

  try {
    return new URL(value, pageUrl).toString();
  } catch {
    return;
  }
};

const cleanText = (value: string | null | undefined, maxLength: number) => {
  const cleaned = value?.replaceAll(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, maxLength) : undefined;
};

export const extractUrlMetadata = (html: string, pageUrl: string): UrlMetadata => {
  const { document } = parseHTML(html);
  const meta = new Map<string, string>();

  for (const element of document.querySelectorAll('meta')) {
    const key = (element.getAttribute('property') || element.getAttribute('name'))?.toLowerCase();
    const content = cleanText(element.getAttribute('content'), 500);
    if (key && content && !meta.has(key)) meta.set(key, content);
  }

  const iconElement = Array.from(document.querySelectorAll('link[rel]')).find((element) =>
    element
      .getAttribute('rel')
      ?.toLowerCase()
      .split(/\s+/)
      .some((value) => value === 'icon' || value === 'shortcut'),
  );
  const page = new URL(pageUrl);
  const title =
    cleanText(meta.get('og:title') || meta.get('twitter:title') || document.title, 200) ||
    page.hostname;
  const description = cleanText(
    meta.get('og:description') || meta.get('description') || meta.get('twitter:description'),
    500,
  );
  const icon =
    resolveMetadataUrl(iconElement?.getAttribute('href'), pageUrl) ||
    new URL('/favicon.ico', pageUrl).toString();

  return { description, icon, title, url: pageUrl };
};

export const fetchUrlMetadata = async (
  rawUrl: string,
  options: FetchUrlMetadataOptions = {},
): Promise<UrlMetadata> => {
  let currentUrl: URL;

  try {
    currentUrl = new URL(rawUrl);
  } catch {
    throw new UrlMetadataError('Invalid URL');
  }

  const normalizedUrl = currentUrl.toString();
  const useCache = options.cache !== false;
  const now = options.now ?? Date.now;
  const requestedCacheMaxEntries = options.cacheMaxEntries ?? METADATA_CACHE_MAX_ENTRIES;
  const cacheMaxEntries = Number.isFinite(requestedCacheMaxEntries)
    ? Math.max(1, Math.floor(requestedCacheMaxEntries))
    : METADATA_CACHE_MAX_ENTRIES;
  const cacheKey = `${options.allowLocalhost ? 'local:' : 'public:'}${normalizedUrl}`;
  if (useCache) cleanupExpiredMetadataCache(now());
  const cached = metadataCache.get(cacheKey);
  if (useCache && cached && cached.expiresAt > now()) return cached.value;
  if (useCache) {
    const pending = metadataInFlight.get(cacheKey);
    if (pending) return pending;
  }

  const fetchImpl = options.fetchImpl || (undiciFetch as unknown as MetadataFetchImpl);
  const request = (async () => {
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const address = await resolveSafeAddress(
        currentUrl,
        Boolean(options.allowLocalhost),
        options.lookupImpl,
      );
      const dispatcher = createPinnedDispatcher(address);

      try {
        const response = await fetchImpl(currentUrl, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml',
            'User-Agent': 'LobeHub-Link-Metadata/1.0',
          },
          redirect: 'manual',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          dispatcher,
        } as RequestInit & { dispatcher: Agent });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) throw new UrlMetadataError('URL redirect is missing a location', 422);
          if (redirectCount === MAX_REDIRECTS) {
            throw new UrlMetadataError('URL redirected too many times', 422);
          }
          currentUrl = new URL(location, currentUrl);
          continue;
        }

        if (!response.ok) {
          throw new UrlMetadataError(`URL returned HTTP ${response.status}`, 422);
        }

        const contentType = response.headers.get('content-type')?.toLowerCase() || '';
        if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
          throw new UrlMetadataError('URL did not return HTML', 422);
        }

        const html = await readLimitedHtml(response);
        return extractUrlMetadata(html, currentUrl.toString());
      } finally {
        await dispatcher.close();
      }
    }

    throw new UrlMetadataError('Unable to fetch URL metadata', 422);
  })();

  if (!useCache) return request;

  metadataInFlight.set(cacheKey, request);
  try {
    const value = await request;
    cleanupExpiredMetadataCache(now());
    // Map insertion order is the cache's oldest-first eviction order. Expired
    // entries are removed first so a stale entry never consumes capacity.
    while (metadataCache.size >= cacheMaxEntries) {
      const oldestKey = metadataCache.keys().next().value;
      if (oldestKey === undefined) break;
      metadataCache.delete(oldestKey);
    }
    metadataCache.set(cacheKey, {
      expiresAt: now() + (options.cacheTtlMs ?? METADATA_CACHE_TTL_MS),
      value,
    });
    return value;
  } finally {
    metadataInFlight.delete(cacheKey);
  }
};

interface CachedMetadata {
  expiresAt: number;
  value: UrlMetadata;
}

const metadataCache = new Map<string, CachedMetadata>();
const metadataInFlight = new Map<string, Promise<UrlMetadata>>();

const cleanupExpiredMetadataCache = (now: number) => {
  for (const [key, entry] of metadataCache) {
    if (entry.expiresAt <= now) metadataCache.delete(key);
  }
};

interface RateLimitEntry {
  count: number;
  expiresAt: number;
}

const metadataRateLimits = new Map<string, RateLimitEntry>();

const cleanupExpiredRateLimitBuckets = (now: number) => {
  for (const [userId, entry] of metadataRateLimits) {
    if (entry.expiresAt <= now) metadataRateLimits.delete(userId);
  }
};

export const consumeUrlMetadataRateLimit = (
  userId: string,
  now = Date.now(),
  maxRequests = METADATA_RATE_LIMIT_MAX,
  windowMs = METADATA_RATE_LIMIT_WINDOW_MS,
  maxBuckets = METADATA_RATE_LIMIT_MAX_BUCKETS,
): { allowed: boolean; retryAfterSeconds: number } => {
  cleanupExpiredRateLimitBuckets(now);
  const current = metadataRateLimits.get(userId);
  const bucketLimit = Number.isFinite(maxBuckets)
    ? Math.max(1, Math.floor(maxBuckets))
    : METADATA_RATE_LIMIT_MAX_BUCKETS;
  if (!current && metadataRateLimits.size >= bucketLimit) {
    const nextExpiry = Math.min(
      ...Array.from(metadataRateLimits.values(), (entry) => entry.expiresAt),
    );
    // Never evict an active bucket: denying a new identity is safer than
    // letting an attacker rotate user IDs to reset the request counter.
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((nextExpiry - now) / 1000)),
    };
  }

  if (!current) {
    metadataRateLimits.set(userId, {
      count: 1,
      expiresAt: now + windowMs,
    });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (current.count >= maxRequests) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.expiresAt - now) / 1000)),
    };
  }

  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
};

export const clearUrlMetadataCaches = () => {
  metadataCache.clear();
  metadataInFlight.clear();
  metadataRateLimits.clear();
};

export const getUrlMetadataCacheSize = () => metadataCache.size;
export const getUrlMetadataRateLimitBucketCount = () => metadataRateLimits.size;
