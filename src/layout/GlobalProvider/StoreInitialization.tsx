'use client';

import { INBOX_SESSION_ID } from '@lobechat/const';
import { lazy, memo, Suspense, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { createStoreUpdater } from 'zustand-utils';

import { applyToolNameMaxLength } from '@/helpers/applyToolNameMaxLength';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useAgentStore } from '@/store/agent';
import { useGlobalStore } from '@/store/global';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import ElectronAppStateSync from './ElectronAppStateSync';
import { useUserStateRedirect } from './useUserStateRedirect';

const DeferredStoreInitialization = lazy(() => import('./DeferredStoreInitialization'));

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

  // init the system preference
  useInitSystemStatus();

  // check server version in desktop app
  useCheckServerVersion();

  // fetch server config
  const useFetchServerConfig = useServerConfigStore((s) => s.useInitServerConfig);
  useFetchServerConfig();

  // Sync the deployment's tool-name-generation config (compression threshold,
  // `lobe-` wire namespace rewrite) as soon as server config is available —
  // the client-driven chat path, and any UI that displays a tool's raw
  // identifier (e.g. ToolItemDetailPopover), need this before the tools panel
  // is ever opened, not just right before the first LLM call.
  useEffect(() => {
    applyToolNameMaxLength();
  }, [serverConfig]);

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

  const onUserStateSuccess = useUserStateRedirect();

  // init user state
  useInitUserState(isLoginOnInit, serverConfig, {
    onSuccess: onUserStateSuccess,
  });

  const useStoreUpdater = createStoreUpdater(useGlobalStore);

  const mobile = useIsMobile();

  useStoreUpdater('isMobile', mobile);

  return (
    <>
      <ElectronAppStateSync />
      <Suspense>
        <DeferredStoreInitialization isLogin={isLoginOnInit} />
      </Suspense>
    </>
  );
});

export default StoreInitialization;
