'use client';

import type { ReactNode } from 'react';
import { createContext, memo, use } from 'react';

import type { IFeatureFlagsState } from '@/config/featureFlags';
import type { GlobalServerConfig } from '@/types/serverConfig';

interface AuthServerConfigState {
  enableOIDC: boolean;
  featureFlags: Partial<IFeatureFlagsState>;
  isMobile?: boolean;
  serverConfig: GlobalServerConfig;
  serverConfigInit: boolean;
}

const AuthServerConfigContext = createContext<AuthServerConfigState | null>(null);

interface Props {
  children: ReactNode;
  enableOIDC?: boolean;
  featureFlags?: Partial<IFeatureFlagsState>;
  isMobile?: boolean;
  serverConfig?: GlobalServerConfig;
}

export const AuthServerConfigProvider = memo<Props>(
  ({ children, enableOIDC, featureFlags, serverConfig, isMobile }) => (
    <AuthServerConfigContext
      value={{
        enableOIDC: enableOIDC ?? false,
        featureFlags: featureFlags || {},
        isMobile,
        serverConfig: serverConfig || { aiProvider: {}, telemetry: {} },
        serverConfigInit: true,
      }}
    >
      {children}
    </AuthServerConfigContext>
  ),
);

export function useAuthServerConfigStore<T>(selector: (state: AuthServerConfigState) => T): T {
  const state = use(AuthServerConfigContext);
  if (!state) throw new Error('Missing AuthServerConfigProvider');
  return selector(state);
}
