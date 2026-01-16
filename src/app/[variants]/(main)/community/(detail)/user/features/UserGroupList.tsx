'use client';

import { Flexbox, Grid, Tag, Text } from '@lobehub/ui';
import { Pagination } from 'antd';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AssistantEmpty from '../../../features/AssistantEmpty';
import { useUserDetailContext } from './DetailProvider';
import UserGroupCard from './UserGroupCard';

interface UserGroupListProps {
  pageSize?: number;
  rows?: number;
}

const UserGroupList = memo<UserGroupListProps>(({ rows = 4, pageSize = 10 }) => {
  const { t } = useTranslation('discover');
  const { agentGroups, groupCount } = useUserDetailContext();
  const [currentPage, setCurrentPage] = useState(1);

  const paginatedGroups = useMemo(() => {
    if (!agentGroups) return [];
    const startIndex = (currentPage - 1) * pageSize;
    return agentGroups.slice(startIndex, startIndex + pageSize);
  }, [agentGroups, currentPage, pageSize]);

  if (!agentGroups || agentGroups.length === 0) return null;

  const showPagination = agentGroups.length > pageSize;

  return (
    <Flexbox gap={16}>
      <Flexbox align={'center'} gap={8} horizontal>
        <Text fontSize={16} weight={500}>
          {t('user.publishedGroups', { defaultValue: '创作的群组' })}
        </Text>
        {groupCount > 0 && <Tag>{groupCount}</Tag>}
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
            total={agentGroups.length}
          />
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default UserGroupList;
