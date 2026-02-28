import i18next from 'i18next';
import resourcesToBackend from 'i18next-resources-to-backend';
import { initReactI18next } from 'react-i18next';

import { DEFAULT_LANG } from '@/const/locale';
import { normalizeLocale } from '@/locales/resources';

const AUTH_I18N_NAMESPACES = [
  'auth',
  'authError',
  'common',
  'error',
  'marketAuth',
  'oauth',
] as const;
type AuthI18nNamespace = (typeof AUTH_I18N_NAMESPACES)[number];

const isAllowedNamespace = (ns: string): ns is AuthI18nNamespace =>
  (AUTH_I18N_NAMESPACES as readonly string[]).includes(ns);

const loadDefaultNamespace = async (ns: AuthI18nNamespace) => {
  switch (ns) {
    case 'auth': {
      return import('@/locales/default/auth');
    }
    case 'authError': {
      return import('@/locales/default/authError');
    }
    case 'common': {
      return import('@/locales/default/common');
    }
    case 'error': {
      return import('@/locales/default/error');
    }
    case 'marketAuth': {
      return import('@/locales/default/marketAuth');
    }
    case 'oauth': {
      return import('@/locales/default/oauth');
    }
  }
};

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

  try {
    if (normalizedLocale === DEFAULT_LANG) return loadDefaultNamespace(safeNamespace);
    if (normalizedLocale === 'zh-CN') return loadZhNamespace(safeNamespace);
  } catch {
    // fall through to default namespace
  }

  return loadDefaultNamespace(safeNamespace);
};

export const createAuthI18n = (lang?: string) => {
  const instance = i18next
    .createInstance()
    .use(initReactI18next)
    .use(
      resourcesToBackend(async (lng: string, ns: string) => {
        const mod = await loadAuthNamespace(lng, ns);
        return (mod as any).default ?? mod;
      }),
    );

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
      });
    },
    instance,
  };
};
