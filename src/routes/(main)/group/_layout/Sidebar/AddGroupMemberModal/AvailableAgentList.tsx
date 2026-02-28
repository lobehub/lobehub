'use client';

import { Flexbox, SearchBar, Skeleton } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { type ChangeEvent } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Virtuoso } from 'react-virtuoso';

import AgentSelectionEmpty from '@/features/AgentSelectionEmpty';

import { type AgentItemData } from './AgentItem';
import AgentItem from './AgentItem';

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
}));

interface AvailableAgentListProps {
  agents: AgentItemData[];
  isLoading: boolean;
}

const AvailableAgentList = memo<AvailableAgentListProps>(({ agents, isLoading }) => {
  const { t } = useTranslation(['chat', 'common']);
  const [searchTerm, setSearchTerm] = useState('');

  const defaultTitle = useMemo(() => t('defaultSession', { ns: 'common' }), [t]);

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
            totalCount={filteredAgents.length}
            itemContent={(index) => {
              const agent = filteredAgents[index];
              return (
                <AgentItem showCheckbox agent={agent} defaultTitle={defaultTitle} key={agent.id} />
              );
            }}
          />
        )}
      </Flexbox>
    </Flexbox>
  );
});

export default AvailableAgentList;
