export interface LoadI18nNamespaceModuleParams {
  defaultLang: string;
  lng: string;
  normalizeLocale: (locale?: string) => string;
  ns: string;
}

export const loadI18nNamespaceModule = async (params: LoadI18nNamespaceModuleParams) => {
  const { defaultLang, normalizeLocale, lng, ns } = params;

  if (lng === defaultLang) return import(`@/locales/default/${ns}`);

  return import(`@/../locales/${normalizeLocale(lng)}/${ns}.json`);
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
    return import(`@/locales/default/${rest.ns}`);
  }
};
