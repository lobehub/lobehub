type NamespaceModule = { default: Record<string, unknown> };
type NamespaceLoaderMap = Record<string, () => Promise<NamespaceModule>>;

// SSR renders only the namespaces listed in `shareNamespaces`; the generic
// loader would register every locale x namespace pair as a worker chunk
// (~1000 files). The client build keeps the generic loader — its graph
// legitimately spans the whole conversation stack.
const defaultLoaders = import.meta.glob([
  '../../../../packages/locales/src/default/chat.ts',
  '../../../../packages/locales/src/default/error.ts',
  '../../../../packages/locales/src/default/pageShare.ts',
]) as NamespaceLoaderMap;
const localeLoaders = import.meta.glob([
  '../../../../locales/*/chat.json',
  '../../../../locales/*/error.json',
  '../../../../locales/*/pageShare.json',
]) as NamespaceLoaderMap;

export interface LoadI18nNamespaceModuleParams {
  defaultLang: string;
  lng: string;
  normalizeLocale: (locale?: string) => string;
  ns: string;
}

export const loadI18nNamespaceModule = async (
  params: LoadI18nNamespaceModuleParams,
): Promise<NamespaceModule> => {
  const { defaultLang, normalizeLocale, lng, ns } = params;

  const loadDefault = defaultLoaders[`../../../../packages/locales/src/default/${ns}.ts`];
  if (!loadDefault) throw new Error(`Namespace not bundled for SSR: ${ns}`);

  if (lng !== defaultLang) {
    const loadLocale = localeLoaders[`../../../../locales/${normalizeLocale(lng)}/${ns}.json`];
    if (loadLocale) return loadLocale();
  }

  return loadDefault();
};

export const loadI18nNamespaceModuleWithFallback = loadI18nNamespaceModule;
