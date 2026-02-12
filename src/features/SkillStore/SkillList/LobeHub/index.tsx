'use client';

import { KLAVIS_SERVER_TYPES, LOBEHUB_SKILL_PROVIDERS } from '@lobechat/const';
import { type LobeToolMeta } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  createBuiltinSkillDetailModal,
  createKlavisSkillDetailModal,
  createLobehubSkillDetailModal,
} from '@/features/SkillStore/SkillDetail';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import { type ToolStoreState } from '@/store/tool/initialState';
import { klavisStoreSelectors, lobehubSkillStoreSelectors } from '@/store/tool/selectors';
import { KlavisServerStatus } from '@/store/tool/slices/klavisStore';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';

import BuiltinItem from '../Builtin/Item';
import Empty from '../Empty';
import { gridStyles } from '../style';
import WantMoreSkills from '../WantMoreSkills';
import Item from './Item';

interface LobeHubListProps {
  keywords: string;
}

// Selector to get only actual builtin tools (not including Klavis)
const getBuiltinToolsOnly = (s: ToolStoreState): LobeToolMeta[] => {
  return s.builtinTools
    .filter((item) => !item.hidden)
    .map((t) => ({
      author: 'LobeHub',
      identifier: t.identifier,
      meta: t.manifest.meta,
      type: 'builtin' as const,
    }));
};

export const LobeHubList = memo<LobeHubListProps>(({ keywords }) => {
  const { t } = useTranslation('setting');
  const isLobehubSkillEnabled = useServerConfigStore(serverConfigSelectors.enableLobehubSkill);
  const isKlavisEnabled = useServerConfigStore(serverConfigSelectors.enableKlavis);
  const allLobehubSkillServers = useToolStore(lobehubSkillStoreSelectors.getServers, isEqual);
  const allKlavisServers = useToolStore(klavisStoreSelectors.getServers, isEqual);
  // Use custom selector to get only actual builtin tools (not Klavis)
  const builtinTools = useToolStore(getBuiltinToolsOnly, isEqual);

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
      | { tool: LobeToolMeta; type: 'builtin' }
    > = [];

    // Add builtin tools first
    for (const tool of builtinTools) {
      items.push({ tool, type: 'builtin' });
    }

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
      if (item.type === 'builtin') {
        const title = item.tool.meta?.title?.toLowerCase() || '';
        const identifier = item.tool.identifier?.toLowerCase() || '';
        return title.includes(lowerKeywords) || identifier.includes(lowerKeywords);
      }
      const label = item.type === 'lobehub' ? item.provider.label : item.serverType.label;
      return label.toLowerCase().includes(lowerKeywords);
    });
  }, [keywords, isLobehubSkillEnabled, isKlavisEnabled, builtinTools]);

  const hasSearchKeywords = Boolean(keywords && keywords.trim());

  if (filteredItems.length === 0) return <Empty search={hasSearchKeywords} />;

  return (
    <>
      <div className={gridStyles.grid}>
        {filteredItems.map((item) => {
          if (item.type === 'builtin') {
            const localizedTitle = t(`tools.builtins.${item.tool.identifier}.title`, {
              defaultValue: item.tool.meta?.title || item.tool.identifier,
            });
            const localizedDescription = t(`tools.builtins.${item.tool.identifier}.description`, {
              defaultValue: item.tool.meta?.description || '',
            });
            return (
              <BuiltinItem
                avatar={item.tool.meta?.avatar}
                description={localizedDescription}
                identifier={item.tool.identifier}
                key={item.tool.identifier}
                title={localizedTitle}
                onOpenDetail={() =>
                  createBuiltinSkillDetailModal({ identifier: item.tool.identifier })
                }
              />
            );
          }
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
              onOpenDetail={() =>
                createKlavisSkillDetailModal({
                  identifier: item.serverType.identifier,
                  serverName: item.serverType.serverName,
                })
              }
            />
          );
        })}
      </div>
      <WantMoreSkills />
    </>
  );
});

LobeHubList.displayName = 'LobeHubList';

export default LobeHubList;
