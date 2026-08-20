import type {
  LoadI18nNamespaceModuleParams,
  LoadI18nNamespaceModuleWithFallbackParams,
} from './loadI18nNamespaceModule';
import { type I18nNamespaceModule, mergeBusinessI18nNamespace } from './mergeBusinessI18nNamespace';

type NamespaceModule = I18nNamespaceModule;
type NamespaceLoaderMap = Record<string, () => Promise<NamespaceModule>>;

const defaultLoaders = import.meta.glob([
  '/packages/locales/src/default/*.ts',
  '!/packages/locales/src/default/*.vite.ts',
  '!/packages/locales/src/default/index.ts',
]) as NamespaceLoaderMap;
const localeLoaders = import.meta.glob('/locales/*/*.json') as NamespaceLoaderMap;

const getDefaultKey = (ns: string) => `/packages/locales/src/default/${ns}.ts`;
const getLocaleKey = (lng: string, ns: string) => `/locales/${lng}/${ns}.json`;

export const loadI18nNamespaceModule = async (
  params: LoadI18nNamespaceModuleParams,
): Promise<NamespaceModule> => {
  const { defaultLang, normalizeLocale, lng, ns } = params;

  if (lng === defaultLang) {
    const load = defaultLoaders[getDefaultKey(ns)];
    if (!load) throw new Error(`Missing default namespace: ${ns}`);
    return mergeBusinessI18nNamespace(await load(), params);
  }

  const normalizedLng = normalizeLocale(lng);
  const loadLocale = localeLoaders[getLocaleKey(normalizedLng, ns)];
  if (loadLocale) return mergeBusinessI18nNamespace(await loadLocale(), params);

  const loadDefault = defaultLoaders[getDefaultKey(ns)];
  if (!loadDefault) throw new Error(`Missing default namespace: ${ns}`);
  return mergeBusinessI18nNamespace(await loadDefault(), params);
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
    return mergeBusinessI18nNamespace(await loadDefault(), rest);
  }
};
