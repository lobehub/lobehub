'use client';

import { ConfigProvider } from 'antd';
import { memo, type PropsWithChildren, useEffect, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { isRtlLang } from 'rtl-detect';

import { DEFAULT_LANG } from '@/const/locale';
import { normalizeLocale } from '@/locales/resources';
import { applyDocumentDirection } from '@/utils/client/applyDocumentDirection';

import { createAuthI18n } from './createAuthI18n';

interface AuthLocaleProps extends PropsWithChildren {
  defaultLang?: string;
}

const AuthLocale = memo<AuthLocaleProps>(({ children, defaultLang }) => {
  const initialLang = normalizeLocale(defaultLang ?? DEFAULT_LANG);
  const [i18n] = useState(() => createAuthI18n(initialLang));
  const [lang, setLang] = useState(initialLang);
  const [ready, setReady] = useState(i18n.instance.isInitialized);

  useEffect(() => {
    let canceled = false;
    void i18n.init({ initAsync: false }).then(() => {
      if (!canceled) setReady(true);
    });
    return () => {
      canceled = true;
    };
  }, [i18n]);

  useEffect(() => {
    if (!ready) return;

    applyDocumentDirection(lang);
  }, [lang, ready]);

  useEffect(() => {
    if (!ready) return;

    const handleLang = (lng: string) => {
      const next = normalizeLocale(lng);
      setLang((prev) => (prev === next ? prev : next));
    };

    handleLang(i18n.instance.language || initialLang);
    i18n.instance.on('languageChanged', handleLang);
    return () => {
      i18n.instance.off('languageChanged', handleLang);
    };
  }, [i18n, initialLang, ready]);

  if (!ready) return null;

  const documentDir = isRtlLang(lang) ? 'rtl' : 'ltr';

  return (
    <I18nextProvider i18n={i18n.instance}>
      <ConfigProvider
        direction={documentDir}
        theme={{
          components: {
            Button: {
              contentFontSizeSM: 12,
            },
          },
        }}
      >
        {children}
      </ConfigProvider>
    </I18nextProvider>
  );
});

AuthLocale.displayName = 'AuthLocale';

export default AuthLocale;
