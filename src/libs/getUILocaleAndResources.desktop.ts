import { en, zhCn } from '@lobehub/ui/es/i18n/resources/index';

import type { UILocaleResourceInput, UILocaleResources } from './getUILocaleAndResources.utils';
import {
  mergeUILocaleResources,
  normalizeUILocaleResources,
  resolveUILocale,
} from './getUILocaleAndResources.utils';

// eager: true — UI locale fully inlined at build time
const uiLocaleModules = import.meta.glob<{ default: UILocaleResourceInput }>('/locales/*/ui.json', {
  eager: true,
});

const loadBusinessResources = (locale: string): UILocaleResources | null => {
  const key = `/locales/${locale}/ui.json`;
  const mod = uiLocaleModules[key];
  const resources = mod?.default as UILocaleResourceInput | null | undefined;

  return resources ? normalizeUILocaleResources(resources) : null;
};

const loadLobeUIBuiltinResources = (locale: string): UILocaleResources | null => {
  if (locale.startsWith('zh')) return zhCn as UILocaleResources;
  return en as UILocaleResources;
};

export const getUILocaleAndResources = async (
  locale: string | 'auto',
): Promise<{ locale: string; resources: UILocaleResources }> => {
  const { normalizedLocale, uiLocale } = resolveUILocale(locale);

  const resources =
    mergeUILocaleResources(
      loadLobeUIBuiltinResources(normalizedLocale),
      loadBusinessResources(normalizedLocale),
    ) ??
    mergeUILocaleResources(loadLobeUIBuiltinResources('en-US'), loadBusinessResources('en-US'));

  if (!resources)
    throw new Error(
      `Failed to load UI resources (business + @lobehub/ui builtin) for locale=${normalizedLocale}`,
    );

  return {
    locale: uiLocale,
    resources,
  };
};
