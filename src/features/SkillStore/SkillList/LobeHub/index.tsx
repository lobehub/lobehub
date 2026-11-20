'use client';

import { getConnectorCatalog } from '@lobechat/const';
import { cx } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo, useCallback, useMemo } from 'react';

import { SkillListVariantProvider } from '@/features/Settings/skill/features/SkillListRow';
import {
  createComposioSkillDetailModal,
  createLobehubSkillDetailModal,
} from '@/features/SkillStore/SkillDetail';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import { composioStoreSelectors, lobehubSkillStoreSelectors } from '@/store/tool/selectors';
import { ComposioServerStatus } from '@/store/tool/slices/composioStore';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';

import Empty from '../Empty';
import { gridStyles } from '../style';
import WantMoreSkills from '../WantMoreSkills';
import Item from './Item';

interface LobeHubListProps {
  keywords: string;
}

export const LobeHubList = memo<LobeHubListProps>(({ keywords }) => {
  const isLobehubSkillEnabled = useServerConfigStore(serverConfigSelectors.enableLobehubSkill);
  const isComposioEnabled = useServerConfigStore(serverConfigSelectors.enableComposio);
  const allLobehubSkillServers = useToolStore(lobehubSkillStoreSelectors.getServers, isEqual);
  const allComposioServers = useToolStore(composioStoreSelectors.getServers, isEqual);

  const [useFetchLobehubSkillConnections, useFetchUserComposioConnections] = useToolStore((s) => [
    s.useFetchLobehubSkillConnections,
    s.useFetchUserComposioConnections,
  ]);

  useFetchLobehubSkillConnections(isLobehubSkillEnabled);
  useFetchUserComposioConnections(isComposioEnabled);

  const getLobehubSkillServerByProvider = useCallback(
    (providerId: string) => {
      return allLobehubSkillServers.find((server) => server.identifier === providerId);
    },
    [allLobehubSkillServers],
  );

  const getComposioServerByIdentifier = useCallback(
    (identifier: string) => {
      return allComposioServers.find((server) => server.identifier === identifier);
    },
    [allComposioServers],
  );

  const filteredItems = useMemo(() => {
    const items = getConnectorCatalog({
      composio: isComposioEnabled,
      lobehub: isLobehubSkillEnabled,
    });

    // Filter by keywords
    const lowerKeywords = keywords.toLowerCase().trim();
    if (!lowerKeywords) return items;

    return items.filter((item) => {
      const label = item.type === 'lobehub' ? item.provider.label : item.serverType.label;
      return label.toLowerCase().includes(lowerKeywords);
    });
  }, [keywords, isLobehubSkillEnabled, isComposioEnabled]);

  const hasSearchKeywords = Boolean(keywords && keywords.trim());

  if (filteredItems.length === 0) return <Empty search={hasSearchKeywords} />;

  return (
    // Same Codex-style rows as the Connectors page: borderless, icon first, `+` / `⋯` last.
    <SkillListVariantProvider value={'page'}>
      <div className={cx(gridStyles.grid, gridStyles.rows)}>
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
                type="lobehub"
                onOpenDetail={() => createLobehubSkillDetailModal({ identifier: item.provider.id })}
              />
            );
          }
          const server = getComposioServerByIdentifier(item.serverType.identifier);
          const isConnected = server?.status === ComposioServerStatus.ACTIVE;
          return (
            <Item
              description={item.serverType.description}
              icon={item.serverType.icon}
              identifier={item.serverType.identifier}
              isConnected={isConnected}
              key={item.serverType.identifier}
              label={item.serverType.label}
              serverName={item.serverType.appSlug}
              type="composio"
              onOpenDetail={() =>
                createComposioSkillDetailModal({
                  identifier: item.serverType.identifier,
                  serverName: item.serverType.appSlug,
                })
              }
            />
          );
        })}
      </div>
      <WantMoreSkills />
    </SkillListVariantProvider>
  );
});

LobeHubList.displayName = 'LobeHubList';

export default LobeHubList;
