'use client';

import { memo } from 'react';
import { Link } from 'react-router-dom';

import GroupSkeleton from '@/app/[variants]/(main)/home/features/components/GroupSkeleton';
import { RECENT_BLOCK_SIZE } from '@/app/[variants]/(main)/home/features/const';
import { useHomeStore } from '@/store/home';
import { homeRecentSelectors } from '@/store/home/selectors';
import { standardizeIdentifier } from '@/utils/identifier';

import RecentPageItem from './Item';

const RecentPageList = memo(() => {
  const documents = useHomeStore(homeRecentSelectors.recentPages);
  const isInit = useHomeStore(homeRecentSelectors.isRecentPagesInit);

  // Loading state
  if (!isInit) {
    return (
      <GroupSkeleton height={RECENT_BLOCK_SIZE.PAGE.HEIGHT} width={RECENT_BLOCK_SIZE.PAGE.WIDTH} />
    );
  }

  return documents.map((document) => {
    const pageUrl = `/page/${standardizeIdentifier(document.id)}`;

    return (
      <Link
        key={document.id}
        to={pageUrl}
        style={{
          color: 'inherit',
          textDecoration: 'none',
        }}
      >
        <RecentPageItem document={document} />
      </Link>
    );
  });
});

export default RecentPageList;
