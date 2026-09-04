import i18next from 'i18next';
import resourcesToBackend from 'i18next-resources-to-backend';
import { initReactI18next } from 'react-i18next';

import { DEFAULT_LANG } from '@/const/locale';
import { normalizeLocale } from '@/locales/resources';

import type { AuthResourceBundle } from './i18nScript';
import { AUTH_NAMESPACES } from './i18nScript';
import { loadAuthNamespace } from './loadAuthNamespace';

interface CreateAuthI18nOptions {
  locale: string;
  resources: AuthResourceBundle;
}

// The served locale is bundled into the document and initialised synchronously,
// so prerender and hydration render identical markup; anything the language
// switcher reaches afterwards arrives through the on-demand backend.
export const createAuthI18n = ({ locale, resources }: CreateAuthI18nOptions) => {
  const lng = normalizeLocale(locale);
  const instance = i18next
    .createInstance()
    .use(initReactI18next)
    .use(resourcesToBackend(loadAuthNamespace));

  // With `ns: []` and the served language bundled, i18next treats every
  // namespace as loaded and never asks the backend — switching has to fetch.
  instance.on('languageChanged', (next) => {
    if (normalizeLocale(next) === lng) return;
    void instance.reloadResources([normalizeLocale(next)], [...AUTH_NAMESPACES]);
  });

  return {
    init: () =>
      instance.init({
        defaultNS: ['auth', 'common', 'error'],
        fallbackLng: DEFAULT_LANG,
        initAsync: false,
        interpolation: { escapeValue: false },
        keySeparator: false,
        lng,
        ns: [],
        partialBundledLanguages: true,
        react: {
          bindI18nStore: 'added',
          useSuspense: false,
        },
        resources: { [lng]: resources },
        showSupportNotice: false,
      }),
    instance,
  };
};
