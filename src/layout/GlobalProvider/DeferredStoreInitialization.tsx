'use client';

import { memo, useEffect } from 'react';

import { useAiInfraStore } from '@/store/aiInfra';
import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';
import { useToolStore } from '@/store/tool';
import { useUserMemoryStore } from '@/store/userMemory';

interface DeferredStoreInitializationProps {
  isLogin: boolean;
}

const DeferredStoreInitialization = memo<DeferredStoreInitializationProps>(({ isLogin }) => {
  const useInitAiProviderKeyVaults = useAiInfraStore((s) => s.useFetchAiProviderRuntimeState);
  const useFetchPersona = useUserMemoryStore((s) => s.useFetchPersona);
  const isSyncActive = useElectronStore((s) => electronSyncSelectors.isSyncActive(s));

  useInitAiProviderKeyVaults(isLogin, isSyncActive);
  useFetchPersona(isLogin);

  // Load custom connectors so the classic chat path can expose their tools.
  const fetchConnectors = useToolStore((s) => s.fetchConnectors);
  const isConnectorsInit = useToolStore((s) => s.isConnectorsInit);
  useEffect(() => {
    if (isLogin && !isConnectorsInit) fetchConnectors();
  }, [isLogin, isConnectorsInit, fetchConnectors]);

  return null;
});

export default DeferredStoreInitialization;
