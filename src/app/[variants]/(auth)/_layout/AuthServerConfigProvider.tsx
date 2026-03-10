'use client';

import { createContext, memo, type ReactNode, use } from 'react';

import { type GlobalServerConfig } from '@/types/serverConfig';

interface AuthServerConfigState {
  isMobile?: boolean;
  segmentVariants?: string;
  serverConfig: GlobalServerConfig;
  serverConfigInit: boolean;
}

const AuthServerConfigContext = createContext<AuthServerConfigState | null>(null);

interface Props {
  children: ReactNode;
  isMobile?: boolean;
  segmentVariants?: string;
  serverConfig?: GlobalServerConfig;
}

export const AuthServerConfigProvider = memo<Props>(
  ({ children, serverConfig, isMobile, segmentVariants }) => (
    <AuthServerConfigContext
      value={{
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
