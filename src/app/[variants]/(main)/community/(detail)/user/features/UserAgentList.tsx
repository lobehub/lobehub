'use client';

import { Flexbox, Grid, Tag, Text } from '@lobehub/ui';
import { Input, Pagination } from 'antd';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AssistantEmpty from '../../../features/AssistantEmpty';
import { useUserDetailContext } from './DetailProvider';
import StatusFilter, { type StatusFilterValue } from './StatusFilter';
import UserAgentCard from './UserAgentCard';

interface UserAgentListProps {
  pageSize?: number;
  rows?: number;
}

const UserAgentList = memo<UserAgentListProps>(({ rows = 4, pageSize = 8 }) => {
  const { t } = useTranslation('discover');
  const { agents, agentCount, forkedAgents = [], favoriteAgents = [], isOwner } = useUserDetailContext();
  const [currentPage, setCurrentPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('published');
  const [searchQuery, setSearchQuery] = useState('');

  // Combine agents and forked agents, then filter based on status and search
  const filteredAgents = useMemo(() => {
    let allAgents = [...agents];

    if (statusFilter === 'forked') {
      // Show only forked agents (those with forkedFromAgentId)
      allAgents = forkedAgents;
    } else if (statusFilter === 'favorite') {
      // Show only favorited agents
      allAgents = favoriteAgents;
    } else {
      // Filter by status for non-forked agents
      allAgents = allAgents.filter((agent) => {
        return agent.status === statusFilter;
      });
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      allAgents = allAgents.filter((agent) => {
        console.log('agent', agent);
        const name = agent?.title?.toLowerCase() || '';
        const description = agent?.description?.toLowerCase() || '';
        return name.includes(query) || description.includes(query);
      });
    }

    return allAgents;
  }, [agents, forkedAgents, statusFilter, searchQuery]);

  const paginatedAgents = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredAgents.slice(startIndex, startIndex + pageSize);
  }, [filteredAgents, currentPage, pageSize]);

  // Reset to page 1 when filter or search changes
  useMemo(() => {
    setCurrentPage(1);
  }, [statusFilter, searchQuery]);

  if (agents.length === 0 && forkedAgents.length === 0) return <AssistantEmpty />;

  const showPagination = filteredAgents.length > pageSize;

  return (
    <Flexbox gap={16}>
      <Flexbox align={'center'} gap={8} horizontal justify={'space-between'}>
        <Flexbox align={'center'} gap={8} horizontal>
          <Text fontSize={16} weight={500}>
            {t('user.publishedAgents')}
          </Text>
          {agentCount > 0 && <Tag>{filteredAgents.length}</Tag>}
        </Flexbox>
        {isOwner && (
          <Flexbox align={'center'} gap={8} horizontal>
            <Input.Search
              allowClear
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('user.searchPlaceholder')}
              style={{ width: 200 }}
              value={searchQuery}
            />
            <StatusFilter
              onChange={(value) => setStatusFilter(value)}
              value={statusFilter}
            />
          </Flexbox>
        )}
      </Flexbox>
      <Grid rows={rows} width={'100%'}>
        {paginatedAgents.map((item, index) => (
          <UserAgentCard key={item.identifier || index} {...item} />
        ))}
      </Grid>
      {showPagination && (
        <Flexbox align={'center'} justify={'center'}>
          <Pagination
            current={currentPage}
            onChange={(page) => setCurrentPage(page)}
            pageSize={pageSize}
            showSizeChanger={false}
            total={filteredAgents.length}
          />
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default UserAgentList;
