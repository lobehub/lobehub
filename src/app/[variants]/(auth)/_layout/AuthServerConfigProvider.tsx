'use client';

import type { ReactNode } from 'react';
import { createContext, memo, use } from 'react';

import type { IFeatureFlagsState } from '@/config/featureFlags';
import type { GlobalServerConfig } from '@/types/serverConfig';

interface AuthServerConfigState {
  featureFlags: Partial<IFeatureFlagsState>;
  isMobile?: boolean;
  segmentVariants?: string;
  serverConfig: GlobalServerConfig;
  serverConfigInit: boolean;
}

const AuthServerConfigContext = createContext<AuthServerConfigState | null>(null);

interface Props {
  children: ReactNode;
  featureFlags?: Partial<IFeatureFlagsState>;
  isMobile?: boolean;
  segmentVariants?: string;
  serverConfig?: GlobalServerConfig;
}

export const AuthServerConfigProvider = memo<Props>(
  ({ children, featureFlags, serverConfig, isMobile, segmentVariants }) => (
    <AuthServerConfigContext
      value={{
        featureFlags: featureFlags || {},
        isMobile,
        segmentVariants,
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
