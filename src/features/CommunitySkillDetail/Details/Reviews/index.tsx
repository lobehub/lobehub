'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useCallback } from 'react';

import AsyncError from '@/components/AsyncError';
import CommentList, { type CommentListProps } from '@/components/CommentList';
import RatingOverview from '@/components/RatingOverview';
import { ArticleSkeleton } from '@/components/Skeleton';
import { discoverService } from '@/services/discover';
import { useDiscoverStore } from '@/store/discover';
import { skillSelectors } from '@/store/discover/selectors';

import { FIRST_COMMENTS_PAGE_QUERY } from '../../const';
import { useDetailContext } from '../../DetailProvider';

const Reviews = memo(() => {
  const { identifier, ratingAverage, ratingCount } = useDetailContext();

  const useFetchSkillRatingDistribution = useDiscoverStore(
    (s) => s.useFetchSkillRatingDistribution,
  );
  const useFetchSkillComments = useDiscoverStore((s) => s.useFetchSkillComments);

  const { queryKey: distributionKey } = useFetchSkillRatingDistribution(identifier);
  const distribution = useDiscoverStore(skillSelectors.skillRatingDistribution(distributionKey));
  const {
    error,
    isLoading,
    isValidating,
    mutate,
    queryKey: commentsKey,
  } = useFetchSkillComments({
    identifier,
    ...FIRST_COMMENTS_PAGE_QUERY,
  });
  const firstPage = useDiscoverStore(skillSelectors.skillComments(commentsKey));

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
        // reseeds itself when a revalidated first page replaces the persisted one.
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
