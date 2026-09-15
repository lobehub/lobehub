import i18next from 'i18next';
import resourcesToBackend from 'i18next-resources-to-backend';
import { initReactI18next } from 'react-i18next';

import { DEFAULT_LANG } from '@/const/locale';
import { normalizeLocale } from '@/locales/resources';
import { unwrapESMModule } from '@/utils/esm/unwrapESMModule';
import { loadI18nNamespaceModule } from '@/utils/i18n/loadI18nNamespaceModule';

export type ShareResources = Record<string, Record<string, string>>;

// `error` is preloaded rather than fetched on demand: the boundary that needs
// it renders when something already failed, and a chunk-load failure is exactly
// the case where the client can never fetch the dictionary to correct itself.
export const shareNamespaces = ['chat', 'error', 'pageShare'] as const;

export const loadShareNamespace = async (lng: string, ns: string) => {
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

export const loadShareResources = async (lang?: string) => {
  const locale = normalizeLocale(lang);
  const entries = await Promise.all(
    shareNamespaces.map(async (ns) => [ns, await loadShareNamespace(locale, ns)] as const),
  );

  return Object.fromEntries(entries) as ShareResources;
};

export const createShareI18n = (lang?: string, bundledResources?: ShareResources) => {
  const locale = normalizeLocale(lang);
  const resources = bundledResources ? { [locale]: bundledResources } : undefined;

  const instance = i18next
    .createInstance()
    .use(initReactI18next)
    .use(resourcesToBackend(loadShareNamespace));

  return {
    init: (params: { initAsync?: boolean } = {}) =>
      instance.init({
        defaultNS: 'chat',
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
