'use client';

import { Flexbox, Skeleton } from '@lobehub/ui';
import { memo, useCallback } from 'react';

import CommentList, { type CommentListProps } from '@/components/CommentList';
import RatingOverview from '@/components/RatingOverview';
import { discoverService } from '@/services/discover';
import { useDiscoverStore } from '@/store/discover';

import { useDetailContext } from '../../DetailProvider';

const Reviews = memo(() => {
  const { identifier, ratingAverage, ratingCount } = useDetailContext();

  const useFetchSkillRatingDistribution = useDiscoverStore(
    (s) => s.useFetchSkillRatingDistribution,
  );
  const useFetchSkillComments = useDiscoverStore((s) => s.useFetchSkillComments);

  const { data: distribution } = useFetchSkillRatingDistribution(identifier);
  const { data: firstPage, isLoading } = useFetchSkillComments({
    identifier,
    order: 'desc',
    page: 1,
    sort: 'createdAt',
  });

  const fetchMore: CommentListProps['fetchMore'] = useCallback(
    (params) => discoverService.getSkillComments({ identifier: identifier!, ...params }),
    [identifier],
  );

  return (
    <Flexbox gap={24}>
      <RatingOverview
        average={ratingAverage}
        distribution={distribution}
        totalCount={distribution?.totalCount ?? ratingCount}
      />
      {isLoading || !firstPage ? (
        <Flexbox gap={24}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton active key={i} paragraph={{ rows: 2 }} title={{ width: 120 }} />
          ))}
        </Flexbox>
      ) : (
        <CommentList fetchMore={fetchMore} initialData={firstPage} key={identifier} />
      )}
    </Flexbox>
  );
});

export default Reviews;
