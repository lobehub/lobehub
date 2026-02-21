'use client';

import { memo } from 'react';
import { Link } from 'react-router-dom';
import urlJoin from 'url-join';

import GroupSkeleton from '@/app/[variants]/(main)/home/features/components/GroupSkeleton';
import { RECENT_BLOCK_SIZE } from '@/app/[variants]/(main)/home/features/const';
import { useDiscoverStore } from '@/store/discover';

import Item from './Item';

const GroupList = memo(() => {
  const useGroupAgentList = useDiscoverStore((s) => s.useGroupAgentList);

  const { data: groupList, isLoading } = useGroupAgentList({
    page: 1,
    pageSize: 12,
  });

  if (isLoading) {
    return (
      <GroupSkeleton
        height={RECENT_BLOCK_SIZE.AGENT.HEIGHT}
        width={RECENT_BLOCK_SIZE.AGENT.WIDTH}
      />
    );
  }

  if (!groupList || groupList.items.length === 0) {
    return null;
  }

  return (
    <>
      {groupList.items.map((item, index) => (
        <Link
          key={index}
          to={urlJoin('/community/group_agent', item.identifier)}
          style={{
            color: 'inherit',
            textDecoration: 'none',
          }}
        >
          <Item
            author={item.author}
            avatar={item.avatar}
            backgroundColor={item.backgroundColor}
            description={item.description}
            title={item.title}
          />
        </Link>
      ))}
    </>
  );
});

export default GroupList;
