import { ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
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

const readPreview = async (url: string): Promise<LinkPreview | null> => {
  const response = await ssrfSafeFetch(
    url,
    {
      headers: {
        'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'User-Agent': USER_AGENT,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    },
    { maxContentLength: MAX_HTML_BYTES },
  );

  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok || !/^(text\/html|application\/xhtml\+xml)/i.test(contentType)) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }

  const bytes = await response.arrayBuffer();
  const html = new TextDecoder(charsetOf(contentType)).decode(bytes);
  return parseLinkPreview(html, url);
};

/**
 * The Open Graph summary of a public web page, or `null` when the address is
 * not a public `http(s)` page, does not answer in time, or names neither a
 * title nor a description. Fetched through the SSRF guard (every redirect hop
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
      log('preview of %s failed: %O', new URL(url).origin, error);
      return null;
    }
  });
};
