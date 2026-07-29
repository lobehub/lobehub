'use client';

import { Flexbox, SearchBar, Skeleton, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { type ChangeEvent } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Virtuoso } from 'react-virtuoso';

import AgentSelectionEmpty from '@/features/AgentSelectionEmpty';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import { type AgentItemData } from './AgentItem';
import AgentItem from './AgentItem';

type Row = { agent: AgentItemData; type: 'agent' } | { label: string; type: 'header' };

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    user-select: none;

    overflow: hidden;
    display: flex;
    flex: 1;
    flex-direction: column;

    padding-block: ${cssVar.paddingSM}px 0;
    padding-inline: ${cssVar.paddingSM}px;
  `,
  sectionHeader: css`
    padding-block: 6px 4px;
    padding-inline: 8px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

interface AvailableAgentListProps {
  agents: AgentItemData[];
  isLoading: boolean;
}

const AvailableAgentList = memo<AvailableAgentListProps>(({ agents, isLoading }) => {
  const { t } = useTranslation(['chat', 'common']);
  const [searchTerm, setSearchTerm] = useState('');

  const defaultTitle = useMemo(() => t('defaultSession', { ns: 'common' }), [t]);

  // Mirror the CreateGroupModal split: derive private agent ids from the home
  // store so we can bucket the modal's flat list into private/workspace
  // sections without changing the shared `AvailableAgentItem` payload.
  const privateGroups = useHomeStore(homeAgentListSelectors.privateAgentGroups, isEqual);
  const privatePinned = useHomeStore(homeAgentListSelectors.privatePinnedAgents, isEqual);
  const privateUngrouped = useHomeStore(homeAgentListSelectors.privateUngroupedAgents, isEqual);
  const privateAgentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const g of privateGroups) for (const a of g.items) ids.add(a.id);
    for (const a of privatePinned) ids.add(a.id);
    for (const a of privateUngrouped) ids.add(a.id);
    return ids;
  }, [privateGroups, privatePinned, privateUngrouped]);

  const handleSearchChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  }, []);

  // Filter agents based on search term (matches title or description)
  const filteredAgents = useMemo(() => {
    if (!searchTerm.trim()) return agents;

    const searchLower = searchTerm.toLowerCase();
    return agents.filter((agent) => {
      const title = agent.title || '';
      const description = agent.description || '';
      return (
        title.toLowerCase().includes(searchLower) || description.toLowerCase().includes(searchLower)
      );
    });
  }, [agents, searchTerm]);

  const rows = useMemo<Row[]>(() => {
    const privateList: AgentItemData[] = [];
    const workspaceList: AgentItemData[] = [];
    for (const agent of filteredAgents) {
      (privateAgentIds.has(agent.id) ? privateList : workspaceList).push(agent);
    }

    if (privateList.length === 0 || workspaceList.length === 0) {
      return filteredAgents.map((agent) => ({ agent, type: 'agent' }));
    }

    return [
      { label: t('mention.category.privateAgents', { ns: 'chat' }), type: 'header' },
      ...privateList.map((agent) => ({ agent, type: 'agent' as const })),
      { label: t('mention.category.workspaceAgents', { ns: 'chat' }), type: 'header' },
      ...workspaceList.map((agent) => ({ agent, type: 'agent' as const })),
    ];
  }, [filteredAgents, privateAgentIds, t]);

  return (
    <Flexbox className={styles.container} gap={12}>
      <SearchBar
        allowClear
        placeholder={t('memberSelection.searchAgents')}
        value={searchTerm}
        variant="filled"
        onChange={handleSearchChange}
      />

      <Flexbox flex={1} style={{ minHeight: 0 }}>
        {isLoading ? (
          <Flexbox gap={8} padding={8}>
            <Skeleton active paragraph={{ rows: 1 }} title={false} />
            <Skeleton active paragraph={{ rows: 1 }} title={false} />
            <Skeleton active paragraph={{ rows: 1 }} title={false} />
          </Flexbox>
        ) : filteredAgents.length === 0 ? (
          <AgentSelectionEmpty
            search={Boolean(searchTerm)}
            variant={searchTerm ? 'empty' : 'noAvailable'}
          />
        ) : (
          <Virtuoso
            style={{ flex: 1 }}
            totalCount={rows.length}
            itemContent={(index) => {
              const row = rows[index];
              if (row.type === 'header') {
                return (
                  <Text className={styles.sectionHeader} fontSize={12} type="secondary">
                    {row.label}
                  </Text>
                );
              }
              return (
                <AgentItem
                  showCheckbox
                  agent={row.agent}
                  defaultTitle={defaultTitle}
                  key={row.agent.id}
                />
              );
            }}
          />
        )}
      </Flexbox>
    </Flexbox>
  );
});

export default AvailableAgentList;
