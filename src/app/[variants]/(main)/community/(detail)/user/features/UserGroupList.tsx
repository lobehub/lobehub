'use client';

import { Flexbox, Grid, Tag, Text } from '@lobehub/ui';
import { Input, Pagination } from 'antd';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserDetailContext } from './DetailProvider';
import StatusFilter, { type StatusFilterValue } from './StatusFilter';
import UserGroupCard from './UserGroupCard';

interface UserGroupListProps {
  pageSize?: number;
  rows?: number;
}

const UserGroupList = memo<UserGroupListProps>(({ rows = 4, pageSize = 8 }) => {
  const { t } = useTranslation('discover');
  const { agentGroups = [], groupCount, forkedAgentGroups = [], favoriteAgentGroups = [], isOwner } = useUserDetailContext();
  const [currentPage, setCurrentPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('published');
  const [searchQuery, setSearchQuery] = useState('');

  // Combine groups and forked groups, then filter based on status and search
  const filteredGroups = useMemo(() => {
    let allGroups = [...agentGroups];

    if (statusFilter === 'forked') {
      // Show only forked groups (those with forkedFromAgentId)
      allGroups = forkedAgentGroups;
    } else if (statusFilter === 'favorite') {
      // Show only favorited groups
      allGroups = favoriteAgentGroups;
    } else {
      // Filter by status for non-forked groups
      allGroups = allGroups.filter((group) => {
        return group.status === statusFilter;
      });
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      allGroups = allGroups.filter((group) => {
        const name = group?.title?.toLowerCase() || '';
        const description = group?.description?.toLowerCase() || '';
        return name.includes(query) || description.includes(query);
      });
    }

    return allGroups;
  }, [agentGroups, forkedAgentGroups, statusFilter, searchQuery]);

  const paginatedGroups = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredGroups.slice(startIndex, startIndex + pageSize);
  }, [filteredGroups, currentPage, pageSize]);

  // Reset to page 1 when filter or search changes
  useMemo(() => {
    setCurrentPage(1);
  }, [statusFilter, searchQuery]);

  if (agentGroups.length === 0 && forkedAgentGroups.length === 0) return null;

  const showPagination = filteredGroups.length > pageSize;

  return (
    <Flexbox gap={16}>
      <Flexbox align={'center'} gap={8} horizontal justify={'space-between'}>
        <Flexbox align={'center'} gap={8} horizontal>
          <Text fontSize={16} weight={500}>
            {t('user.publishedGroups', { defaultValue: '创作的群组' })}
          </Text>
          {groupCount > 0 && <Tag>{filteredGroups.length}</Tag>}
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
        {paginatedGroups.map((item, index) => (
          <UserGroupCard key={item.identifier || index} {...item} />
        ))}
      </Grid>
      {showPagination && (
        <Flexbox align={'center'} justify={'center'}>
          <Pagination
            current={currentPage}
            onChange={(page) => setCurrentPage(page)}
            pageSize={pageSize}
            showSizeChanger={false}
            total={filteredGroups.length}
          />
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default UserGroupList;
