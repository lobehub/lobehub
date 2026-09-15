import i18next from 'i18next';
import resourcesToBackend from 'i18next-resources-to-backend';
import { initReactI18next } from 'react-i18next';

import { DEFAULT_LANG } from '@/const/locale';
import { normalizeLocale } from '@/locales/resources';
import { unwrapESMModule } from '@/utils/esm/unwrapESMModule';
import { loadI18nNamespaceModule } from '@/utils/i18n/loadI18nNamespaceModule';

export const workbenchNamespaces = ['verify'] as const;

export const loadWorkbenchNamespace = async (lng: string, ns: string) => {
  const locale = normalizeLocale(lng);

  return unwrapESMModule(
    await loadI18nNamespaceModule({
      defaultLang: DEFAULT_LANG,
      lng: locale,
      normalizeLocale,
      ns,
    }),
  );
};

export const loadWorkbenchResources = async (lang?: string) => {
  const locale = normalizeLocale(lang);
  const entries = await Promise.all(
    workbenchNamespaces.map(async (ns) => [ns, await loadWorkbenchNamespace(locale, ns)] as const),
  );

  return Object.fromEntries(entries) as Record<string, unknown>;
};

export const createWorkbenchI18n = (lang?: string, bundledResources?: Record<string, unknown>) => {
  const locale = normalizeLocale(lang);
  const resources = bundledResources ? { [locale]: bundledResources } : undefined;

  const instance = i18next
    .createInstance()
    .use(initReactI18next)
    .use(resourcesToBackend(loadWorkbenchNamespace));

  return {
    init: (params: { initAsync?: boolean } = {}) =>
      instance.init({
        defaultNS: 'verify',
        fallbackLng: DEFAULT_LANG,
        initAsync: params.initAsync ?? true,
        interpolation: { escapeValue: false },
        keySeparator: false,
        lng: locale,
        ns: [],
        partialBundledLanguages: true,
        react: {
          bindI18nStore: 'added',
          useSuspense: false,
        },
        resources,
        showSupportNotice: false,
      }),
    instance,
  };
};
