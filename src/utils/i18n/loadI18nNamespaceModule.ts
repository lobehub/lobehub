import { loadBusinessI18nNamespace } from '@/business/locales';

export interface LoadI18nNamespaceModuleParams {
  defaultLang: string;
  lng: string;
  normalizeLocale: (locale?: string) => string;
  ns: string;
}

export interface I18nNamespaceModule {
  default: Record<string, unknown>;
}

export const mergeBusinessI18nNamespace = async (
  module: I18nNamespaceModule,
  params: LoadI18nNamespaceModuleParams,
): Promise<I18nNamespaceModule> => ({
  default: {
    ...module.default,
    ...(await loadBusinessI18nNamespace(params)),
  },
});

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
