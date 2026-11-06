import {
  getServerConfigStoreState,
  serverConfigSelectors,
  useServerConfigStore,
} from '@/store/serverConfig';

export const isArtboardEnabled = () => {
  const config = getServerConfigStoreState();
  return !!config?.serverConfigInit && serverConfigSelectors.enableArtboard(config);
};

export const useArtboardFeature = () => {
  const ready = useServerConfigStore((s) => s.serverConfigInit);
  const enabled = useServerConfigStore(serverConfigSelectors.enableArtboard);
  return { enabled: ready && enabled, ready };
};
