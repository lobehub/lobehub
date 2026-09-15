'use client';

import { ConfigProvider } from 'antd';
import { memo, type PropsWithChildren } from 'react';
import { I18nextProvider } from 'react-i18next';

import { useAuthLocale } from './useAuthLocale';

interface AuthLocaleProps extends PropsWithChildren {
  defaultLang?: string;
}

const AuthLocale = memo<AuthLocaleProps>(({ children, defaultLang }) => {
  const { documentDir, i18n } = useAuthLocale(defaultLang);

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
