import { DEFAULT_PRERENDER_LOCALE } from './prerender';

export const resolveAuthLocale = (): string => {
  if (typeof document !== 'undefined') {
    return document.documentElement.lang || DEFAULT_PRERENDER_LOCALE;
  }

  return __AUTH_PRERENDER_LOCALE__;
};
