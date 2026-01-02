'use client';

import { Flexbox, Grid, Tag, Text } from '@lobehub/ui';
import { Pagination } from 'antd';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AssistantEmpty from '../../../features/AssistantEmpty';
import { useUserDetailContext } from './DetailProvider';
import UserAgentCard from './UserAgentCard';

interface UserAgentListProps {
  pageSize?: number;
  rows?: number;
}

const UserAgentList = memo<UserAgentListProps>(({ rows = 4, pageSize = 10 }) => {
  const { t } = useTranslation('discover');
  const { agents, agentCount } = useUserDetailContext();
  const [currentPage, setCurrentPage] = useState(1);

  const paginatedAgents = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return agents.slice(startIndex, startIndex + pageSize);
  }, [agents, currentPage, pageSize]);

  if (agents.length === 0) return <AssistantEmpty />;

  const showPagination = agents.length > pageSize;

  return (
    <Flexbox gap={16}>
      <Flexbox align={'center'} gap={8} horizontal>
        <Text fontSize={16} weight={500}>
          {t('user.publishedAgents')}
        </Text>
        {agentCount > 0 && <Tag>{agentCount}</Tag>}
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
            total={agents.length}
          />
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default UserAgentList;
