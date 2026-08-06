import { useTheme } from 'antd-style';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveUILocale } from '@/libs/getUILocaleAndResources.utils';
import {
  getLocaleFontConfig,
  mergeThemeFontFamily,
} from '@/utils/client/localeFont';

export interface UseLocaleThemeFontOptions {
  customFontFamily?: string;
  customFontURL?: string;
  /** When set, used instead of i18n/document locale (e.g. global store language with `'auto'`). */
  language?: string;
}

export interface LocaleThemeFontResult {
  fontFamily: string | undefined;
  fontURL: string | undefined;
}

export const useLocaleThemeFont = (
  options: UseLocaleThemeFontOptions = {},
): LocaleThemeFontResult => {
  const { customFontFamily, customFontURL, language } = options;
  const antdTheme = useTheme();
  const { i18n } = useTranslation();

  const resolvedLocale = useMemo(() => {
    if (language !== undefined) {
      return resolveUILocale(language).normalizedLocale;
    }

    const lang =
      i18n.resolvedLanguage ||
      i18n.language ||
      (typeof document !== 'undefined' ? document.documentElement.lang : undefined);

    return resolveUILocale(lang || 'auto').normalizedLocale;
  }, [i18n.language, i18n.resolvedLanguage, language]);

  const localeFont = getLocaleFontConfig(resolvedLocale);
  const primaryFontFamily = customFontFamily ?? localeFont?.fontFamily;

  return {
    fontFamily: mergeThemeFontFamily(primaryFontFamily, antdTheme.fontFamily),
    fontURL: customFontURL ?? localeFont?.fontURL,
  };
};
