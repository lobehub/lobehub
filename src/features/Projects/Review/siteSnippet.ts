import { ACCEPTANCE_REVIEW_ACTIVATION_PARAM } from '@lobechat/const';
import { normalizeSiteOrigin, type SiteOriginError } from '@lobechat/utils/siteOrigin';

const REVIEW_SDK_SRC = 'https://web-assets.lobehub.com/review-sdk/assets/v1/lobehub-review.js';
const REVIEW_DEFAULT_SERVER = 'https://app.lobehub.com';

const HTML_ATTRIBUTE_ESCAPES: Record<string, string> = {
  '"': '&quot;',
  '&': '&amp;',
  "'": '&#39;',
  '<': '&lt;',
  '>': '&gt;',
};

const escapeAttribute = (value: string) =>
  value.replaceAll(/["&'<>]/g, (char) => HTML_ATTRIBUTE_ESCAPES[char]);

export const siteSnippet = (siteId: string, server: string) =>
  `<script src="${REVIEW_SDK_SRC}" data-site="${escapeAttribute(siteId)}"${
    server === REVIEW_DEFAULT_SERVER ? '' : ` data-server="${escapeAttribute(server)}"`
  }></script>`;

/**
 * Opens a site with the toolbar activated. A site only stores origins (paths,
 * queries and hashes are rejected), so this always targets the origin root;
 * the parameter is what tells the SDK which acceptance to review.
 */
export const reviewLink = (origins: string[], acceptanceId?: null | string) => {
  const origin = origins.find((item) => !item.includes('://*.'));
  if (!origin || !acceptanceId) return null;

  // Origins are normalized on write, so this only keeps a drifted row out of a
  // rendered href instead of crashing the card.
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.searchParams.set(ACCEPTANCE_REVIEW_ACTIVATION_PARAM, acceptanceId);
    return url.toString();
  } catch {
    return null;
  }
};

export const checkOrigins = (origins: string[]): (SiteOriginError | undefined)[] =>
  origins.map((origin) => {
    if (!origin.trim()) return undefined;
    const result = normalizeSiteOrigin(origin);
    return result.ok ? undefined : result.reason;
  });

const SERVER_ORIGIN_ERROR = /^invalidOrigin:(\d+):(\w+)$/;

export const originErrorFromServer = (error: unknown) => {
  const match = error instanceof Error ? SERVER_ORIGIN_ERROR.exec(error.message) : null;
  return match ? { index: Number(match[1]), reason: match[2] as SiteOriginError } : undefined;
};
