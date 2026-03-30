'use client';

import { Flexbox, Grid, Tag, Text } from '@lobehub/ui';
import { Input, Pagination } from 'antd';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserDetailContext } from './DetailProvider';
import UserPluginCard from './UserPluginCard';

interface UserPluginListProps {
  pageSize?: number;
  rows?: number;
}

const UserPluginList = memo<UserPluginListProps>(({ rows = 4, pageSize = 8 }) => {
  const { t } = useTranslation('discover');
  const { plugins = [], isOwner } = useUserDetailContext();
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredPlugins = useMemo(() => {
    let allPlugins = [...plugins];

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      allPlugins = allPlugins.filter((plugin) => {
        const title = plugin?.title?.toLowerCase() || '';
        const description = plugin?.description?.toLowerCase() || '';
        return title.includes(query) || description.includes(query);
      });
    }

    return allPlugins;
  }, [plugins, searchQuery]);

  const paginatedPlugins = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredPlugins.slice(startIndex, startIndex + pageSize);
  }, [filteredPlugins, currentPage, pageSize]);

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  if (plugins.length === 0) return null;

  const showPagination = filteredPlugins.length > pageSize;

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Text fontSize={16} weight={500}>
            {t('user.plugins')}
          </Text>
          {plugins.length > 0 && <Tag>{filteredPlugins.length}</Tag>}
        </Flexbox>
        {isOwner && plugins.length > 0 && (
          <Input.Search
            allowClear
            placeholder={t('user.searchPlaceholder')}
            style={{ width: 200 }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        )}
      </Flexbox>
      <Grid rows={rows} width={'100%'}>
        {paginatedPlugins.map((item, index) => (
          <UserPluginCard key={item.identifier || index} {...item} />
        ))}
      </Grid>
      {showPagination && (
        <Flexbox align={'center'} justify={'center'}>
          <Pagination
            current={currentPage}
            pageSize={pageSize}
            showSizeChanger={false}
            total={filteredPlugins.length}
            onChange={(page) => setCurrentPage(page)}
          />
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default UserPluginList;
