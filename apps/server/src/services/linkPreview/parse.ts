import type { LinkPreview } from '@lobechat/types';
import { decodeHTML } from 'entities';

/** The card clamps both lines; longer text is never shown, so it is not stored either. */
const TITLE_LIMIT = 200;
const DESCRIPTION_LIMIT = 300;
const SITE_NAME_LIMIT = 80;
const IMAGE_URL_LIMIT = 2048;

const META_TAG = /<meta\b[^>]*>/gi;
const ATTRIBUTE = /([^\s"'/<=>]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<=>`]+)))?/g;
const TITLE_TAG = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i;
const HEAD_END = /<\/head\s*>/i;

const readAttributes = (tag: string): Record<string, string> => {
  const attributes: Record<string, string> = {};
  // Skip the tag name itself (`<meta`) and its closing `>` / `/>`.
  const body = tag.slice(5, tag.endsWith('/>') ? -2 : -1);
  for (const [, name, double, single, bare] of body.matchAll(ATTRIBUTE)) {
    const key = name.toLowerCase();
    if (!(key in attributes)) attributes[key] = double ?? single ?? bare ?? '';
  }
  return attributes;
};

const clean = (value: string | undefined, limit: number): string | undefined => {
  if (!value) return;
  const text = decodeHTML(value).replaceAll(/\s+/g, ' ').trim();
  if (!text) return;
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
};

const toHttpUrl = (value: string | undefined, base: string): string | undefined => {
  if (!value) return;
  try {
    const url = new URL(decodeHTML(value).trim(), base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    const href = url.toString();
    return href.length > IMAGE_URL_LIMIT ? undefined : href;
  } catch {
    return;
  }
};

/**
 * Read the Open Graph (falling back to Twitter card and plain HTML) summary of
 * a page from its markup. Only the `<head>` is read when the page closes it,
 * so a `<meta>` quoted inside an article body cannot stand in for the page's.
 * Returns `null` when the page names neither a title nor a description: a
 * card with nothing to say is not shown.
 */
export const parseLinkPreview = (html: string, url: string): LinkPreview | null => {
  const headEnd = html.search(HEAD_END);
  const head = headEnd === -1 ? html : html.slice(0, headEnd);

  // First value wins per key, as crawlers read them.
  const meta: Record<string, string> = {};
  for (const [tag] of head.matchAll(META_TAG)) {
    const attributes = readAttributes(tag);
    const key = (attributes.property || attributes.name || attributes.itemprop)?.toLowerCase();
    const content = attributes.content;
    if (!key || content === undefined || key in meta) continue;
    meta[key] = content;
  }

  const title = clean(
    meta['og:title'] || meta['twitter:title'] || head.match(TITLE_TAG)?.[1],
    TITLE_LIMIT,
  );
  const description = clean(
    meta['og:description'] || meta['twitter:description'] || meta['description'],
    DESCRIPTION_LIMIT,
  );
  if (!title && !description) return null;

  const image = toHttpUrl(
    meta['og:image:secure_url'] ||
      meta['og:image'] ||
      meta['og:image:url'] ||
      meta['twitter:image'] ||
      meta['twitter:image:src'],
    url,
  );

  return {
    description,
    image,
    largeImage: image && meta['twitter:card'] === 'summary_large_image' ? true : undefined,
    siteName: clean(meta['og:site_name'] || meta['application-name'], SITE_NAME_LIMIT),
    title,
    url,
  };
};
