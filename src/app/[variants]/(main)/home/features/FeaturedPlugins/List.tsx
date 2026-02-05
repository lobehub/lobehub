'use client';

import { memo } from 'react';
import { Link } from 'react-router-dom';
import urlJoin from 'url-join';

import GroupSkeleton from '@/app/[variants]/(main)/home/features/components/GroupSkeleton';
import { RECENT_BLOCK_SIZE } from '@/app/[variants]/(main)/home/features/const';
import { useDiscoverStore } from '@/store/discover';

import FeaturedPluginItem from './Item';

const FeaturedPluginsList = memo(() => {
  const useMcpList = useDiscoverStore((s) => s.useFetchMcpList);

  const { data: mcpList, isLoading } = useMcpList({
    page: 1,
    pageSize: 8,
  });

  // Loading state
  if (isLoading) {
    return (
      <GroupSkeleton
        height={RECENT_BLOCK_SIZE.PLUGIN.HEIGHT}
        rows={8}
        width={RECENT_BLOCK_SIZE.PLUGIN.WIDTH}
      />
    );
  }

  if (!mcpList || mcpList.items.length === 0) {
    return null;
  }

  return mcpList.items.map((item, index) => (
    <Link
      key={index}
      to={urlJoin('/community/mcp', item.identifier)}
      style={{
        color: 'inherit',
        textDecoration: 'none',
      }}
    >
      <FeaturedPluginItem {...item} />
    </Link>
  ));
});

export default FeaturedPluginsList;
