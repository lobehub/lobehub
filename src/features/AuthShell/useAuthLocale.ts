import { useEffect, useState } from 'react';
import { isRtlLang } from 'rtl-detect';

import { createAuthI18n } from './createAuthI18n';

const SYSTEM_STATUS_KEY = 'LOBE_SYSTEM_STATUS';

const syncBackendLanguagePreference = (language: string) => {
  try {
    const persisted = JSON.parse(localStorage.getItem(SYSTEM_STATUS_KEY) || '{}');
    localStorage.setItem(SYSTEM_STATUS_KEY, JSON.stringify({ ...persisted, language }));
  } catch {
    localStorage.setItem(SYSTEM_STATUS_KEY, JSON.stringify({ language }));
  }
};

export const useAuthLocale = (defaultLang = 'zh-CN') => {
  const [i18n] = useState(() => createAuthI18n(defaultLang));
  const [lang, setLang] = useState(defaultLang);

  if (!i18n.instance.isInitialized) {
    i18n.init();
  }

  useEffect(() => {
    const handleLang = (lng: string) => {
      setLang((prev) => (prev === lng ? prev : lng));
      syncBackendLanguagePreference(lng);
    };

    syncBackendLanguagePreference(defaultLang);
    i18n.instance.on('languageChanged', handleLang);
    return () => {
      i18n.instance.off('languageChanged', handleLang);
    };
  }, [defaultLang, i18n]);

  return { documentDir: isRtlLang(lang) ? 'rtl' : 'ltr', i18n, lang };
};
