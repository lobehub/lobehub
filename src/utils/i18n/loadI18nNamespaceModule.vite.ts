import type {
  LoadI18nNamespaceModuleParams,
  LoadI18nNamespaceModuleWithFallbackParams,
} from './loadI18nNamespaceModule';

type NamespaceModule = { default: Record<string, unknown> };
type NamespaceLoaderMap = Record<string, () => Promise<NamespaceModule>>;

// Use import.meta.glob so Vite can statically analyze and avoid CJS/dynamic import issues
const defaultLoaders = import.meta.glob('/packages/locales/src/default/*.ts') as NamespaceLoaderMap;
const localeLoaders = import.meta.glob('/locales/*/*.json') as NamespaceLoaderMap;

const getDefaultKey = (ns: string) => `/packages/locales/src/default/${ns}.ts`;
const getLocaleKey = (lng: string, ns: string) => `/locales/${lng}/${ns}.json`;

export const loadI18nNamespaceModule = async (
  params: LoadI18nNamespaceModuleParams,
): Promise<NamespaceModule> => {
  const { defaultLang, normalizeLocale, lng, ns } = params;

  if (lng === defaultLang) {
    const key = getDefaultKey(ns);
    const load = defaultLoaders[key];
    if (!load) throw new Error(`Missing default namespace: ${ns}`);
    return load();
  }

  const normalizedLng = normalizeLocale(lng);
  const localeKey = getLocaleKey(normalizedLng, ns);
  const loadLocale = localeLoaders[localeKey];
  if (loadLocale) {
    return loadLocale();
  }

  const loadDefault = defaultLoaders[getDefaultKey(ns)];
  if (!loadDefault) throw new Error(`Missing default namespace: ${ns}`);
  return loadDefault();
};

export type {
  LoadI18nNamespaceModuleParams,
  LoadI18nNamespaceModuleWithFallbackParams,
} from './loadI18nNamespaceModule';

export const loadI18nNamespaceModuleWithFallback = async (
  params: LoadI18nNamespaceModuleWithFallbackParams,
): Promise<NamespaceModule> => {
  const { onFallback, ...rest } = params;
  try {
    return await loadI18nNamespaceModule(rest);
  } catch (error) {
    onFallback?.({ error, lng: rest.lng, ns: rest.ns });
    const loadDefault = defaultLoaders[getDefaultKey(rest.ns)];
    if (!loadDefault) throw error;
    return loadDefault();
  }
};
