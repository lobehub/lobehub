export const DEFAULT_PRERENDER_LOCALE = 'en-US';

export const SPA_FALLBACK_DOCUMENT = '/index.html';

export const PRERENDER_ROUTES = [
  '/signin',
  '/signup',
  '/verify-email',
  '/reset-password',
] as const;

// Hand-written: `react-router.config.ts` is loaded by plain Node and cannot
// resolve the repo's path aliases, so this list cannot be imported from
// `@/locales/resources`. `scripts/build.mjs` checks it against locales on disk.
export const PRERENDER_LOCALES = [
  'ar',
  'bg-BG',
  'de-DE',
  'en-US',
  'es-ES',
  'fa-IR',
  'fr-FR',
  'it-IT',
  'ja-JP',
  'ko-KR',
  'nl-NL',
  'pl-PL',
  'pt-BR',
  'ru-RU',
  'tr-TR',
  'vi-VN',
  'zh-CN',
  'zh-TW',
] as const;

export const prerenderOutputDir = (route: string) => route.replace(/^\//, '');

export const resolveDocumentLocale = (locale: string) =>
  (PRERENDER_LOCALES as readonly string[]).includes(locale) ? locale : DEFAULT_PRERENDER_LOCALE;

export const documentPathFor = (pathname: string, locale: string) => {
  const route = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const prerendered = (PRERENDER_ROUTES as readonly string[]).includes(route);

  if (!prerendered) return SPA_FALLBACK_DOCUMENT;

  const document = `${route}/index.html`;
  if (locale === DEFAULT_PRERENDER_LOCALE) return document;

  return `/__i18n/${locale}${document}`;
};
