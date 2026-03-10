'use client';

import { Flexbox, Grid, Tag, Text } from '@lobehub/ui';
import { Pagination } from 'antd';
import { GitForkIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type DiscoverGroupAgentItem } from '@/types/discover';

import UserGroupCard from './UserGroupCard';

interface UserForkedAgentGroupsProps {
  agentGroups?: DiscoverGroupAgentItem[];
  pageSize?: number;
  rows?: number;
}

const UserForkedAgentGroups = memo<UserForkedAgentGroupsProps>(
  ({ agentGroups = [], rows = 4, pageSize = 10 }) => {
    const { t } = useTranslation('discover');
    const [currentPage, setCurrentPage] = useState(1);

    const paginatedGroups = useMemo(() => {
      const startIndex = (currentPage - 1) * pageSize;
      return agentGroups.slice(startIndex, startIndex + pageSize);
    }, [agentGroups, currentPage, pageSize]);

    if (agentGroups.length === 0) return null;

    const showPagination = agentGroups.length > pageSize;

    return (
      <Flexbox gap={16}>
        <Flexbox horizontal align={'center'} gap={8}>
          <GitForkIcon size={16} />
          <Text fontSize={16} weight={500}>
            {t('user.forkedAgentGroups')}
          </Text>
          <Tag>{agentGroups.length}</Tag>
        </Flexbox>
        <Grid rows={rows} width={'100%'}>
          {paginatedGroups.map((group, index) => (
            <UserGroupCard key={group.identifier || index} {...group} />
          ))}
        </Grid>
        {showPagination && (
          <Flexbox align={'center'} justify={'center'}>
            <Pagination
              current={currentPage}
              pageSize={pageSize}
              showSizeChanger={false}
              total={agentGroups.length}
              onChange={(page) => setCurrentPage(page)}
            />
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

export default UserForkedAgentGroups;
