import { normalizeSiteOrigin, type SiteOriginError } from '@lobechat/utils/siteOrigin';

const REVIEW_SDK_SRC = 'https://web-assets.lobehub.com/review-sdk/assets/v1/lobehub-review.js';
const REVIEW_DEFAULT_SERVER = 'https://app.lobehub.com';
const SITE_WAKE_PARAM = 'lh-review';

export const siteSnippet = (siteId: string, server: string) =>
  `<script src="${REVIEW_SDK_SRC}" data-site="${siteId}"${
    server === REVIEW_DEFAULT_SERVER ? '' : ` data-server="${server}"`
  }></script>`;

export const reviewLink = (origins: string[]) => {
  const origin = origins.find((item) => !item.includes('://*.'));
  return origin ? `${origin}/?${SITE_WAKE_PARAM}` : null;
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
