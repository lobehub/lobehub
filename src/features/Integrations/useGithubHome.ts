import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

/**
 * Where GitHub is managed. With LobeHub connectors it lives on the Marketplace
 * connector; a deployment without them has no such entry, so its GitHub App
 * stays on the Integrations page.
 */
export const useGithubHome = () => {
  const isReady = useServerConfigStore((s) => s.serverConfigInit);
  const inMarketplace = useServerConfigStore(serverConfigSelectors.enableLobehubSkill);

  return { inMarketplace: isReady && inMarketplace, isReady };
};
