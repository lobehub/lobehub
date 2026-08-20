import { loadBusinessI18nNamespace } from '@/business/locales';

import type { LoadI18nNamespaceModuleParams } from './loadI18nNamespaceModule';

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
