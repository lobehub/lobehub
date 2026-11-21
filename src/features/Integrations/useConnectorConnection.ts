import { getLobehubSkillProviderById } from '@lobechat/const';

import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import { lobehubSkillStoreSelectors } from '@/store/tool/selectors';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';

import type { ConnectorPageId } from './connectorPage';

/**
 * The user's own connector account on a connector page. It is a separate
 * authorization from the integration on the same page: this one lets agents
 * call the provider's tools. `available` is false on a deployment without
 * LobeHub connectors, where only the integration half applies.
 */
export const useConnectorConnection = (identifier: ConnectorPageId) => {
  const available = useServerConfigStore(serverConfigSelectors.enableLobehubSkill);
  const useFetchConnections = useToolStore((s) => s.useFetchLobehubSkillConnections);
  const { error, isLoading, mutate } = useFetchConnections(available);
  const server = useToolStore(lobehubSkillStoreSelectors.getServerByIdentifier(identifier));

  return {
    available,
    connected: available && server?.status === LobehubSkillStatus.CONNECTED,
    error: available ? error : undefined,
    isInitialLoading: available && isLoading,
    provider: getLobehubSkillProviderById(identifier),
    retry: () => void mutate(),
    server,
  };
};
