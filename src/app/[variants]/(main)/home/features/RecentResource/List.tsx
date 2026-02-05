'use client';

import { memo } from 'react';
import { Link } from 'react-router-dom';

import GroupSkeleton from '@/app/[variants]/(main)/home/features/components/GroupSkeleton';
import { RECENT_BLOCK_SIZE } from '@/app/[variants]/(main)/home/features/const';
import { useHomeStore } from '@/store/home';
import { homeRecentSelectors } from '@/store/home/selectors';

import RecentResourceItem from './Item';

const RecentResourceList = memo(() => {
  const files = useHomeStore(homeRecentSelectors.recentResources);
  const isInit = useHomeStore(homeRecentSelectors.isRecentResourcesInit);

  // Loading state
  if (!isInit) {
    return (
      <GroupSkeleton
        height={RECENT_BLOCK_SIZE.RESOURCE.HEIGHT}
        width={RECENT_BLOCK_SIZE.RESOURCE.WIDTH}
      />
    );
  }

  return files.map((file) => {
    const isPage = file.fileType === 'text/plain';
    const fileUrl = isPage ? `/resource/${file.id}` : `/resource?file=${file.id}`;

    return (
      <Link
        key={file.id}
        to={fileUrl}
        style={{
          color: 'inherit',
          textDecoration: 'none',
        }}
      >
        <RecentResourceItem file={file} />
      </Link>
    );
  });
});

export default RecentResourceList;
