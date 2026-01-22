'use client';

import { KLAVIS_SERVER_TYPES, LOBEHUB_SKILL_PROVIDERS } from '@lobechat/const';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import type { Klavis } from 'klavis';
import { memo, useMemo, useState } from 'react';

import IntegrationDetailModal from '@/features/IntegrationDetailModal';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import { klavisStoreSelectors, lobehubSkillStoreSelectors } from '@/store/tool/selectors';
import { KlavisServerStatus } from '@/store/tool/slices/klavisStore';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';

import Empty from '../Empty';
import Item from './Item';
import { useSkillConnect } from './useSkillConnect';

const styles = createStaticStyles(({ css }) => ({
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

interface DetailState {
  identifier: string;
  serverName?: Klavis.McpServerName;
  type: 'klavis' | 'lobehub';
}

interface DetailModalWithConnectProps {
  detailState: DetailState;
  onClose: () => void;
}

const DetailModalWithConnect = memo<DetailModalWithConnectProps>(({ detailState, onClose }) => {
  const { handleConnect, isConnecting } = useSkillConnect({
    identifier: detailState.identifier,
    serverName: detailState.serverName,
    type: detailState.type,
  });

  return (
    <IntegrationDetailModal
      identifier={detailState.identifier}
      isConnecting={isConnecting}
      onClose={onClose}
      onConnect={handleConnect}
      open
      type={detailState.type}
    />
  );
});

DetailModalWithConnect.displayName = 'DetailModalWithConnect';

export const LobeHubList = memo<LobeHubListProps>(({ keywords }) => {
  const [detailState, setDetailState] = useState<DetailState | null>(null);

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
    <>
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
                onOpenDetail={() =>
                  setDetailState({ identifier: item.provider.id, type: 'lobehub' })
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
                setDetailState({
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
      {detailState && (
        <DetailModalWithConnect
          detailState={detailState}
          onClose={() => setDetailState(null)}
        />
      )}
    </>
  );
});

LobeHubList.displayName = 'LobeHubList';

export default LobeHubList;
