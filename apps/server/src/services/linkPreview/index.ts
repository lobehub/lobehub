import { isSSRFBlockedError, type SSRFOptions, ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import type { LinkPreview } from '@lobechat/types';
import debug from 'debug';

import { redisService } from '@/server/services/redis';

import { parseLinkPreview } from './parse';

const log = debug('lobe-server:link-preview');

/** Pages put their `<head>` first; reading further only costs bandwidth. */
const MAX_HTML_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 5000;
export const MAX_LINK_PREVIEW_URL_LENGTH = 2048;

// Many sites only hand their Open Graph markup to crawlers they recognise.
const USER_AGENT = 'Mozilla/5.0 (compatible; LobeHubBot/1.0; +https://lobehub.com)';

/** The address a preview is cached and fetched under, or `null` when it cannot have one. */
export const normalizeLinkPreviewUrl = (input: string): string | null => {
  if (input.length > MAX_LINK_PREVIEW_URL_LENGTH) return null;
  try {
    const url = new URL(input);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // Credentials must never reach a third-party fetch or a shared cache key.
    if (url.username || url.password) return null;
    // The fragment never reaches the server, so it cannot change the page.
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
};

const charsetOf = (contentType: string) => {
  const charset = /charset\s*=\s*"?([\w-]+)/i.exec(contentType)?.[1];
  if (!charset) return 'utf8';
  try {
    return new TextDecoder(charset).encoding;
  } catch {
    return 'utf8';
  }
};

/**
 * Public addresses only, on every hop. A deployment may let other fetches
 * reach private hosts (`SSRF_ALLOW_PRIVATE_IP_ADDRESS`, `SSRF_ALLOW_IP_ADDRESS_LIST`
 * for an internal MCP or model endpoint); any signed-in user can ask for a
 * preview, so those exceptions must not apply here.
 */
const PUBLIC_ONLY: SSRFOptions = {
  allowIPAddressList: [],
  allowPrivateIPAddress: false,
  maxContentLength: MAX_HTML_BYTES,
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

/**
 * Fetch `url`, following redirects here rather than inside the fetch: the
 * SSRF-safe Response does not carry the final address, and relative image
 * paths must resolve against the page that actually answered. Every hop goes
 * through the same SSRF guard.
 */
const fetchPage = async (url: string, signal: AbortSignal) => {
  let current = url;
  for (let hop = 0; ; hop++) {
    const response = await ssrfSafeFetch(
      current,
      {
        headers: {
          'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
          'User-Agent': USER_AGENT,
        },
        redirect: 'manual',
        signal,
      },
      PUBLIC_ONLY,
    );

    const location = response.headers.get('location');
    if (!REDIRECT_STATUSES.has(response.status) || !location) return { response, url: current };

    await response.body?.cancel().catch(() => undefined);
    if (hop === MAX_REDIRECTS) return null;
    const next = normalizeLinkPreviewUrl(new URL(location, current).toString());
    if (!next) return null;
    current = next;
  }
};

const readPreview = async (url: string): Promise<LinkPreview | null> => {
  const page = await fetchPage(url, AbortSignal.timeout(FETCH_TIMEOUT_MS));
  if (!page) return null;
  const { response } = page;

  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok || !/^(text\/html|application\/xhtml\+xml)/i.test(contentType)) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }

  const bytes = await response.arrayBuffer();
  const html = new TextDecoder(charsetOf(contentType)).decode(bytes);
  // The card links what the message linked; its image is relative to the page that answered.
  return parseLinkPreview(html, url, page.url);
};

/**
 * The Open Graph summary of a public web page, or `null` when the address is
 * not a public `http(s)` page (private and reserved hosts included) or the page
 * names neither a title nor a description. Rejects with `LinkPreviewUnavailableError` when the page could
 * not be read (timeout, refused, blocked), so a viewer keeps the card it has. Fetched through the SSRF guard (every redirect hop
 * included), and shared by every viewer through the cache: one page is read
 * once a day however many messages link it.
 */
export const getLinkPreview = async (input: string): Promise<LinkPreview | null> => {
  const url = normalizeLinkPreviewUrl(input);
  if (!url) return null;

  return redisService.linkPreview.remember(url, async () => {
    try {
      return await readPreview(url);
    } catch (error) {
      // A private or reserved address will never have a public card.
      if (isSSRFBlockedError(error)) return null;
      log('preview of %s failed: %O', new URL(url).origin, error);
      throw error;
    }
  });
};
