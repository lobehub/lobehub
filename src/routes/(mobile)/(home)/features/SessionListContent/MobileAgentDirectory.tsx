'use client';

import { type SidebarAgentItem } from '@lobechat/types';
import { Avatar, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Bot } from 'lucide-react';
import { memo, useMemo } from 'react';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import SkeletonList from '../SkeletonList';

const styles = createStaticStyles(({ css, cssVar }) => ({
  avatarFallback: css`
    display: grid;
    place-items: center;

    width: 36px;
    height: 36px;
    border-radius: 12px;

    color: ${cssVar.colorPrimary};

    background: ${cssVar.colorPrimaryBg};
  `,
  item: css`
    padding-block: 12px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  section: css`
    margin-block-start: 8px;
  `,
  title: css`
    padding-block: 10px 6px;
    padding-inline: 16px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

interface MobileAgentDirectoryProps {
  existingSessionIds: string[];
}

const flattenAgents = (agents: {
  agentGroups: Array<{ items: SidebarAgentItem[] }>;
  pinnedAgents: SidebarAgentItem[];
  ungroupedAgents: SidebarAgentItem[];
}) => {
  const map = new Map<string, SidebarAgentItem>();

  [
    ...agents.pinnedAgents,
    ...agents.agentGroups.flatMap((group) => group.items),
    ...agents.ungroupedAgents,
  ]
    .filter((agent) => agent.type !== 'group')
    .forEach((agent) => map.set(agent.id, agent));

  return [...map.values()];
};

const MobileAgentDirectory = memo<MobileAgentDirectoryProps>(({ existingSessionIds }) => {
  const navigate = useWorkspaceAwareNavigate();
  const { isRevalidating } = useFetchAgentList();
  const isInit = useHomeStore(homeAgentListSelectors.isAgentListInit);
  const agentGroups = useHomeStore(homeAgentListSelectors.agentGroups);
  const pinnedAgents = useHomeStore(homeAgentListSelectors.pinnedAgents);
  const ungroupedAgents = useHomeStore(homeAgentListSelectors.ungroupedAgents);

  const missingAgents = useMemo(() => {
    const existing = new Set(existingSessionIds);
    return flattenAgents({ agentGroups, pinnedAgents, ungroupedAgents }).filter(
      (agent) => !existing.has(agent.id),
    );
  }, [agentGroups, existingSessionIds, pinnedAgents, ungroupedAgents]);

  if (!isInit && isRevalidating) return <SkeletonList />;
  if (missingAgents.length === 0) return null;

  return (
    <Flexbox className={styles.section}>
      <Text className={styles.title} fontSize={13} weight={600}>
        Доступные ассистенты
      </Text>
      {missingAgents.map((agent) => (
        <Flexbox
          horizontal
          align="center"
          className={styles.item}
          gap={12}
          key={agent.id}
          onClick={() => navigate(`/agent/${agent.id}`)}
        >
          {typeof agent.avatar === 'string' && agent.avatar ? (
            <Avatar
              avatar={agent.avatar}
              background={agent.backgroundColor || undefined}
              size={36}
            />
          ) : (
            <div className={styles.avatarFallback}>
              <Bot size={18} />
            </div>
          )}
          <Flexbox flex={1} gap={2}>
            <Text weight={600}>{agent.title || 'Без названия'}</Text>
            <Text fontSize={12} type="secondary">
              Ещё нет активного чата на телефоне
            </Text>
          </Flexbox>
        </Flexbox>
      ))}
    </Flexbox>
  );
});

MobileAgentDirectory.displayName = 'MobileAgentDirectory';

export default MobileAgentDirectory;
