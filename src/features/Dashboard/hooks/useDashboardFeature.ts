import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
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

/**
 * The home dashboard (`/dashboard`): personal boards only for now —
 * workspace-level boards have no UI yet — so it is off inside a workspace even
 * while the flag is on. Project dashboards use `useDashboardFeature` instead.
 */
export const useHomeDashboardFeature = () => {
  const { enabled, ready } = useDashboardFeature();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  return { enabled: enabled && !activeWorkspaceSlug, ready };
};
