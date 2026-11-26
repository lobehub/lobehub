import { OFFICIAL_MCP_SERVERS } from '@lobechat/const';
import isEqual from 'fast-deep-equal';

import { CONNECTOR_PAGE_IDS } from '@/features/Integrations/connectorPage';
import { useLinearConnections } from '@/features/Integrations/useLinearIntegration';
import { buildIntegrationItems } from '@/features/Settings/skill/features/connectorSections';
import { integrationActions, integrationSelectors, useIntegrationStore } from '@/store/integration';
import { messengerActions, messengerSelectors, useMessengerStore } from '@/store/messenger';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import { composioStoreSelectors, lobehubSkillStoreSelectors } from '@/store/tool/selectors';
import { ComposioServerStatus } from '@/store/tool/slices/composioStore';
import { connectorSelectors } from '@/store/tool/slices/connector/selectors';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';

import { buildMarketplaceApps } from './catalog';

export const useMarketplaceApps = () => {
  const configReady = useServerConfigStore((s) => s.serverConfigInit);
  const messenger = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const lobehub = useServerConfigStore(serverConfigSelectors.enableLobehubSkill);
  const composio = useServerConfigStore(serverConfigSelectors.enableComposio);
  const channelsSync = messengerActions.useFetchPlatforms({ enabled: messenger });
  const linksSync = messengerActions.useFetchLinks({ enabled: messenger });
  const installsSync = messengerActions.useFetchInstallations({ enabled: messenger });
  const githubSync = integrationActions.useFetchGithubInstallations(configReady);
  const linear = useLinearConnections();
  const channels = useMessengerStore(messengerSelectors.platforms);
  const links = useMessengerStore(messengerSelectors.links);
  const installations = useMessengerStore(messengerSelectors.installations);
  const github = useIntegrationStore(integrationSelectors.scmInstallations);
  const platformsSettled = useMessengerStore(messengerSelectors.isPlatformsSettled);

  const useComposio = useToolStore((s) => s.useFetchUserComposioConnections);
  const useLobehub = useToolStore((s) => s.useFetchLobehubSkillConnections);
  const composioSync = useComposio(composio);
  const lobehubSync = useLobehub(lobehub);
  const composioServers = useToolStore(composioStoreSelectors.getServers, isEqual);
  const lobehubServers = useToolStore(lobehubSkillStoreSelectors.getServers, isEqual);
  const activeComposioIds = new Set(
    composioServers
      .filter((s) => s.status === ComposioServerStatus.ACTIVE)
      .map((s) => s.identifier),
  );
  const activeLobehubIds = new Set(
    lobehubServers
      .filter((s) => s.status === LobehubSkillStatus.CONNECTED)
      .map((s) => s.identifier),
  );
  const connectors = useToolStore(connectorSelectors.connectorList, isEqual);
  const connectedOfficialIds = new Set(
    connectors
      .filter((c) => c.status === 'connected' && c.visibility !== 'private')
      .map((c) => c.identifier),
  );
  const tools = buildIntegrationItems({
    pageOnlyProviderIds: CONNECTOR_PAGE_IDS,
    connectorAvailability: { composio, lobehub },
    isComposioActive: (id) => activeComposioIds.has(id),
    isLobehubConnected: (id) => activeLobehubIds.has(id),
  });
  const apps = buildMarketplaceApps({
    channels: messenger ? (channels ?? []) : [],
    isToolConnected: (tool) =>
      tool.type === 'lobehub'
        ? activeLobehubIds.has(tool.provider.id)
        : activeComposioIds.has(tool.serverType.identifier),
    integrationConnected: (id) =>
      (id === 'github' && Boolean(github?.length)) ||
      (id === 'linear' && Boolean(linear.data?.length)),
    installedChannels: new Set(installations?.map((s) => s.platform)),
    isOfficialMcpConnected: (id) => connectedOfficialIds.has(id),
    linkedChannels: new Set(links?.map((s) => s.platform)),
    officialMcpServers: OFFICIAL_MCP_SERVERS,
    tools,
  });
  const syncs = [
    ...(messenger ? [channelsSync, linksSync, installsSync] : []),
    githubSync,
    ...(lobehub ? [lobehubSync] : []),
    ...(composio ? [composioSync] : []),
  ];
  const error = syncs.find((s) => s.error)?.error ?? linear.error;
  const retry = () => {
    void linear.mutate();
    for (const sync of syncs) void sync.revalidate();
  };
  return {
    apps,
    composioServers,
    error,
    lobehubServers,
    lobehubEnabled: lobehub,
    retry,
    loading: !configReady || (messenger && !platformsSettled && !channelsSync.error),
    refreshing: linear.isValidating || syncs.some((s) => s.isValidating),
    toolSync: { composio: composioSync, lobehub: lobehubSync },
  };
};
