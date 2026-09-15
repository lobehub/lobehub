type NamespaceModule = { default: Record<string, unknown> };
type NamespaceLoaderMap = Record<string, () => Promise<NamespaceModule>>;

// SSR only ever renders the `verify` namespace (see workbenchNamespaces); the
// generic loader would register every locale x namespace pair as a worker
// chunk (~1000 files). The client build uses its own allowlist stub
// (loadI18nNamespaceModule.client.ts).
const defaultLoaders = import.meta.glob(
  '../../../../packages/locales/src/default/verify.ts',
) as NamespaceLoaderMap;
const localeLoaders = import.meta.glob('../../../../locales/*/verify.json') as NamespaceLoaderMap;

const DEFAULT_KEY = '../../../../packages/locales/src/default/verify.ts';

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

  if (ns !== 'verify') throw new Error(`Namespace not bundled for SSR: ${ns}`);

  if (lng !== defaultLang) {
    const loadLocale = localeLoaders[`../../../../locales/${normalizeLocale(lng)}/verify.json`];
    if (loadLocale) return loadLocale();
  }

  return defaultLoaders[DEFAULT_KEY]!();
};

export const loadI18nNamespaceModuleWithFallback = loadI18nNamespaceModule;
