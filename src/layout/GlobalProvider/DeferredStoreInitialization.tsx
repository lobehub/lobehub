'use client';

import { memo } from 'react';

import { useAiInfraStore } from '@/store/aiInfra';
import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';

interface DeferredStoreInitializationProps {
  isLogin: boolean;
}

const DeferredStoreInitialization = memo<DeferredStoreInitializationProps>(({ isLogin }) => {
  const useInitAiProviderKeyVaults = useAiInfraStore((s) => s.useFetchAiProviderRuntimeState);
  const isSyncActive = useElectronStore((s) => electronSyncSelectors.isSyncActive(s));

  useInitAiProviderKeyVaults(isLogin, isSyncActive);

  // NOTE: the user persona is intentionally NOT pre-warmed here. Nothing on the
  // boot screen renders it: it is read when a message is sent
  // (`resolveUserPersona`) and on the memory page, whose own mount fetches it.
  // This global mount used to pull `userMemory.getPersona` into the app-boot
  // tRPC batch on every login and workspace switch — the batch every
  // `workspace.list` / subscription read shares, where a member nobody on the
  // boot screen consumes only lengthens the critical path.
  return null;
});

export default DeferredStoreInitialization;
