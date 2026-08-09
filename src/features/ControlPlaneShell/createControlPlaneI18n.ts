import i18next from 'i18next';
import resourcesToBackend from 'i18next-resources-to-backend';
import { initReactI18next } from 'react-i18next';

import faAico from '@/../locales/fa-IR/aico.json';
import faCommon from '@/../locales/fa-IR/common.json';
import faError from '@/../locales/fa-IR/error.json';
import { DEFAULT_LANG } from '@/const/locale';
import defaultAico from '@/locales/default/aico';
import defaultCommon from '@/locales/default/common';
import defaultError from '@/locales/default/error';
import { normalizeLocale } from '@/locales/resources';
import { unwrapESMModule } from '@/utils/esm/unwrapESMModule';
import { loadI18nNamespaceModule } from '@/utils/i18n/loadI18nNamespaceModule';

const mergeNamespace = (
  fallbackResources: Record<string, unknown>,
  localeResources: Record<string, unknown>,
) => ({
  ...fallbackResources,
  ...localeResources,
});

const defaultResources = {
  aico: mergeNamespace(defaultAico as Record<string, unknown>, faAico as Record<string, unknown>),
  common: mergeNamespace(defaultCommon, faCommon),
  error: mergeNamespace(defaultError, faError),
};

const loadControlPlaneNamespace = async (lng: string, ns: string) => {
  const locale = normalizeLocale(lng);

  if (locale === DEFAULT_LANG && ns in defaultResources) {
    return defaultResources[ns as keyof typeof defaultResources];
  }

  return unwrapESMModule(
    await loadI18nNamespaceModule({
      defaultLang: DEFAULT_LANG,
      lng: locale,
      normalizeLocale,
      ns,
    }),
  );
};

export const createControlPlaneI18n = (lang?: string) => {
  const instance = i18next
    .createInstance()
    .use(initReactI18next)
    .use(resourcesToBackend(loadControlPlaneNamespace));

  return {
    init: (params: { initAsync?: boolean } = {}) =>
      instance.init({
        defaultNS: ['aico', 'common', 'error'],
        fallbackLng: DEFAULT_LANG,
        initAsync: params.initAsync ?? true,
        interpolation: { escapeValue: false },
        keySeparator: false,
        lng: normalizeLocale(lang),
        ns: ['aico', 'common', 'error'],
        partialBundledLanguages: true,
        react: {
          bindI18nStore: 'added',
          useSuspense: false,
        },
        resources: { [DEFAULT_LANG]: defaultResources },
        showSupportNotice: false,
      }),
    instance,
  };
};
