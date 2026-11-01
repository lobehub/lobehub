import { APPLE_APP_STORE_ID, BRANDING_NAME, ORG_NAME } from '@lobechat/business-const';
import type { MetaDescriptor } from 'react-router';
import urlJoin from 'url-join';

import { OFFICIAL_SITE } from '@/const/url';
import { isCustomORG } from '@/const/version';

import { readAuthResources } from '../shell/authResources';

const OG_IMAGE_URL = 'https://lobehub.com/assets/cao-og.webp';
const TWITTER_SITE = '@lobehub';
const INDEXABLE_PATHS = new Set(['/signin', '/signup']);

const interpolate = (text: string) => text.replaceAll('{{appName}}', BRANDING_NAME);

const lookup = (resources: Record<string, string>, key: string, fallback: string) =>
  interpolate(resources[key] || fallback);

export const buildAuthMeta = (locale: string, pathname: string): MetaDescriptor[] => {
  const normalized =
    pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const auth = readAuthResources(locale).auth;
  const indexable = INDEXABLE_PATHS.has(normalized);
  const descriptionFallback = lookup(auth, 'signin.subtitle', '');

  let title = BRANDING_NAME;
  let description = descriptionFallback;
  let canonical: string | undefined;

  switch (normalized) {
    case '/signin': {
      title = lookup(auth, 'betterAuth.signin.emailStep.title', 'Sign In');
      description = lookup(auth, 'signin.subtitle', descriptionFallback);
      canonical = urlJoin(OFFICIAL_SITE, '/signin');
      break;
    }
    case '/signup': {
      title = lookup(auth, 'betterAuth.signup.title', 'Create Account');
      description = lookup(auth, 'betterAuth.signup.subtitle', descriptionFallback);
      canonical = urlJoin(OFFICIAL_SITE, '/signup');
      break;
    }
    default: {
      break;
    }
  }

  const ogLocale = locale.replace('-', '_');
  const meta: MetaDescriptor[] = [
    { title },
    { content: description, name: 'description' },
    { content: indexable ? 'index, follow' : 'noindex, nofollow', name: 'robots' },
    { content: title, property: 'og:title' },
    { content: description, property: 'og:description' },
    { content: 'website', property: 'og:type' },
    { content: BRANDING_NAME, property: 'og:site_name' },
    { content: ogLocale, property: 'og:locale' },
    { content: OG_IMAGE_URL, property: 'og:image' },
    { content: title, property: 'og:image:alt' },
    { content: 'summary_large_image', name: 'twitter:card' },
    { content: isCustomORG ? `@${ORG_NAME}` : TWITTER_SITE, name: 'twitter:site' },
    { content: title, name: 'twitter:title' },
    { content: description, name: 'twitter:description' },
    { content: OG_IMAGE_URL, name: 'twitter:image' },
  ];

  if (canonical) {
    meta.push(
      { href: canonical, rel: 'canonical', tagName: 'link' },
      { content: canonical, property: 'og:url' },
    );
  }

  if (APPLE_APP_STORE_ID) {
    meta.push({ content: `app-id=${APPLE_APP_STORE_ID}`, name: 'apple-itunes-app' });
  }

  return meta;
};
