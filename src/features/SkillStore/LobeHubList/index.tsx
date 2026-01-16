'use client';

import { KLAVIS_SERVER_TYPES, LOBEHUB_SKILL_PROVIDERS } from '@lobechat/const';
import { createStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';

import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import { klavisStoreSelectors, lobehubSkillStoreSelectors } from '@/store/tool/selectors';
import { KlavisServerStatus } from '@/store/tool/slices/klavisStore';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';

import Empty from '../Empty';
import Item from './Item';

const useStyles = createStyles(({ css }) => ({
  grid: css`
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;

    padding-block-end: 16px;
    padding-inline: 16px;

    @media (max-width: 768px) {
      grid-template-columns: 1fr;
    }
  `,
}));

interface LobeHubListProps {
  keywords: string;
}

export const LobeHubList = memo<LobeHubListProps>(({ keywords }) => {
  const { styles } = useStyles();

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

  const getLobehubSkillServerByProvider = (providerId: string) => {
    return allLobehubSkillServers.find((server) => server.identifier === providerId);
  };

  const getKlavisServerByIdentifier = (identifier: string) => {
    return allKlavisServers.find((server) => server.identifier === identifier);
  };

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
    <div className={styles.grid}>
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
