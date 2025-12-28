import { DEFAULT_LANG } from '@/const/locale';
import { type Locales, type NS, normalizeLocale } from '@/locales/resources';

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
    if (lng === DEFAULT_LANG) {
      return import(`@/locales/default/${ns}`).then((mod) => mod.default);
    }

    // Try locale-specific JSON file, fallback to default if it fails
    try {
      return await import(`@/../locales/${normalizeLocale(lng)}/${ns}.json`);
    } catch {
      console.warn(`Translation file for ${lng}/${ns} not found, falling back to default`);
      return import(`@/locales/default/${ns}`);
    }
  };

  try {
    i18ns = await loadTranslations();
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
