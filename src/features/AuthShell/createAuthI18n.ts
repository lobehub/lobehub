import i18next from 'i18next';
import resourcesToBackend from 'i18next-resources-to-backend';
import { initReactI18next } from 'react-i18next';

import { DEFAULT_LANG } from '@/const/locale';
import defaultAuth from '@/locales/default/auth';
import defaultAuthError from '@/locales/default/authError';
import defaultCommon from '@/locales/default/common';
import defaultError from '@/locales/default/error';
import defaultMarketAuth from '@/locales/default/marketAuth';
import defaultOauth from '@/locales/default/oauth';
import { normalizeLocale } from '@/locales/resources';

const defaultResources = {
  auth: defaultAuth,
  authError: defaultAuthError,
  common: defaultCommon,
  error: defaultError,
  marketAuth: defaultMarketAuth,
  oauth: defaultOauth,
};

type AuthI18nNamespace = keyof typeof defaultResources;

const isAllowedNamespace = (ns: string): ns is AuthI18nNamespace => ns in defaultResources;

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

const loadAuthNamespace = async (lng: string, ns: string) => {
  const safeNamespace = isAllowedNamespace(ns) ? ns : 'auth';
  const normalizedLocale = normalizeLocale(lng);

  if (normalizedLocale === 'zh-CN') {
    try {
      const mod = await loadZhNamespace(safeNamespace);
      return (mod as any).default ?? mod;
    } catch {
      // fall through to bundled default namespace
    }
  }

  return defaultResources[safeNamespace];
};

export const createAuthI18n = (lang?: string) => {
  const instance = i18next
    .createInstance()
    .use(initReactI18next)
    .use(resourcesToBackend(loadAuthNamespace));

  // With ns: [] and the en-US fallback bundled, i18next considers every namespace
  // "loaded" and never asks the backend after a language switch — fetch explicitly.
  instance.on('languageChanged', (lng) => {
    const locale = normalizeLocale(lng);
    if (locale === DEFAULT_LANG) return;
    void instance.reloadResources([locale], Object.keys(defaultResources));
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
        lng: lang,
        ns: [],
        // Bundle en-US synchronously so the first render never suspends: with the
        // default useSuspense=true and no Suspense boundary above AuthShell, every
        // retry of the initial mount re-creates this instance and the auth SPA
        // remounts forever with a blank #root.
        partialBundledLanguages: true,
        react: {
          bindI18nStore: 'added',
          useSuspense: false,
        },
        resources: { [DEFAULT_LANG]: defaultResources },
        // Silence the Locize promotional console.info printed on init (i18next >= 25)
        showSupportNotice: false,
      });
    },
    instance,
  };
};
