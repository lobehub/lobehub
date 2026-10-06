import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

/**
 * The runtime flag `dashboard` (off by default) as the client sees it.
 * `ready` is false until the server config — and so the user's flags — has
 * loaded; surfaces should neither render nor redirect before that.
 */
export const useDashboardFeature = () => {
  const ready = useServerConfigStore((s) => s.serverConfigInit);
  const enabled = useServerConfigStore(serverConfigSelectors.enableDashboard);
  return { enabled: ready && enabled, ready };
};
