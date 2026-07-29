'use client';

import type { SidebarAgentItem } from '@lobechat/types';
import { Avatar, Block, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { DEFAULT_AVATAR, DEFAULT_INBOX_AVATAR } from '@/const/meta';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  active: css`
    background: ${cssVar.colorFillTertiary};
  `,
  item: css`
    cursor: pointer;
    padding-block: 6px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  list: css`
    padding: 8px;
  `,
}));

interface AgentListProps {
  activeAgentId: string;
  error?: unknown;
  onRetry?: () => void;
  onSelect: (agentId: string) => void;
}

interface AgentRow {
  avatar?: string;
  backgroundColor?: string;
  id: string;
  title: string;
}

const AgentList = memo<AgentListProps>(({ activeAgentId, error, onRetry, onSelect }) => {
  const { t } = useTranslation('chat');
  const isInit = useHomeStore(homeAgentListSelectors.isAgentListInit);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const inboxMeta = useAgentStore(agentSelectors.getAgentMetaById(inboxAgentId ?? ''));
  const allAgents = useHomeStore(homeAgentListSelectors.allAgents);

  const rows = useMemo<AgentRow[]>(() => {
    const seen = new Set<string>();
    const result: AgentRow[] = [];

    if (inboxAgentId) {
      result.push({
        avatar:
          (typeof inboxMeta.avatar === 'string' ? inboxMeta.avatar : undefined) ??
          DEFAULT_INBOX_AVATAR,
        backgroundColor: inboxMeta.backgroundColor || undefined,
        id: inboxAgentId,
        title: inboxMeta.title || 'Lobe AI',
      });
      seen.add(inboxAgentId);
    }

    for (const item of allAgents as SidebarAgentItem[]) {
      if (item.type !== 'agent' || seen.has(item.id)) continue;

      seen.add(item.id);
      result.push({
        avatar: typeof item.avatar === 'string' ? item.avatar : undefined,
        backgroundColor: item.backgroundColor || undefined,
        id: item.id,
        title: item.title || t('untitledAgent'),
      });
    }

    return result;
  }, [allAgents, inboxAgentId, inboxMeta, t]);

  return (
    <AsyncBoundary
      data={isInit ? allAgents : undefined}
      error={error}
      errorVariant={'block'}
      isLoading={!isInit && !error}
      loading={<SkeletonList rows={6} style={{ padding: 8 }} />}
      onRetry={onRetry}
    >
      <Flexbox
        className={styles.list}
        gap={2}
        style={{ maxHeight: 360, overflowY: 'auto', width: '100%' }}
      >
        {rows.map((row) => {
          const isActive = row.id === activeAgentId;

          return (
            <Block
              clickable
              horizontal
              align={'center'}
              className={`${styles.item} ${isActive ? styles.active : ''}`}
              gap={8}
              key={row.id}
              variant={'borderless'}
              onClick={() => onSelect(row.id)}
            >
              <Avatar
                avatar={row.avatar || DEFAULT_AVATAR}
                background={row.backgroundColor}
                shape={'square'}
                size={24}
              />
              <Text
                ellipsis
                color={isActive ? cssVar.colorText : cssVar.colorTextSecondary}
                style={{ flex: 1 }}
                weight={isActive ? 600 : 500}
              >
                {row.title}
              </Text>
            </Block>
          );
        })}
      </Flexbox>
    </AsyncBoundary>
  );
});

export default AgentList;
