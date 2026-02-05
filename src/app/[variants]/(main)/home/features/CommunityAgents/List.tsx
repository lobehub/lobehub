'use client';

import { memo } from 'react';
import { Link } from 'react-router-dom';
import urlJoin from 'url-join';

import GroupSkeleton from '@/app/[variants]/(main)/home/features/components/GroupSkeleton';
import { RECENT_BLOCK_SIZE } from '@/app/[variants]/(main)/home/features/const';
import { useDiscoverStore } from '@/store/discover';

import CommunityAgentItem from './Item';

const CommunityAgentsList = memo(() => {
  const useAssistantList = useDiscoverStore((s) => s.useAssistantList);

  const { data: assistantList, isLoading } = useAssistantList({
    page: 1,
    pageSize: 12,
  });

  // Loading state
  if (isLoading) {
    return (
      <GroupSkeleton
        height={RECENT_BLOCK_SIZE.AGENT.HEIGHT}
        width={RECENT_BLOCK_SIZE.AGENT.WIDTH}
      />
    );
  }

  if (!assistantList || assistantList.items.length === 0) {
    return null;
  }

  return (
    <>
      {assistantList.items.map((item, index) => (
        <Link
          key={index}
          to={urlJoin('/community/agent', item.identifier)}
          style={{
            color: 'inherit',
            textDecoration: 'none',
          }}
        >
          <CommunityAgentItem {...item} />
        </Link>
      ))}
    </>
  );
});

export default CommunityAgentsList;
