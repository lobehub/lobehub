import { ModalHost } from '@lobehub/ui/base-ui';
import { memo, type PropsWithChildren } from 'react';

import BusinessAuthProvider from '@/business/client/BusinessAuthProvider';
import { LobeAnalyticsProviderWrapper } from '@/components/Analytics/LobeAnalyticsProviderWrapper';
import type { IFeatureFlags } from '@/config/featureFlags';
import { mapFeatureFlagsEnvToState } from '@/config/featureFlags';
import AuthContainer from '@/features/AuthShell/AuthContainer';
import { AuthServerConfigProvider } from '@/features/AuthShell/AuthServerConfigProvider';
import AuthThemeLite from '@/features/AuthShell/AuthThemeLite';
import { useIsHydrated } from '@/hooks/useIsHydrated';
import type { GlobalServerConfig } from '@/types/serverConfig';
import type { AnalyticsConfig } from '@/types/spaServerConfig';

import AuthLocaleProvider from './AuthLocaleProvider';

const EMPTY_ANALYTICS = {};

/** What `/webapi/auth/spa-config` serves — narrower than the Next.js shell's. */
interface AuthWorkerConfig {
  analyticsConfig: AnalyticsConfig;
  config: Pick<
    GlobalServerConfig,
    'disableEmailPassword' | 'enableEmailVerification' | 'enableMagicLink' | 'oAuthSSOProviders'
  >;
  enableOIDC: boolean;
  featureFlags?: Partial<IFeatureFlags>;
  globalCDN?: boolean;
}

// Everything here is deployment state the build cannot know, so the worker
// injects it. Reading it only after hydration keeps the first client render
// byte-identical to the prerendered document — which is why
// `enableBusinessFeatures` must not travel this way: prerendering the SSO
// buttons depends on knowing it during the render.
const useInjectedServerConfig = (): AuthWorkerConfig | undefined => {
  const isHydrated = useIsHydrated();

  if (!isHydrated) return undefined;

  return window.__SERVER_CONFIG__ as unknown as AuthWorkerConfig | undefined;
};

interface AuthAppShellProps extends PropsWithChildren {
  locale: string;
}

const AuthAppShell = memo<AuthAppShellProps>(({ children, locale }) => {
  const serverConfig = useInjectedServerConfig();

  return (
    <AuthLocaleProvider locale={locale}>
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
          <LobeAnalyticsProviderWrapper
            analytics={serverConfig?.analyticsConfig ?? EMPTY_ANALYTICS}
          >
            <BusinessAuthProvider>
              <AuthContainer>{children}</AuthContainer>
            </BusinessAuthProvider>
          </LobeAnalyticsProviderWrapper>
        </AuthServerConfigProvider>
        <ModalHost />
      </AuthThemeLite>
    </AuthLocaleProvider>
  );
});

AuthAppShell.displayName = 'AuthAppShell';

export default AuthAppShell;
