import { normalizeLocale } from '@/locales/resources';

type UILocaleResources = Record<string, Record<string, string>>;

const uiLocaleLoaders = import.meta.glob<{ default: UILocaleResources }>('/locales/*/ui.json');

const getUILocale = (locale: string): string => {
  if (locale.startsWith('zh')) return 'zh-CN';
  if (locale.startsWith('en')) return 'en-US';
  return locale;
};

const loadBusinessResources = async (locale: string): Promise<UILocaleResources | null> => {
  const key = `/locales/${locale}/ui.json`;
  const loader = uiLocaleLoaders[key];
  if (!loader) return null;
  try {
    const mod = await loader();
    return mod.default as UILocaleResources;
  } catch {
    return null;
  }
};

const loadLobeUIBuiltinResources = async (locale: string): Promise<UILocaleResources | null> => {
  try {
    const { en, zhCn } = await import('@lobehub/ui/es/i18n/resources/index');

    if (locale.startsWith('zh')) return zhCn as UILocaleResources;
    return en as UILocaleResources;
  } catch {
    return null;
  }
};

export const getUILocaleAndResources = async (
  locale: string | 'auto',
): Promise<{ locale: string; resources: UILocaleResources }> => {
  const effectiveLocale = locale === 'auto' ? 'en-US' : locale;
  const normalizedLocale = normalizeLocale(effectiveLocale);
  const uiLocale = getUILocale(normalizedLocale);

  const resources =
    (await loadBusinessResources(normalizedLocale)) ??
    (await loadLobeUIBuiltinResources(normalizedLocale)) ??
    (await loadBusinessResources('en-US')) ??
    (await loadLobeUIBuiltinResources('en-US'));

  if (!resources)
    throw new Error(
      `Failed to load UI resources (business + @lobehub/ui builtin) for locale=${normalizedLocale}`,
    );

  return {
    locale: uiLocale,
    resources,
  };
};
