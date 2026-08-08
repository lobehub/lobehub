import { DEFAULT_LANG } from '@/const/locale';
import { type Locales, type NS } from '@/locales/resources';
import { normalizeLocale } from '@/locales/resources';
import { unwrapESMModule } from '@/utils/esm/unwrapESMModule';
import { loadI18nNamespaceModuleWithFallback } from '@/utils/i18n/loadI18nNamespaceModule';

export const getLocale = async (hl?: string): Promise<Locales> => {
  if (hl) return normalizeLocale(hl) as Locales;
  return DEFAULT_LANG as Locales;
};

export const translation = async (ns: NS = 'common', hl: string) => {
  let defaultI18ns: Record<string, string> = {};
  let i18ns: Record<string, string> = {};
  const lng = await getLocale(hl);

  const loadTranslations = async (locale: string) => {
    return loadI18nNamespaceModuleWithFallback({
      defaultLang: DEFAULT_LANG,
      lng: locale,
      normalizeLocale,
      ns,
      onFallback: () => {
        console.warn(`Translation file for ${locale}/${ns} not found, falling back to default`);
      },
    });
  };

  try {
    const defaultTranslationsPromise = loadTranslations(DEFAULT_LANG);
    const localeTranslationsPromise =
      lng === DEFAULT_LANG ? defaultTranslationsPromise : loadTranslations(lng);
    const [defaultTranslations, localeTranslations] = await Promise.all([
      defaultTranslationsPromise,
      localeTranslationsPromise,
    ]);

    defaultI18ns = unwrapESMModule(defaultTranslations);
    i18ns = unwrapESMModule(localeTranslations);
  } catch (e) {
    console.error('Error while reading translation file', e);
  }

  return {
    locale: lng,
    t: (key: string, options: { [key: string]: string } = {}) => {
      if (!i18ns) return key;
      let content = i18ns[key] || defaultI18ns[key];
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
