'use client';

import { Flexbox, Grid, Tag, Text } from '@lobehub/ui';
import { Input, Pagination } from 'antd';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import UserPluginCard from '../../user/features/UserPluginCard';
import { useWorkspaceDetailContext } from './DetailProvider';

interface WorkspacePluginListProps {
  pageSize?: number;
  rows?: number;
}

const WorkspacePluginList = memo<WorkspacePluginListProps>(({ rows = 4, pageSize = 8 }) => {
  const { t } = useTranslation('discover');
  const { plugins = [], canEdit } = useWorkspaceDetailContext();
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredPlugins = useMemo(() => {
    let list = [...plugins];
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      list = list.filter((plugin) => {
        const title = plugin?.title?.toLowerCase() || '';
        const description = plugin?.description?.toLowerCase() || '';
        return title.includes(query) || description.includes(query);
      });
    }
    return list;
  }, [plugins, searchQuery]);

  const paginatedPlugins = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredPlugins.slice(startIndex, startIndex + pageSize);
  }, [filteredPlugins, currentPage, pageSize]);

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
        {canEdit && plugins.length > 0 && (
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

export default WorkspacePluginList;
