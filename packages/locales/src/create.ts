import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import resourcesToBackend from 'i18next-resources-to-backend';
import { initReactI18next } from 'react-i18next';
import { isRtlLang } from 'rtl-detect';

import chat from '@/../locales/en-US/chat.json';
import common from '@/../locales/en-US/common.json';
import error from '@/../locales/en-US/error.json';
import home from '@/../locales/en-US/home.json';
import { DEFAULT_LANG } from '@/const/locale';
import { getDebugConfig } from '@/envs/debug';
// Sync load bundled fallback resources without Suspense on first render.
// Use src/locales/default/*.ts as the runtime fallback source, then overlay
// locales/en-US/*.json so dev-preview JSON can still customize English copy
// without dropping newly added default keys.
import defaultChat from '@/locales/default/chat';
import defaultCommon from '@/locales/default/common';
import defaultError from '@/locales/default/error';
import defaultHome from '@/locales/default/home';
import { normalizeLocale } from '@/locales/resources';
import { isOnServerSide } from '@/utils/env';
import { unwrapESMModule } from '@/utils/esm/unwrapESMModule';
import { loadI18nNamespaceModule } from '@/utils/i18n/loadI18nNamespaceModule';

const mergeNamespace = (
  fallbackResources: Record<string, unknown>,
  localeResources: Record<string, unknown>,
) => ({
  ...fallbackResources,
  ...localeResources,
});

const createBundledResources = () => ({
  chat: mergeNamespace(defaultChat, chat),
  common: mergeNamespace(defaultCommon, common),
  error: mergeNamespace(defaultError, error),
  home: mergeNamespace(defaultHome, home),
});

const defaultResources = createBundledResources();
const bundledNamespaces = Object.keys(defaultResources);

const { I18N_DEBUG, I18N_DEBUG_BROWSER, I18N_DEBUG_SERVER } = getDebugConfig();
const debugMode = (I18N_DEBUG ?? isOnServerSide) ? I18N_DEBUG_SERVER : I18N_DEBUG_BROWSER;

export const createI18nNext = (lang?: string) => {
  const instance = i18n
    .use(initReactI18next)
    .use(LanguageDetector)
    .use(
      resourcesToBackend(async (lng: string, ns: string) => {
        return unwrapESMModule(
          await loadI18nNamespaceModule({
            defaultLang: DEFAULT_LANG,
            lng,
            normalizeLocale,
            ns,
          }),
        );
      }),
    );
  // Dynamically set HTML direction on language change
  instance.on('languageChanged', (lng) => {
    if (typeof window !== 'undefined') {
      const direction = isRtlLang(lng) ? 'rtl' : 'ltr';
      document.documentElement.dir = direction;
    }
  });
  return {
    init: (params: { initAsync?: boolean } = {}) => {
      const { initAsync = true } = params;
      const initialLang = normalizeLocale(lang);
      const bundledLanguageResources =
        initialLang === DEFAULT_LANG
          ? {
              [DEFAULT_LANG]: defaultResources,
            }
          : {
              [DEFAULT_LANG]: defaultResources,
              [initialLang]: createBundledResources(),
            };

      const initPromise = instance.init({
        debug: debugMode,
        defaultNS: ['error', 'common', 'chat'],
        fallbackLng: DEFAULT_LANG,
        initAsync,
        // Keep init synchronous so components can render with bundled en-US resources
        // before the user's actual language finishes loading in the background.
        ns: [],

        // Preload default language (en-US) synchronously to avoid Suspense on first render
        resources: {
          ...bundledLanguageResources,
        },
        // Keep backend loading enabled for namespaces that are not preloaded above.
        partialBundledLanguages: true,

        interpolation: {
          escapeValue: false,
        },
        react: {
          // NOT `bindI18nStore: 'added'`: that subscribes every `useTranslation` consumer
          // to every lazily-loaded bundle, so each namespace arrival re-renders the whole
          // app — ~30 full-tree passes during boot. Components waiting on their own
          // namespace are already covered by react-i18next's `!ready` path; the only
          // event that must reach everyone is the one-time en-US -> user-language swap,
          // emitted once after `reloadResources` below.
          useSuspense: false,
        },
        keySeparator: false,

        lng: initialLang,
        // Silence the Locize promotional console.info printed on init (i18next >= 25)
        showSupportNotice: false,
      });

      if (initialLang !== DEFAULT_LANG) {
        initPromise.then(async () => {
          await instance.reloadResources([initialLang], bundledNamespaces);
          // One refresh for the whole tree instead of one per bundle: `bindI18n`
          // defaults to `languageChanged`, which every `useTranslation` already binds.
          instance.emit('languageChanged', instance.language);
        });
      }

      return initPromise;
    },
    instance,
  };
};
