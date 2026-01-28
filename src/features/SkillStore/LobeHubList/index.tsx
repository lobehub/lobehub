'use client';

import { KLAVIS_SERVER_TYPES, LOBEHUB_SKILL_PROVIDERS } from '@lobechat/const';
import isEqual from 'fast-deep-equal';
import { memo, useCallback, useMemo } from 'react';

import { createIntegrationDetailModal } from '@/features/IntegrationDetailModal';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import { klavisStoreSelectors, lobehubSkillStoreSelectors } from '@/store/tool/selectors';
import { KlavisServerStatus } from '@/store/tool/slices/klavisStore';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';

import Empty from '../Empty';
import { gridStyles } from '../style';
import Item from './Item';

interface LobeHubListProps {
  keywords: string;
}

export const LobeHubList = memo<LobeHubListProps>(({ keywords }) => {
  const isLobehubSkillEnabled = useServerConfigStore(serverConfigSelectors.enableLobehubSkill);
  const isKlavisEnabled = useServerConfigStore(serverConfigSelectors.enableKlavis);
  const allLobehubSkillServers = useToolStore(lobehubSkillStoreSelectors.getServers, isEqual);
  const allKlavisServers = useToolStore(klavisStoreSelectors.getServers, isEqual);

  const [useFetchLobehubSkillConnections, useFetchUserKlavisServers] = useToolStore((s) => [
    s.useFetchLobehubSkillConnections,
    s.useFetchUserKlavisServers,
  ]);

  useFetchLobehubSkillConnections(isLobehubSkillEnabled);
  useFetchUserKlavisServers(isKlavisEnabled);

  const getLobehubSkillServerByProvider = useCallback(
    (providerId: string) => {
      return allLobehubSkillServers.find((server) => server.identifier === providerId);
    },
    [allLobehubSkillServers],
  );

  const getKlavisServerByIdentifier = useCallback(
    (identifier: string) => {
      return allKlavisServers.find((server) => server.identifier === identifier);
    },
    [allKlavisServers],
  );

  const filteredItems = useMemo(() => {
    const items: Array<
      | { provider: (typeof LOBEHUB_SKILL_PROVIDERS)[number]; type: 'lobehub' }
      | { serverType: (typeof KLAVIS_SERVER_TYPES)[number]; type: 'klavis' }
    > = [];

    // Add LobeHub skills
    if (isLobehubSkillEnabled) {
      for (const provider of LOBEHUB_SKILL_PROVIDERS) {
        items.push({ provider, type: 'lobehub' });
      }
    }

    // Add Klavis skills
    if (isKlavisEnabled) {
      for (const serverType of KLAVIS_SERVER_TYPES) {
        items.push({ serverType, type: 'klavis' });
      }
    }

    // Filter by keywords
    const lowerKeywords = keywords.toLowerCase().trim();
    if (!lowerKeywords) return items;

    return items.filter((item) => {
      const label = item.type === 'lobehub' ? item.provider.label : item.serverType.label;
      return label.toLowerCase().includes(lowerKeywords);
    });
  }, [keywords, isLobehubSkillEnabled, isKlavisEnabled]);

  const hasSearchKeywords = Boolean(keywords && keywords.trim());

  if (filteredItems.length === 0) return <Empty search={hasSearchKeywords} />;

  return (
    <div className={gridStyles.grid}>
      {filteredItems.map((item) => {
        if (item.type === 'lobehub') {
          const server = getLobehubSkillServerByProvider(item.provider.id);
          const isConnected = server?.status === LobehubSkillStatus.CONNECTED;
          return (
            <Item
              description={item.provider.description}
              icon={item.provider.icon}
              identifier={item.provider.id}
              isConnected={isConnected}
              key={item.provider.id}
              label={item.provider.label}
              onOpenDetail={() =>
                createIntegrationDetailModal({ identifier: item.provider.id, type: 'lobehub' })
              }
              type="lobehub"
            />
          );
        }
        const server = getKlavisServerByIdentifier(item.serverType.identifier);
        const isConnected = server?.status === KlavisServerStatus.CONNECTED;
        return (
          <Item
            description={item.serverType.description}
            icon={item.serverType.icon}
            identifier={item.serverType.identifier}
            isConnected={isConnected}
            key={item.serverType.identifier}
            label={item.serverType.label}
            onOpenDetail={() =>
              createIntegrationDetailModal({
                identifier: item.serverType.identifier,
                serverName: item.serverType.serverName,
                type: 'klavis',
              })
            }
            serverName={item.serverType.serverName}
            type="klavis"
          />
        );
      })}
    </div>
  );
});

LobeHubList.displayName = 'LobeHubList';

export default LobeHubList;
