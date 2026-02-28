import { type ReactNode } from 'react';

import { appEnv } from '@/envs/app';
import AuthProvider from '@/layout/AuthProvider';
import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';
import StyleRegistry from '@/layout/GlobalProvider/StyleRegistry';
import { getServerAuthConfig } from '@/server/globalConfig/getServerAuthConfig';
import { RouteVariants } from '@/utils/server/routeVariants';

import AuthLocale from './AuthLocale';
import { AuthServerConfigProvider } from './AuthServerConfigProvider';
import AuthThemeLite from './AuthThemeLite';

interface AuthGlobalProviderProps {
  children: ReactNode;
  variants: string;
}

const AuthGlobalProvider = async ({ children, variants }: AuthGlobalProviderProps) => {
  const { locale, isMobile } = RouteVariants.deserializeVariants(variants);
  const serverConfig = getServerAuthConfig();

  return (
    <StyleRegistry>
      <AuthLocale defaultLang={locale}>
        <NextThemeProvider>
          <AuthThemeLite globalCDN={appEnv.CDN_USE_GLOBAL}>
            <AuthServerConfigProvider
              isMobile={isMobile}
              segmentVariants={variants}
              serverConfig={serverConfig}
            >
              <AuthProvider>{children}</AuthProvider>
            </AuthServerConfigProvider>
          </AuthThemeLite>
        </NextThemeProvider>
      </AuthLocale>
    </StyleRegistry>
  );
};

export default AuthGlobalProvider;
