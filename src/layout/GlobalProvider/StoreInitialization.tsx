'use client';

import { INBOX_SESSION_ID } from '@lobechat/const';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { createStoreUpdater } from 'zustand-utils';

import { useIsMobile } from '@/hooks/useIsMobile';
import { useAgentStore } from '@/store/agent';
import { useAiInfraStore } from '@/store/aiInfra';
import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';
import { useGlobalStore } from '@/store/global';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { useUserMemoryStore } from '@/store/userMemory';
import {
  AI_PROVIDER_RUNTIME_BROADCAST_CHANNEL,
  getBroadcastSourceId,
} from '@/utils/client/broadcast';

import { useUserStateRedirect } from './useUserStateRedirect';

const StoreInitialization = memo(() => {
  // prefetch error ns to avoid don't show error content correctly
  useTranslation('error');

  const [isLogin, useInitUserState] = useUserStore((s) => [
    authSelectors.isLogin(s),
    s.useInitUserState,
  ]);

  const { serverConfig } = useServerConfigStore();

  const [useInitSystemStatus, useCheckServerVersion] = useGlobalStore((s) => [
    s.useInitSystemStatus,
    s.useCheckServerVersion,
  ]);

  const useInitBuiltinAgent = useAgentStore((s) => s.useInitBuiltinAgent);
  const useInitAiProviderKeyVaults = useAiInfraStore((s) => s.useFetchAiProviderRuntimeState);
  const refreshAiProviderRuntimeState = useAiInfraStore((s) => s.refreshAiProviderRuntimeState);
  const useInitIdentities = useUserMemoryStore((s) => s.useInitIdentities);

  // init the system preference
  useInitSystemStatus();

  // check server version in desktop app
  useCheckServerVersion();

  // fetch server config
  const useFetchServerConfig = useServerConfigStore((s) => s.useInitServerConfig);
  useFetchServerConfig();

  // Update NextAuth status
  const useUserStoreUpdater = createStoreUpdater(useUserStore);
  const oAuthSSOProviders = useServerConfigStore(serverConfigSelectors.oAuthSSOProviders);
  useUserStoreUpdater('oAuthSSOProviders', oAuthSSOProviders);

  /**
   * The store function of `isLogin` will both consider the values of `enableAuth` and `isSignedIn`.
   * But during initialization, the value of `enableAuth` might be incorrect cause of the async fetch.
   * So we need to use `isSignedIn` only to determine whether request for the default agent config and user state.
   *
   * IMPORTANT: Explicitly convert to boolean to avoid passing null/undefined downstream,
   * which would cause unnecessary API requests with invalid login state.
   */
  const isLoginOnInit = Boolean(isLogin);

  // init inbox agent via builtin agent mechanism
  useInitBuiltinAgent(INBOX_SESSION_ID, { isLogin: isLoginOnInit });

  const isSyncActive = useElectronStore((s) => electronSyncSelectors.isSyncActive(s));

  // init user provider key vaults
  useInitAiProviderKeyVaults(isLoginOnInit, isSyncActive);

  // init user memory identities (for chat context injection)
  useInitIdentities(isLoginOnInit);

  const onUserStateSuccess = useUserStateRedirect();

  // init user state
  useInitUserState(isLoginOnInit, serverConfig, {
    onSuccess: onUserStateSuccess,
  });

  const useStoreUpdater = createStoreUpdater(useGlobalStore);

  const mobile = useIsMobile();

  useStoreUpdater('isMobile', mobile);

  useEffect(() => {
    if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return;
    const sourceId = getBroadcastSourceId();
    if (!sourceId) return;

    const channel = new BroadcastChannel(AI_PROVIDER_RUNTIME_BROADCAST_CHANNEL);
    const handleMessage = (event: MessageEvent<{ sourceId?: string; type?: string }>) => {
      if (event.data?.type !== 'refresh-ai-provider-runtime') return;
      if (event.data.sourceId === sourceId) return;
      void refreshAiProviderRuntimeState({ broadcast: false });
    };

    channel.addEventListener('message', handleMessage);

    return () => {
      channel.removeEventListener('message', handleMessage);
      channel.close();
    };
  }, [refreshAiProviderRuntimeState]);

  return null;
});

export default StoreInitialization;
