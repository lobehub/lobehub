import i18next from 'i18next';
import resourcesToBackend from 'i18next-resources-to-backend';
import { initReactI18next } from 'react-i18next';

import faAuth from '@/../locales/fa-IR/auth.json';
import faAuthError from '@/../locales/fa-IR/authError.json';
import faCommon from '@/../locales/fa-IR/common.json';
import faError from '@/../locales/fa-IR/error.json';
import faMarketAuth from '@/../locales/fa-IR/marketAuth.json';
import faOauth from '@/../locales/fa-IR/oauth.json';
import { DEFAULT_LANG } from '@/const/locale';
import defaultAuth from '@/locales/default/auth';
import defaultAuthError from '@/locales/default/authError';
import defaultCommon from '@/locales/default/common';
import defaultError from '@/locales/default/error';
import defaultMarketAuth from '@/locales/default/marketAuth';
import defaultOauth from '@/locales/default/oauth';
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
  auth: defaultAuth,
  authError: defaultAuthError,
  common: defaultCommon,
  error: defaultError,
  marketAuth: defaultMarketAuth,
  oauth: defaultOauth,
};

const bundledDefaultResources = {
  auth: mergeNamespace(defaultAuth, faAuth),
  authError: mergeNamespace(defaultAuthError, faAuthError),
  common: mergeNamespace(defaultCommon, faCommon),
  error: mergeNamespace(defaultError, faError),
  marketAuth: mergeNamespace(defaultMarketAuth, faMarketAuth),
  oauth: mergeNamespace(defaultOauth, faOauth),
};

type AuthI18nNamespace = keyof typeof defaultResources;

const isAllowedNamespace = (ns: string): ns is AuthI18nNamespace => ns in defaultResources;

const authNamespaces = Object.keys(defaultResources);

type LocaleModule = { default?: Record<string, string> } | Record<string, string>;

const unwrapLocaleModule = (mod: LocaleModule) =>
  (mod as { default?: Record<string, string> }).default ?? (mod as Record<string, string>);

const loadZhNamespace = async (ns: AuthI18nNamespace) => {
  switch (ns) {
    case 'auth': {
      return import('@/../locales/zh-CN/auth.json');
    }
    case 'authError': {
      return import('@/../locales/zh-CN/authError.json');
    }
    case 'common': {
      return import('@/../locales/zh-CN/common.json');
    }
    case 'error': {
      return import('@/../locales/zh-CN/error.json');
    }
    case 'marketAuth': {
      return import('@/../locales/zh-CN/marketAuth.json');
    }
    case 'oauth': {
      return import('@/../locales/zh-CN/oauth.json');
    }
  }
};

const loadFaNamespace = async (ns: AuthI18nNamespace) => {
  switch (ns) {
    case 'auth': {
      return import('@/../locales/fa-IR/auth.json');
    }
    case 'authError': {
      return import('@/../locales/fa-IR/authError.json');
    }
    case 'common': {
      return import('@/../locales/fa-IR/common.json');
    }
    case 'error': {
      return import('@/../locales/fa-IR/error.json');
    }
    case 'marketAuth': {
      return import('@/../locales/fa-IR/marketAuth.json');
    }
    case 'oauth': {
      return import('@/../locales/fa-IR/oauth.json');
    }
  }
};

/** Exported for regression tests — auth SPA must load fa-IR / zh-CN, not fall back to English. */
export const loadAuthNamespace = async (lng: string, ns: string) => {
  const safeNamespace = isAllowedNamespace(ns) ? ns : 'auth';
  const normalizedLocale = normalizeLocale(lng);
  const english = defaultResources[safeNamespace] as Record<string, unknown>;

  try {
    if (normalizedLocale === 'zh-CN') {
      return mergeNamespace(english, unwrapLocaleModule(await loadZhNamespace(safeNamespace)));
    }
    if (normalizedLocale === 'fa-IR') {
      return mergeNamespace(english, unwrapLocaleModule(await loadFaNamespace(safeNamespace)));
    }
    if (normalizedLocale !== 'en-US') {
      // Visible locales like fr-FR (and any other non-English) load from locales/.
      return mergeNamespace(
        english,
        unwrapESMModule(
          await loadI18nNamespaceModule({
            defaultLang: DEFAULT_LANG,
            lng: normalizedLocale,
            normalizeLocale,
            ns: safeNamespace,
          }),
        ) as Record<string, unknown>,
      );
    }
  } catch {
    // fall through to bundled default namespace
  }

  return defaultResources[safeNamespace];
};

export const createAuthI18n = (lang?: string) => {
  const instance = i18next
    .createInstance()
    .use(initReactI18next)
    .use(resourcesToBackend(loadAuthNamespace));

  const initialLang = normalizeLocale(lang);

  // With ns: [] and partialBundledLanguages, i18next may not re-read the backend after
  // a language switch — fetch explicitly for every locale, including DEFAULT_LANG (fa-IR),
  // so switching back to Persian after English/French actually reloads Persian copy.
  instance.on('languageChanged', (lng) => {
    const locale = normalizeLocale(lng);
    void instance.reloadResources([locale], authNamespaces);
  });

  return {
    init: (params: { initAsync?: boolean } = {}) => {
      const { initAsync = true } = params;

      return instance.init({
        defaultNS: ['auth', 'common', 'error'],
        fallbackLng: DEFAULT_LANG,
        initAsync,
        interpolation: { escapeValue: false },
        keySeparator: false,
        lng: initialLang,
        ns: [],
        // Bundle fa-IR synchronously so the first render never suspends: with the
        // default useSuspense=true and no Suspense boundary above AuthShell, every
        // retry of the initial mount re-creates this instance and the auth SPA
        // remounts forever with a blank #root.
        partialBundledLanguages: true,
        react: {
          bindI18nStore: 'added',
          useSuspense: false,
        },
        resources: { [DEFAULT_LANG]: bundledDefaultResources },
        // Silence the Locize promotional console.info printed on init (i18next >= 25)
        showSupportNotice: false,
      });
    },
    instance,
  };
};
