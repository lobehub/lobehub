import { BRANDING_NAME } from '@lobechat/business-const';
import type { MetaDescriptor } from 'react-router';

// Shared with landing-rr: workbench pages ship behind the lobehub.com gateway,
// so the landing's OG artwork is the brand card for these pages too. Absolute
// URL on purpose — OG scrapers do not resolve relative image paths.
const OG_IMAGE_URL = 'https://lobehub.com/assets/cao-og.webp';
const TWITTER_SITE = '@lobehub';

const FALLBACK_DESCRIPTION = 'Verification runs, delivery reports, and acceptance reviews.';

export const workbenchMetaDescription = (resources: unknown): string => {
  const verify = (resources as Record<string, Record<string, unknown>> | undefined)?.verify;
  const text = verify?.['meta.description'];
  return typeof text === 'string' ? text : FALLBACK_DESCRIPTION;
};

export const truncateDescription = (text: string | null | undefined, max = 200) => {
  if (!text) return undefined;
  const clean = text.replaceAll(/\s+/g, ' ').trim();
  if (!clean) return undefined;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

interface BuildPageMetaOptions {
  description: string;
  locale?: string;
  title: string;
  type?: 'article' | 'website';
}

export const buildPageMeta = ({
  description,
  locale = 'en-US',
  title,
  type = 'website',
}: BuildPageMetaOptions): MetaDescriptor[] => [
  { title },
  { content: description, name: 'description' },
  { content: 'noindex, nofollow', name: 'robots' },
  { content: title, property: 'og:title' },
  { content: description, property: 'og:description' },
  { content: type, property: 'og:type' },
  { content: BRANDING_NAME, property: 'og:site_name' },
  { content: locale.replace('-', '_'), property: 'og:locale' },
  { content: OG_IMAGE_URL, property: 'og:image' },
  { content: title, property: 'og:image:alt' },
  { content: 'summary_large_image', name: 'twitter:card' },
  { content: TWITTER_SITE, name: 'twitter:site' },
  { content: title, name: 'twitter:title' },
  { content: description, name: 'twitter:description' },
  { content: OG_IMAGE_URL, name: 'twitter:image' },
];
