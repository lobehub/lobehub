import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

export const useArtboardFeature = () => {
  const ready = useServerConfigStore((s) => s.serverConfigInit);
  const enabled = useServerConfigStore(serverConfigSelectors.enableArtboard);
  return { enabled: ready && enabled, ready };
};
