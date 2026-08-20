export interface LoadBusinessI18nNamespaceParams {
  lng: string;
  normalizeLocale: (locale?: string) => string;
  ns: string;
}

/** Load optional namespace entries supplied by a business implementation. */
export const loadBusinessI18nNamespace = async (
  _params: LoadBusinessI18nNamespaceParams,
): Promise<Record<string, unknown>> => ({});
