'use client';

import { Flexbox, Grid, Tag, Text } from '@lobehub/ui';
import { Input, Pagination } from 'antd';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AssistantEmpty from '../../../features/AssistantEmpty';
import UserAgentCard from '../../user/features/UserAgentCard';
import { useWorkspaceDetailContext } from './DetailProvider';
import {
  filterWorkspaceMarketItems,
  type WorkspaceMarketStatusFilterValue,
} from './filterWorkspaceMarketItems';
import WorkspaceStatusFilter from './WorkspaceStatusFilter';

interface WorkspaceAgentListProps {
  pageSize?: number;
  rows?: number;
}

const WorkspaceAgentList = memo<WorkspaceAgentListProps>(({ rows = 4, pageSize = 8 }) => {
  const { t } = useTranslation('discover');
  const { agents, agentCount, canEdit } = useWorkspaceDetailContext();
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<WorkspaceMarketStatusFilterValue>('published');

  const filteredAgents = useMemo(() => {
    return filterWorkspaceMarketItems({
      getDescription: (agent) => agent.description,
      getTitle: (agent) => agent.title,
      items: agents,
      searchQuery,
      status: statusFilter,
    });
  }, [agents, searchQuery, statusFilter]);

  const paginatedAgents = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredAgents.slice(startIndex, startIndex + pageSize);
  }, [filteredAgents, currentPage, pageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter]);

  // Visitors with nothing to see get the full-page empty state; editors always keep the
  // title + search + status filter row (matching the User page's "published agents").
  if (agents.length === 0 && !canEdit) {
    return (
      <AssistantEmpty description={t('user.workspace.noAgents')} title={t('user.noAgents.title')} />
    );
  }

  const isEmpty = agents.length === 0;
  const showPagination = filteredAgents.length > pageSize;

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Text fontSize={16} weight={500}>
            {t('user.publishedAgents')}
          </Text>
          {agentCount > 0 && <Tag>{filteredAgents.length}</Tag>}
        </Flexbox>
        {canEdit && (
          <Flexbox horizontal align={'center'} gap={8}>
            <Input.Search
              allowClear
              placeholder={t('user.searchPlaceholder')}
              style={{ width: 200 }}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <WorkspaceStatusFilter value={statusFilter} onChange={setStatusFilter} />
          </Flexbox>
        )}
      </Flexbox>
      {isEmpty ? (
        <AssistantEmpty
          description={t('user.workspace.noAgents')}
          title={t('user.noAgents.title')}
        />
      ) : (
        <Grid rows={rows} width={'100%'}>
          {paginatedAgents.map((item, index) => (
            <UserAgentCard key={item.identifier || index} {...item} />
          ))}
        </Grid>
      )}
      {showPagination && (
        <Flexbox align={'center'} justify={'center'}>
          <Pagination
            current={currentPage}
            pageSize={pageSize}
            showSizeChanger={false}
            total={filteredAgents.length}
            onChange={(page) => setCurrentPage(page)}
          />
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default WorkspaceAgentList;
