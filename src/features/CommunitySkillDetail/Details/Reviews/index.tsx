'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useCallback } from 'react';

import AsyncError from '@/components/AsyncError';
import CommentList, { type CommentListProps } from '@/components/CommentList';
import RatingOverview from '@/components/RatingOverview';
import { ArticleSkeleton } from '@/components/Skeleton';
import { discoverService } from '@/services/discover';
import { useDiscoverStore } from '@/store/discover';

import { FIRST_COMMENTS_PAGE_QUERY } from '../../const';
import { useDetailContext } from '../../DetailProvider';

const Reviews = memo(() => {
  const { identifier, ratingAverage, ratingCount } = useDetailContext();

  const useFetchSkillRatingDistribution = useDiscoverStore(
    (s) => s.useFetchSkillRatingDistribution,
  );
  const useFetchSkillComments = useDiscoverStore((s) => s.useFetchSkillComments);

  const { data: distribution } = useFetchSkillRatingDistribution(identifier);
  const {
    data: firstPage,
    error,
    isLoading,
    isValidating,
    mutate,
  } = useFetchSkillComments({
    identifier,
    ...FIRST_COMMENTS_PAGE_QUERY,
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
      {isLoading ? (
        <Flexbox gap={24}>
          {Array.from({ length: 3 }).map((_, i) => (
            <ArticleSkeleton key={i} rows={2} title={120} />
          ))}
        </Flexbox>
      ) : error ? (
        // A failed fetch is not "no reviews yet" — offer a retry. CommentList
        // only mounts on success, so retried data seeds it fresh (it snapshots
        // initialData at mount time).
        <AsyncError
          error={error}
          retrying={isValidating}
          variant={'block'}
          onRetry={() => mutate()}
        />
      ) : (
        <CommentList fetchMore={fetchMore} initialData={firstPage} key={identifier} />
      )}
    </Flexbox>
  );
});

export default Reviews;
