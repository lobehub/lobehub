'use client';

import { memo } from 'react';

import { useAiInfraStore } from '@/store/aiInfra';
import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';
import { useUserMemoryStore } from '@/store/userMemory';

interface DeferredStoreInitializationProps {
  isLogin: boolean;
}

const DeferredStoreInitialization = memo<DeferredStoreInitializationProps>(({ isLogin }) => {
  const useInitAiProviderKeyVaults = useAiInfraStore((s) => s.useFetchAiProviderRuntimeState);
  const useInitIdentities = useUserMemoryStore((s) => s.useInitIdentities);
  const isSyncActive = useElectronStore((s) => electronSyncSelectors.isSyncActive(s));

  useInitAiProviderKeyVaults(isLogin, isSyncActive);
  useInitIdentities(isLogin);

  return null;
});

export default DeferredStoreInitialization;
