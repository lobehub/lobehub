import * as businessLocales from '@/business/locales';

import type { LoadI18nNamespaceModuleParams } from './loadI18nNamespaceModule';

export interface I18nNamespaceModule {
  default: Record<string, unknown>;
}

/**
 * Namespace import + optional call rather than a named import: the share
 * overlay build may combine this repo with a business overlay revision that
 * predates the `loadBusinessI18nNamespace` slot, and a named import of the
 * missing export is a hard Rollup MISSING_EXPORT build failure. Treating the
 * slot as optional keeps the two repos independently mergeable.
 */
const loadBusinessI18nNamespace = (
  businessLocales as {
    loadBusinessI18nNamespace?: (
      params: LoadI18nNamespaceModuleParams,
    ) => Promise<Record<string, unknown>>;
  }
).loadBusinessI18nNamespace;

export const mergeBusinessI18nNamespace = async (
  module: I18nNamespaceModule,
  params: LoadI18nNamespaceModuleParams,
): Promise<I18nNamespaceModule> => ({
  default: {
    ...module.default,
    ...(await loadBusinessI18nNamespace?.(params)),
  },
});
