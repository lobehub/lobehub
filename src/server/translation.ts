import { DEFAULT_LANG } from '@/const/locale';
import { type Locales, type NS } from '@/locales/resources';
import { normalizeLocale } from '@/locales/resources';
import { unwrapESMModule } from '@/utils/esm/unwrapESMModule';

import { loadI18nNamespaceModuleWithFallback } from '../utils/i18n/loadI18nNamespaceModule';

export const getLocale = async (hl?: string): Promise<Locales> => {
  if (hl) return normalizeLocale(hl) as Locales;
  return DEFAULT_LANG as Locales;
};

export const translation = async (ns: NS = 'common', hl: string) => {
  let i18ns: Record<string, string> = {};
  const lng = await getLocale(hl);

  const loadTranslations = async () => {
    // Keep the same fallback rule as `src/locales/create.ts`:
    // - DEFAULT_LANG loads from `src/locales/default`
    // - other languages load from `locales/<lng>/*.json`, and fallback to default if missing
    return loadI18nNamespaceModuleWithFallback({
      defaultLang: DEFAULT_LANG,
      lng,
      normalizeLocale,
      ns,
      onFallback: () => {
        console.warn(`Translation file for ${lng}/${ns} not found, falling back to default`);
      },
    });
  };

  try {
    i18ns = unwrapESMModule(await loadTranslations());
  } catch (e) {
    console.error('Error while reading translation file', e);
  }

  return {
    locale: lng,
    t: (key: string, options: { [key: string]: string } = {}) => {
      if (!i18ns) return key;
      let content = i18ns[key];
      if (!content) return key;
      if (options) {
        Object.entries(options).forEach(([k, value]) => {
          content = content.replace(`{{${k}}}`, value);
        });
      }
      return content;
    },
  };
};
