import type { UILocaleResourceInput, UILocaleResources } from './getUILocaleAndResources.utils';
import {
  mergeUILocaleResources,
  normalizeUILocaleResources,
  resolveUILocale,
} from './getUILocaleAndResources.utils';

type UILocaleModule = { default: UILocaleResourceInput };
type UILocaleLoaderMap = Record<string, () => Promise<UILocaleModule>>;

const uiLocaleLoaders = import.meta.glob('/locales/*/ui.json') as UILocaleLoaderMap;

const loadBusinessResources = async (locale: string): Promise<UILocaleResources | null> => {
  const key = `/locales/${locale}/ui.json`;
  const loader = uiLocaleLoaders[key];
  if (!loader) return null;
  try {
    const mod = await loader();
    const resources = mod.default;

    return resources ? normalizeUILocaleResources(resources) : null;
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
  const { normalizedLocale, uiLocale } = resolveUILocale(locale);

  const resources =
    mergeUILocaleResources(
      await loadLobeUIBuiltinResources(normalizedLocale),
      await loadBusinessResources(normalizedLocale),
    ) ??
    mergeUILocaleResources(
      await loadLobeUIBuiltinResources('en-US'),
      await loadBusinessResources('en-US'),
    );

  if (!resources)
    throw new Error(
      `Failed to load UI resources (business + @lobehub/ui builtin) for locale=${normalizedLocale}`,
    );

  return {
    locale: uiLocale,
    resources,
  };
};
