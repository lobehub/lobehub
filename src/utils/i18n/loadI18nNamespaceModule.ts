import { mergeBusinessI18nNamespace } from './mergeBusinessI18nNamespace';

export type { I18nNamespaceModule } from './mergeBusinessI18nNamespace';
export { mergeBusinessI18nNamespace } from './mergeBusinessI18nNamespace';

export interface LoadI18nNamespaceModuleParams {
  defaultLang: string;
  lng: string;
  normalizeLocale: (locale?: string) => string;
  ns: string;
}

export const loadI18nNamespaceModule = async (params: LoadI18nNamespaceModuleParams) => {
  const { defaultLang, normalizeLocale, lng, ns } = params;

  if (lng === defaultLang) {
    return mergeBusinessI18nNamespace(await import(`@/locales/default/${ns}`), params);
  }

  try {
    return mergeBusinessI18nNamespace(
      await import(`@/../locales/${normalizeLocale(lng)}/${ns}.json`),
      params,
    );
  } catch {
    return mergeBusinessI18nNamespace(await import(`@/locales/default/${ns}`), params);
  }
};

export interface LoadI18nNamespaceModuleWithFallbackParams extends LoadI18nNamespaceModuleParams {
  onFallback?: (params: { error: unknown; lng: string; ns: string }) => void;
}

export const loadI18nNamespaceModuleWithFallback = async (
  params: LoadI18nNamespaceModuleWithFallbackParams,
) => {
  const { onFallback, ...rest } = params;

  try {
    return await loadI18nNamespaceModule(rest);
  } catch (error) {
    onFallback?.({ error, lng: rest.lng, ns: rest.ns });
    return mergeBusinessI18nNamespace(await import(`@/locales/default/${rest.ns}`), rest);
  }
};
