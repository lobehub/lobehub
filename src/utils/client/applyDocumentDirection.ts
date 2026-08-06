import { isRtlLang } from 'rtl-detect';

import { getSystemLanguage } from '@/utils/client/systemLanguage';

const getDocumentLocale = () => {
  if (typeof document === 'undefined') return;

  return document.documentElement.lang || undefined;
};

/** Resolve LocaleMode `auto` to the effective language used for layout direction. */
export const resolveDirectionLanguage = (lang?: string) => {
  if (!lang || lang === 'auto') {
    return getDocumentLocale() ?? getSystemLanguage();
  }

  return lang;
};

export const getDocumentDirection = (lang?: string) =>
  isRtlLang(resolveDirectionLanguage(lang) ?? '') ? 'rtl' : 'ltr';

export const applyDocumentDirection = (lang?: string) => {
  if (typeof document === 'undefined') return;

  document.documentElement.dir = getDocumentDirection(lang);
};
