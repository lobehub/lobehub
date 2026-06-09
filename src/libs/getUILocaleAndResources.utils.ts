import { DEFAULT_LANG } from '@/const/locale';
import { normalizeLocale } from '@/locales/resources';

export type UILocaleResourceBundle = Record<string, string>;
export type UILocaleResources = Record<string, UILocaleResourceBundle>;
export type UILocaleResourceInput = UILocaleResourceBundle | UILocaleResources;

const getDocumentLocale = () => {
  if (typeof document === 'undefined') return;

  return document.documentElement.lang || undefined;
};

const getNavigatorLocale = () => {
  if (typeof navigator === 'undefined') return;

  return navigator.language || undefined;
};

const getUILocale = (locale: string): string => {
  if (locale.startsWith('zh')) return 'zh-CN';
  if (locale.startsWith('en')) return 'en-US';
  return locale;
};

const isFlatUILocaleResources = (
  resources: UILocaleResourceInput,
): resources is UILocaleResourceBundle =>
  Object.values(resources).every((value) => typeof value === 'string');

const flattenUILocaleResources = (resources: UILocaleResourceInput): UILocaleResourceBundle =>
  isFlatUILocaleResources(resources) ? resources : Object.assign({}, ...Object.values(resources));

export const normalizeUILocaleResources = (
  resources: UILocaleResourceInput,
): UILocaleResources => ({
  app: flattenUILocaleResources(resources),
});

export const mergeUILocaleResources = (
  ...resourcesList: (UILocaleResourceInput | null)[]
): UILocaleResources | null => {
  const mergedResources = Object.assign(
    {},
    ...resourcesList.filter(Boolean).map((resources) => flattenUILocaleResources(resources!)),
  );

  return Object.keys(mergedResources).length > 0 ? { app: mergedResources } : null;
};

export const resolveUILocale = (locale: string | 'auto') => {
  const effectiveLocale =
    locale === 'auto' ? (getDocumentLocale() ?? getNavigatorLocale() ?? DEFAULT_LANG) : locale;
  const normalizedLocale = normalizeLocale(effectiveLocale);

  return {
    normalizedLocale,
    uiLocale: getUILocale(normalizedLocale),
  };
};
