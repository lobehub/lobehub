'use client';

import { memo } from 'react';
import { Link } from 'react-router-dom';
import urlJoin from 'url-join';

import GroupSkeleton from '@/app/[variants]/(main)/home/features/components/GroupSkeleton';
import { RECENT_BLOCK_SIZE } from '@/app/[variants]/(main)/home/features/const';
import { useDiscoverStore } from '@/store/discover';
import { type StarterMode } from '@/store/home';
import { AssistantCategory } from '@/types/discover';

import Item from './Item';

interface AssistantListProps {
  mode: StarterMode;
}

const AssistantList = memo<AssistantListProps>(({ mode }) => {
  const useAssistantList = useDiscoverStore((s) => s.useAssistantList);

  // For 'write' mode, filter by copywriting category
  const category = mode === 'write' ? AssistantCategory.CopyWriting : undefined;

  const { data: assistantList, isLoading } = useAssistantList({
    category,
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

export default AssistantList;
