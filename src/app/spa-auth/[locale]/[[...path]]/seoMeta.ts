import { BRANDING_NAME, ORG_NAME } from '@lobechat/business-const';
import { OG_URL } from '@lobechat/const';
import urlJoin from 'url-join';

import { OFFICIAL_URL } from '@/const/url';
import { isCustomORG } from '@/const/version';
import { normalizeLocale } from '@/locales/resources';
import { translation } from '@/server/translation';

interface AuthSeoEntry {
  canonicalPath?: string;
  description: string;
  title: string;
}

export async function buildAuthSeoEntry(locale: string, pathname: string): Promise<AuthSeoEntry> {
  const { t } = await translation('auth', normalizeLocale(locale));
  const normalizedPath =
    pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

  switch (normalizedPath) {
    case '/signin': {
      return {
        canonicalPath: '/signin',
        description: t('signin.subtitle', { appName: BRANDING_NAME }),
        title: t('betterAuth.signin.emailStep.title'),
      };
    }
    case '/signup': {
      return {
        canonicalPath: '/signup',
        description: t('betterAuth.signup.subtitle'),
        title: t('betterAuth.signup.title'),
      };
    }
    default: {
      return {
        description: t('signin.subtitle', { appName: BRANDING_NAME }),
        title: BRANDING_NAME,
      };
    }
  }
}

export async function buildSeoMeta(locale: string, pathname: string): Promise<string> {
  const lng = normalizeLocale(locale);
  const { title, description, canonicalPath } = await buildAuthSeoEntry(lng, pathname);
  const ogUrl = canonicalPath ? urlJoin(OFFICIAL_URL, canonicalPath) : OFFICIAL_URL;

  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${ogUrl}" />`,
    `<meta property="og:image" content="${OG_URL}" />`,
    `<meta property="og:site_name" content="${BRANDING_NAME}" />`,
    `<meta property="og:locale" content="${lng}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${OG_URL}" />`,
    `<meta name="twitter:site" content="${isCustomORG ? `@${ORG_NAME}` : '@lobehub'}" />`,
  ].join('\n    ');
}
