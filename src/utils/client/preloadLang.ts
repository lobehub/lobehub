import i18n from 'i18next';

import { type LocaleMode } from '@/types/locale';
import { getAntdLocale } from '@/utils/locale';

import { resolveLang } from './switchLang';

const HOVER_INTENT_DELAY = 120;

let intentTimer: ReturnType<typeof setTimeout> | undefined;

// `options.ns` misses the namespaces bundled at init (react-i18next only registers a namespace
// when it had to be fetched), so the store keys are unioned in to cover them as well.
const resolveNamespaces = () => {
  const { ns } = i18n.options;
  const registered = typeof ns === 'string' ? [ns] : (ns ?? []);
  const inStore = Object.keys(i18n.getDataByLanguage(i18n.resolvedLanguage || i18n.language) ?? {});

  return [...new Set([...registered, ...inStore])];
};

const loadNamespaces = (lang: string) => {
  const backendConnector = i18n.services?.backendConnector;
  if (!backendConnector) return;

  const namespaces = resolveNamespaces();
  if (namespaces.length === 0) return;

  // i18next skips (lng, ns) pairs that are already loaded or in flight, so no dedupe cache is needed here
  backendConnector.load(lang, namespaces, () => {});
};

export const preloadLang = (locale: LocaleMode) => {
  clearTimeout(intentTimer);

  intentTimer = setTimeout(() => {
    const lang = resolveLang(locale);

    loadNamespaces(lang);
    getAntdLocale(lang).catch(() => {});
  }, HOVER_INTENT_DELAY);
};
