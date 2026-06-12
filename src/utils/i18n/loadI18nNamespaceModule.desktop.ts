import type {
  LoadI18nNamespaceModuleParams,
  LoadI18nNamespaceModuleWithFallbackParams,
} from './loadI18nNamespaceModule';

// eager: true — all locale JSON inlined at build time, synchronous access at runtime
const defaultModules = import.meta.glob<{ default: Record<string, unknown> }>(
  '/packages/locales/src/default/*.ts',
  { eager: true },
);
const localeModules = import.meta.glob<{ default: Record<string, unknown> }>('/locales/*/*.json', {
  eager: true,
});

const getDefaultKey = (ns: string) => `/packages/locales/src/default/${ns}.ts`;
const getLocaleKey = (lng: string, ns: string) => `/locales/${lng}/${ns}.json`;

export const loadI18nNamespaceModule = async (
  params: LoadI18nNamespaceModuleParams,
): Promise<{ default: Record<string, unknown> }> => {
  const { defaultLang, normalizeLocale, lng, ns } = params;

  if (lng === defaultLang) {
    const mod = defaultModules[getDefaultKey(ns)];
    if (!mod) throw new Error(`Missing default namespace: ${ns}`);
    return mod;
  }

  const normalizedLng = normalizeLocale(lng);
  const localeMod = localeModules[getLocaleKey(normalizedLng, ns)];
  if (localeMod) return localeMod;

  const defaultMod = defaultModules[getDefaultKey(ns)];
  if (!defaultMod) throw new Error(`Missing default namespace: ${ns}`);
  return defaultMod;
};

export type {
  LoadI18nNamespaceModuleParams,
  LoadI18nNamespaceModuleWithFallbackParams,
} from './loadI18nNamespaceModule';

export const loadI18nNamespaceModuleWithFallback = async (
  params: LoadI18nNamespaceModuleWithFallbackParams,
): Promise<{ default: Record<string, unknown> }> => {
  const { onFallback, ...rest } = params;
  try {
    return await loadI18nNamespaceModule(rest);
  } catch (error) {
    onFallback?.({ error, lng: rest.lng, ns: rest.ns });
    const defaultMod = defaultModules[getDefaultKey(rest.ns)];
    if (!defaultMod) throw error;
    return defaultMod;
  }
};
