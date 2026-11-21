import isEqual from 'fast-deep-equal';

import { buildIntegrationItems } from '@/features/Settings/skill/features/connectorSections';
import { integrationActions, integrationSelectors, useIntegrationStore } from '@/store/integration';
import { messengerActions, messengerSelectors, useMessengerStore } from '@/store/messenger';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import { composioStoreSelectors, lobehubSkillStoreSelectors } from '@/store/tool/selectors';
import { ComposioServerStatus } from '@/store/tool/slices/composioStore';
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
  const githubSync = integrationActions.useFetchGithubInstallations(lobehub);
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
  const tools = buildIntegrationItems({
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
    githubInstalled: Boolean(github?.length),
    installedChannels: new Set(installations?.map((s) => s.platform)),
    linkedChannels: new Set(links?.map((s) => s.platform)),
    tools,
  });
  const syncs = [
    ...(messenger ? [channelsSync, linksSync, installsSync] : []),
    ...(lobehub ? [lobehubSync, githubSync] : []),
    ...(composio ? [composioSync] : []),
  ];
  const error = syncs.find((s) => s.error)?.error;
  const retry = () => {
    for (const sync of syncs) void sync.revalidate();
  };
  return {
    apps,
    composioServers,
    error,
    lobehubServers,
    retry,
    loading: !configReady || (messenger && !platformsSettled && !channelsSync.error),
    refreshing: syncs.some((s) => s.isValidating),
    toolSync: { composio: composioSync, lobehub: lobehubSync },
  };
};
