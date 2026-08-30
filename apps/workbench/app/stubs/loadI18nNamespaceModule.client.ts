type NamespaceModule = { default: Record<string, unknown> };
type NamespaceLoaderMap = Record<string, () => Promise<NamespaceModule>>;

// The workbench client graph only requests these namespaces (verify UI plus the
// builtin-tool render stack in the gated detail view). The generic loader would
// register every locale x namespace pair (~1000 chunks). The i18n guard in
// vite.config.rr.mts scans the graph and fails the build when a namespace is
// missing here; keep both glob lists in sync when adding one.
const defaultLoaders = import.meta.glob([
  '../../../../packages/locales/src/default/chat.ts',
  '../../../../packages/locales/src/default/common.ts',
  '../../../../packages/locales/src/default/error.ts',
  '../../../../packages/locales/src/default/plugin.ts',
  '../../../../packages/locales/src/default/tool.ts',
  '../../../../packages/locales/src/default/verify.ts',
]) as NamespaceLoaderMap;
const localeLoaders = import.meta.glob([
  '../../../../locales/*/chat.json',
  '../../../../locales/*/common.json',
  '../../../../locales/*/error.json',
  '../../../../locales/*/plugin.json',
  '../../../../locales/*/tool.json',
  '../../../../locales/*/verify.json',
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
  if (!loadDefault)
    throw new Error(
      `Namespace not bundled for workbench client: ${ns} (add it to app/stubs/loadI18nNamespaceModule.client.ts)`,
    );

  if (lng !== defaultLang) {
    const loadLocale = localeLoaders[`../../../../locales/${normalizeLocale(lng)}/${ns}.json`];
    if (loadLocale) return loadLocale();
  }

  return loadDefault();
};

export const loadI18nNamespaceModuleWithFallback = loadI18nNamespaceModule;
