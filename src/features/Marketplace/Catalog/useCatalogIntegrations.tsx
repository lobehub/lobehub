'use client';

import isEqual from 'fast-deep-equal';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import ComposioSkillItem from '@/features/Settings/skill/features/ComposioSkillItem';
import {
  buildIntegrationItems,
  matchesIntegrationKeyword,
} from '@/features/Settings/skill/features/connectorSections';
import LobehubSkillItem from '@/features/Settings/skill/features/LobehubSkillItem';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import { composioStoreSelectors, lobehubSkillStoreSelectors } from '@/store/tool/selectors';
import { ComposioServerStatus } from '@/store/tool/slices/composioStore';
import { connectorSelectors, isIntegrationInConnectorTab } from '@/store/tool/slices/connector';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';

import { buildInstalledDetailPath, getInstalledVisibility } from '../InstalledNav';
import { useCatalogDetailNavigate } from './useCatalogDetailNavigate';

export const useCatalogIntegrations = (keyword?: string) => {
  const { t } = useTranslation('setting');
  const navigate = useCatalogDetailNavigate();
  const visibility = getInstalledVisibility('connector', useActiveWorkspaceId(), null);
  const composio = useServerConfigStore(serverConfigSelectors.enableComposio);
  const lobehub = useServerConfigStore(serverConfigSelectors.enableLobehubSkill);

  const useLobehubConnections = useToolStore((s) => s.useFetchLobehubSkillConnections);
  const useComposioConnections = useToolStore((s) => s.useFetchUserComposioConnections);
  useLobehubConnections(lobehub);
  useComposioConnections(composio);

  const connectors = useToolStore(connectorSelectors.connectorList, isEqual);
  const lobehubServers = useToolStore(lobehubSkillStoreSelectors.getServers, isEqual);
  const composioServers = useToolStore(composioStoreSelectors.getServers, isEqual);
  const lobehubById = new Map(lobehubServers.map((server) => [server.identifier, server]));
  const composioById = new Map(composioServers.map((server) => [server.identifier, server]));

  const matches = buildIntegrationItems({
    connectorAvailability: { composio, lobehub },
    isComposioActive: (id) => composioById.get(id)?.status === ComposioServerStatus.ACTIVE,
    isLobehubConnected: (id) => lobehubById.get(id)?.status === LobehubSkillStatus.CONNECTED,
  }).filter((item) => {
    if (!matchesIntegrationKeyword(item, keyword, t)) return false;
    if (item.type === 'lobehub')
      return isIntegrationInConnectorTab(item.provider.id, connectors, visibility);

    const id = item.serverType.identifier;
    return isIntegrationInConnectorTab(
      id,
      connectors,
      visibility,
      composioById.get(id)?.connectedAccountId,
    );
  });

  return matches.map((item) => {
    if (item.type === 'lobehub') {
      const id = item.provider.id;
      return (
        <LobehubSkillItem
          key={id}
          provider={item.provider}
          server={lobehubById.get(id)}
          onSelect={() =>
            navigate(buildInstalledDetailPath('connector', id, 'lobehub-connector', visibility))
          }
        />
      );
    }

    const id = item.serverType.identifier;
    return (
      <ComposioSkillItem
        key={id}
        server={composioById.get(id)}
        serverType={item.serverType}
        onSelect={() => navigate(buildInstalledDetailPath('connector', id, 'plugin', visibility))}
      />
    );
  });
};
