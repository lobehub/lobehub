import type { Locales } from '@/locales/resources';
import { localeOptions } from '@/locales/resources';
import type { LocaleMode } from '@/types/locale';

export const getLanguageDisplayLabel = (
  languageMode: LocaleMode,
  currentLanguage: Locales,
  autoLabel: string,
) => {
  const activeLanguage = languageMode === 'auto' ? currentLanguage : languageMode;
  const activeLabel =
    localeOptions.find((item) => item.value === activeLanguage)?.label || 'English';

  return languageMode === 'auto' ? `${autoLabel} · ${activeLabel}` : activeLabel;
};
