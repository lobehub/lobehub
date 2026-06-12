'use client';

import { COMPOSIO_APP_TYPES, LOBEHUB_SKILL_PROVIDERS } from '@lobechat/const';
import { type BuiltinSkill, type LobeToolMeta } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  createBuiltinAgentSkillDetailModal,
  createBuiltinSkillDetailModal,
  createComposioSkillDetailModal,
  createLobehubSkillDetailModal,
} from '@/features/SkillStore/SkillDetail';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import { type ToolStoreState } from '@/store/tool/initialState';
import { composioStoreSelectors, lobehubSkillStoreSelectors } from '@/store/tool/selectors';
import { ComposioServerStatus } from '@/store/tool/slices/composioStore';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';

import BuiltinItem from '../Builtin/Item';
import Empty from '../Empty';
import { gridStyles } from '../style';
import WantMoreSkills from '../WantMoreSkills';
import Item from './Item';

interface LobeHubListProps {
  keywords: string;
}

// Selector to get only actual builtin tools (not including Composio)
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
  const isComposioEnabled = useServerConfigStore(serverConfigSelectors.enableComposio);
  const allLobehubSkillServers = useToolStore(lobehubSkillStoreSelectors.getServers, isEqual);
  const allComposioServers = useToolStore(composioStoreSelectors.getServers, isEqual);
  // Use custom selector to get only actual builtin tools (not Composio)
  const builtinTools = useToolStore(getBuiltinToolsOnly, isEqual);
  const builtinSkills = useToolStore((s) => s.builtinSkills, isEqual);

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
    const items: Array<
      | { provider: (typeof LOBEHUB_SKILL_PROVIDERS)[number]; type: 'lobehub' }
      | { serverType: (typeof COMPOSIO_APP_TYPES)[number]; type: 'composio' }
      | { skill: BuiltinSkill; type: 'builtinAgentSkill' }
      | { tool: LobeToolMeta; type: 'builtin' }
    > = [];

    // Add builtin agent skills first
    for (const skill of builtinSkills) {
      items.push({ skill, type: 'builtinAgentSkill' });
    }

    // Add builtin tools
    for (const tool of builtinTools) {
      items.push({ tool, type: 'builtin' });
    }

    // Add LobeHub skills
    if (isLobehubSkillEnabled) {
      for (const provider of LOBEHUB_SKILL_PROVIDERS) {
        items.push({ provider, type: 'lobehub' });
      }
    }

    // Add Composio skills
    if (isComposioEnabled) {
      for (const serverType of COMPOSIO_APP_TYPES) {
        items.push({ serverType, type: 'composio' });
      }
    }

    // Filter by keywords
    const lowerKeywords = keywords.toLowerCase().trim();
    if (!lowerKeywords) return items;

    return items.filter((item) => {
      if (item.type === 'builtinAgentSkill') {
        const name = item.skill.name.toLowerCase();
        const identifier = item.skill.identifier.toLowerCase();
        return name.includes(lowerKeywords) || identifier.includes(lowerKeywords);
      }
      if (item.type === 'builtin') {
        const title = item.tool.meta?.title?.toLowerCase() || '';
        const identifier = item.tool.identifier?.toLowerCase() || '';
        return title.includes(lowerKeywords) || identifier.includes(lowerKeywords);
      }
      const label = item.type === 'lobehub' ? item.provider.label : item.serverType.label;
      return label.toLowerCase().includes(lowerKeywords);
    });
  }, [keywords, isLobehubSkillEnabled, isComposioEnabled, builtinTools, builtinSkills]);

  const hasSearchKeywords = Boolean(keywords && keywords.trim());

  if (filteredItems.length === 0) return <Empty search={hasSearchKeywords} />;

  return (
    <>
      <div className={gridStyles.grid}>
        {filteredItems.map((item) => {
          if (item.type === 'builtinAgentSkill') {
            const localizedTitle = t(`tools.builtins.${item.skill.identifier}.title`, {
              defaultValue: item.skill.name,
            });
            const localizedDescription = t(`tools.builtins.${item.skill.identifier}.description`, {
              defaultValue: item.skill.description,
            });
            return (
              <BuiltinItem
                avatar={item.skill.avatar}
                description={localizedDescription}
                identifier={item.skill.identifier}
                key={item.skill.identifier}
                title={localizedTitle}
                onOpenDetail={() =>
                  createBuiltinAgentSkillDetailModal({ identifier: item.skill.identifier })
                }
              />
            );
          }
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
    </>
  );
});

LobeHubList.displayName = 'LobeHubList';

export default LobeHubList;
