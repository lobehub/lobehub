import { en, zhCn } from '@lobehub/ui/es/i18n/resources/index';

import { normalizeLocale } from '@/locales/resources';

type UILocaleResources = Record<string, Record<string, string>>;

// eager: true — UI locale fully inlined at build time
const uiLocaleModules = import.meta.glob<{ default: UILocaleResources }>('/locales/*/ui.json', {
  eager: true,
});

const getUILocale = (locale: string): string => {
  if (locale.startsWith('zh')) return 'zh-CN';
  if (locale.startsWith('en')) return 'en-US';
  return locale;
};

const loadBusinessResources = (locale: string): UILocaleResources | null => {
  const key = `/locales/${locale}/ui.json`;
  const mod = uiLocaleModules[key];
  return mod ? (mod.default as UILocaleResources) : null;
};

const loadLobeUIBuiltinResources = (locale: string): UILocaleResources | null => {
  if (locale.startsWith('zh')) return zhCn as UILocaleResources;
  return en as UILocaleResources;
};

export const getUILocaleAndResources = async (
  locale: string | 'auto',
): Promise<{ locale: string; resources: UILocaleResources }> => {
  const effectiveLocale = locale === 'auto' ? 'en-US' : locale;
  const normalizedLocale = normalizeLocale(effectiveLocale);
  const uiLocale = getUILocale(normalizedLocale);

  const resources =
    loadBusinessResources(normalizedLocale) ??
    loadLobeUIBuiltinResources(normalizedLocale) ??
    loadBusinessResources('en-US') ??
    loadLobeUIBuiltinResources('en-US');

  if (!resources)
    throw new Error(
      `Failed to load UI resources (business + @lobehub/ui builtin) for locale=${normalizedLocale}`,
    );

  return {
    locale: uiLocale,
    resources,
  };
};
