type NamespaceModule = { default: Record<string, unknown> };
type NamespaceLoaderMap = Record<string, () => Promise<NamespaceModule>>;

// The offline report is one file: every namespace it renders is bundled, in
// the default language plus Simplified Chinese. Other locales fall back to
// English rather than adding a megabyte per language to every report. The
// i18n guard in vite.config.report.mts fails the build when the page graph
// asks for a namespace missing here; keep both lists in sync.
const defaultLoaders = import.meta.glob([
  '../../../../../packages/locales/src/default/chat.ts',
  '../../../../../packages/locales/src/default/common.ts',
  '../../../../../packages/locales/src/default/components.ts',
  '../../../../../packages/locales/src/default/error.ts',
  '../../../../../packages/locales/src/default/file.ts',
  '../../../../../packages/locales/src/default/verify.ts',
]) as NamespaceLoaderMap;
const localeLoaders = import.meta.glob([
  '../../../../../locales/zh-CN/chat.json',
  '../../../../../locales/zh-CN/common.json',
  '../../../../../locales/zh-CN/components.json',
  '../../../../../locales/zh-CN/error.json',
  '../../../../../locales/zh-CN/file.json',
  '../../../../../locales/zh-CN/verify.json',
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

  const loadDefault = defaultLoaders[`../../../../../packages/locales/src/default/${ns}.ts`];
  // An unbundled namespace renders its keys instead of failing the page.
  if (!loadDefault) return { default: {} };

  if (lng !== defaultLang) {
    const loadLocale = localeLoaders[`../../../../../locales/${normalizeLocale(lng)}/${ns}.json`];
    if (loadLocale) return loadLocale();
  }

  return loadDefault();
};

export const loadI18nNamespaceModuleWithFallback = loadI18nNamespaceModule;
