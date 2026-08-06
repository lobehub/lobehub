'use client';

import { ConfigProvider } from 'antd';
import { memo, type PropsWithChildren, useEffect, useState } from 'react';
import { isRtlLang } from 'rtl-detect';

import { DEFAULT_LANG } from '@/const/locale';
import { applyDocumentDirection } from '@/utils/client/applyDocumentDirection';

import { createAuthI18n } from './createAuthI18n';

interface AuthLocaleProps extends PropsWithChildren {
  defaultLang?: string;
}

const AuthLocale = memo<AuthLocaleProps>(({ children, defaultLang }) => {
  const [i18n] = useState(() => createAuthI18n(defaultLang));
  const [lang, setLang] = useState(defaultLang ?? DEFAULT_LANG);

  if (!i18n.instance.isInitialized) {
    i18n.init();
  }

  useEffect(() => {
    applyDocumentDirection(lang);
  }, [lang]);

  useEffect(() => {
    const handleLang = (lng: string) => {
      setLang((prev) => (prev === lng ? prev : lng));
    };

    i18n.instance.on('languageChanged', handleLang);
    return () => {
      i18n.instance.off('languageChanged', handleLang);
    };
  }, [i18n]);

  const documentDir = isRtlLang(lang) ? 'rtl' : 'ltr';

  return (
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
  );
});

AuthLocale.displayName = 'AuthLocale';

export default AuthLocale;
