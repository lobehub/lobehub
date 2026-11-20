import { resolveAcceptLanguage } from 'resolve-accept-language';

import { DEFAULT_LANG } from '@/const/locale';
import { type Locales } from '@/locales/resources';
import { locales, normalizeLocale } from '@/locales/resources';

import { RouteVariants } from './server/routeVariants';

const normalizeAcceptLanguageHeader = (acceptLanguage: string) =>
  acceptLanguage
    .replaceAll(/zh-Hans(?:-[a-z]{2})?/gi, 'zh-CN')
    .replaceAll(/zh-Hant(?:-[a-z]{2})?/gi, 'zh-TW');

const supportedAcceptLanguageLocales = locales.map((locale) =>
  locale === 'ar' ? 'ar-EG' : locale,
);

/**
 * Parse the browser language and return the fallback language
 */
export const parseBrowserLanguage = (headers: Headers, defaultLang: string = DEFAULT_LANG) => {
  // if the default language is not 'en-US', just return the default language as fallback lang
  if (defaultLang !== 'en-US') return defaultLang;

  /**
   * The arguments are as follows:
   *
   * 1) The HTTP accept-language header.
   * 2) The available locales (they must contain the default locale).
   * 3) The default locale.
   */
  let browserLang: string = resolveAcceptLanguage(
    normalizeAcceptLanguageHeader(headers.get('accept-language') || ''),
    //  Invalid locale identifier 'ar'. A valid locale should follow the BCP 47 'language-country' format.
    supportedAcceptLanguageLocales,
    defaultLang,
  );

  // if match the ar-EG then fallback to ar
  if (browserLang === 'ar-EG') browserLang = 'ar';

  return normalizeLocale(browserLang);
};

/**
 * Parse the page locale from the URL and search
 * used in cloud
 */
export const parsePageLocale = async (props: {
  params: Promise<{ variants: string }>;
  searchParams: Promise<any>;
}) => {
  const searchParams = await props.searchParams;

  const browserLocale = await RouteVariants.getLocale(props);
  return normalizeLocale(searchParams?.hl || browserLocale) as Locales;
};
