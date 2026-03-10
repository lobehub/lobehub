import { setCookie } from '@lobechat/utils';
import { changeLanguage } from 'i18next';
import { describe, expect, it, vi } from 'vitest';

import { LOBE_LOCALE_COOKIE } from '@/const/locale';
import { type LocaleMode } from '@/types/locale';

import { switchLang } from './switchLang';

vi.mock('i18next', () => ({
  changeLanguage: vi.fn(),
}));

vi.mock('@lobechat/utils', () => ({
  setCookie: vi.fn(),
}));

describe('switchLang', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should change language to the specified locale', () => {
    const locale: LocaleMode = 'en-US';
    switchLang(locale);

    expect(changeLanguage).toHaveBeenCalledWith(locale);
    expect(document.documentElement.lang).toBe(locale);
    expect(setCookie).toHaveBeenCalledWith(LOBE_LOCALE_COOKIE, locale, 365);
  });

  it('should change language based on navigator.language when locale is "auto"', () => {
    const navigatorLanguage = 'fr';
    vi.spyOn(navigator, 'language', 'get').mockReturnValue(navigatorLanguage);

    switchLang('auto');

    expect(changeLanguage).toHaveBeenCalledWith(navigatorLanguage);
    expect(document.documentElement.lang).toBe(navigatorLanguage);
    expect(setCookie).toHaveBeenCalledWith(LOBE_LOCALE_COOKIE, undefined, 365);
  });
});
