import { APPLE_APP_STORE_ID, BRANDING_NAME } from '@lobechat/business-const';

import { translation } from '@/libs/i18n/serverTranslation';
import { normalizeLocale } from '@/locales/resources';

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
  const { title, description } = await buildAuthSeoEntry(lng, pathname);

  const metas = [`<title>${title}</title>`, `<meta name="description" content="${description}" />`];

  if (APPLE_APP_STORE_ID) {
    metas.push(`<meta name="apple-itunes-app" content="app-id=${APPLE_APP_STORE_ID}" />`);
  }

  return metas.join('\n    ');
}
