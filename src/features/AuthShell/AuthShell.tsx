'use client';

import { memo, type PropsWithChildren } from 'react';

import { LobeAnalyticsProviderWrapper } from '@/components/Analytics/LobeAnalyticsProviderWrapper';
import { mapFeatureFlagsEnvToState } from '@/config/featureFlags';
import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';
import type { SPAServerConfig } from '@/types/spaServerConfig';

import AuthContainer from './AuthContainer';
import AuthLocale from './AuthLocale';
import { AuthServerConfigProvider } from './AuthServerConfigProvider';
import AuthThemeLite from './AuthThemeLite';

const AuthShell = memo<PropsWithChildren>(({ children }) => {
  const serverConfig: SPAServerConfig | undefined = window.__SERVER_CONFIG__;
  const locale = document.documentElement.lang || 'en-US';

  return (
    <AuthLocale defaultLang={locale}>
      <NextThemeProvider>
        <AuthThemeLite>
          <AuthServerConfigProvider
            isMobile={false}
            serverConfig={serverConfig?.config}
            featureFlags={
              serverConfig?.featureFlags
                ? mapFeatureFlagsEnvToState(serverConfig.featureFlags)
                : undefined
            }
          >
            <LobeAnalyticsProviderWrapper>
              <AuthContainer>{children}</AuthContainer>
            </LobeAnalyticsProviderWrapper>
          </AuthServerConfigProvider>
        </AuthThemeLite>
      </NextThemeProvider>
    </AuthLocale>
  );
});

AuthShell.displayName = 'AuthShell';

export default AuthShell;
