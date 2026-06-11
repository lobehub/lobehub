'use client';

import { memo, type PropsWithChildren } from 'react';

import BusinessAuthProvider from '@/business/client/BusinessAuthProvider';
import { LobeAnalyticsProviderWrapper } from '@/components/Analytics/LobeAnalyticsProviderWrapper';
import { mapFeatureFlagsEnvToState } from '@/config/featureFlags';
import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';
import type { AuthSPAServerConfig } from '@/types/spaServerConfig';

import AuthContainer from './AuthContainer';
import AuthLocale from './AuthLocale';
import { AuthServerConfigProvider } from './AuthServerConfigProvider';
import AuthThemeLite from './AuthThemeLite';

const AuthShell = memo<PropsWithChildren>(({ children }) => {
  const serverConfig = window.__SERVER_CONFIG__ as unknown as AuthSPAServerConfig | undefined;
  const locale = document.documentElement.lang || 'en-US';

  return (
    <AuthLocale defaultLang={locale}>
      <NextThemeProvider>
        <AuthThemeLite globalCDN={serverConfig?.globalCDN}>
          <AuthServerConfigProvider
            enableOIDC={serverConfig?.enableOIDC}
            isMobile={false}
            serverConfig={serverConfig?.config}
            featureFlags={
              serverConfig?.featureFlags
                ? mapFeatureFlagsEnvToState(serverConfig.featureFlags)
                : undefined
            }
          >
            <LobeAnalyticsProviderWrapper>
              <BusinessAuthProvider>
                <AuthContainer>{children}</AuthContainer>
              </BusinessAuthProvider>
            </LobeAnalyticsProviderWrapper>
          </AuthServerConfigProvider>
        </AuthThemeLite>
      </NextThemeProvider>
    </AuthLocale>
  );
});

AuthShell.displayName = 'AuthShell';

export default AuthShell;
