import { setCookie } from '@lobechat/utils';
import { changeLanguage } from 'i18next';

import { LOBE_LOCALE_COOKIE } from '@/const/locale';
import { type LocaleMode } from '@/types/locale';
import { applyDocumentDirection } from '@/utils/client/applyDocumentDirection';

export const switchLang = (locale: LocaleMode) => {
  const lang = locale === 'auto' ? navigator.language : locale;

  changeLanguage(lang);
  document.documentElement.lang = lang;
  applyDocumentDirection(lang);

  setCookie(LOBE_LOCALE_COOKIE, locale === 'auto' ? undefined : locale, 365);
};
