import { setCookie } from '@lobechat/utils';
import { changeLanguage } from 'i18next';

import { LOBE_LOCALE_COOKIE } from '@/const/locale';
import { type LocaleMode } from '@/types/locale';
import { getSystemLanguage } from '@/utils/client/systemLanguage';

export const switchLang = (locale: LocaleMode) => {
  const lang = locale === 'auto' ? getSystemLanguage() : locale;

  changeLanguage(lang);
  document.documentElement.lang = lang;

  setCookie(LOBE_LOCALE_COOKIE, locale === 'auto' ? undefined : locale, 365);
};
