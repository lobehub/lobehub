import { getLobehubSkillProviderById } from '@lobechat/const';

import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import { lobehubSkillStoreSelectors } from '@/store/tool/selectors';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';

const GITHUB_CONNECTOR_ID = 'github';

/**
 * The GitHub connector as the integration surfaces read it. It is a separate
 * authorization from the GitHub App installation: this one lets agents call
 * GitHub tools with the user's account. `available` is false on a deployment
 * without LobeHub connectors, where the page has nothing to offer for it.
 */
export const useGithubAgentTools = () => {
  const available = useServerConfigStore(serverConfigSelectors.enableLobehubSkill);
  const useFetchConnections = useToolStore((s) => s.useFetchLobehubSkillConnections);
  const { error, isLoading, mutate } = useFetchConnections(available);
  const server = useToolStore(
    lobehubSkillStoreSelectors.getServerByIdentifier(GITHUB_CONNECTOR_ID),
  );

  return {
    available,
    connected: available && server?.status === LobehubSkillStatus.CONNECTED,
    error: available ? error : undefined,
    isInitialLoading: available && isLoading,
    provider: getLobehubSkillProviderById(GITHUB_CONNECTOR_ID),
    retry: () => void mutate(),
    server,
  };
};
