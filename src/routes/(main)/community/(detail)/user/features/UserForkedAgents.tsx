'use client';

import { Flexbox, Grid, Tag, Text } from '@lobehub/ui';
import { Pagination } from 'antd';
import { GitForkIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type DiscoverAssistantItem } from '@/types/discover';

import UserAgentCard from './UserAgentCard';

interface UserForkedAgentsProps {
  agents?: DiscoverAssistantItem[];
  pageSize?: number;
  rows?: number;
}

const UserForkedAgents = memo<UserForkedAgentsProps>(({ agents = [], rows = 4, pageSize = 10 }) => {
  const { t } = useTranslation('discover');
  const [currentPage, setCurrentPage] = useState(1);

  const paginatedAgents = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return agents.slice(startIndex, startIndex + pageSize);
  }, [agents, currentPage, pageSize]);

  if (agents.length === 0) return null;

  const showPagination = agents.length > pageSize;

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal align={'center'} gap={8}>
        <GitForkIcon size={16} />
        <Text fontSize={16} weight={500}>
          {t('user.forkedAgents')}
        </Text>
        <Tag>{agents.length}</Tag>
      </Flexbox>
      <Grid rows={rows} width={'100%'}>
        {paginatedAgents.map((agent, index) => (
          <UserAgentCard key={agent.identifier || index} {...agent} />
        ))}
      </Grid>
      {showPagination && (
        <Flexbox align={'center'} justify={'center'}>
          <Pagination
            current={currentPage}
            pageSize={pageSize}
            showSizeChanger={false}
            total={agents.length}
            onChange={(page) => setCurrentPage(page)}
          />
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default UserForkedAgents;
