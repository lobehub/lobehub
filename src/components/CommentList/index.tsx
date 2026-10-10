'use client';

import { Empty, Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { MessageSquare } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ArticleSkeleton } from '@/components/Skeleton';
import { type SkillCommentListResponse } from '@/types/discover';

import CommentItem from './CommentItem';
import { type FetchCommentPage, useCommentPages } from './useCommentPages';

export interface CommentListProps {
  fetchMore: FetchCommentPage;
  initialData?: SkillCommentListResponse;
}

const CommentList = memo<CommentListProps>(({ initialData, fetchMore }) => {
  const { t } = useTranslation('discover');
  const { t: tc } = useTranslation('common');
  const { currentPage, isPending, items, loadMore, loadMoreFailed, totalCount, totalPages } =
    useCommentPages(initialData, fetchMore);

  let content;
  if (totalCount === 0 && !isPending) {
    content = <Empty description={t('skills.details.comments.noComments')} icon={MessageSquare} />;
  } else {
    content = (
      <>
        <Flexbox gap={24}>
          {isPending && items.length === 0 ? (
            <Flexbox gap={24}>
              {Array.from({ length: 3 }).map((_, i) => (
                <ArticleSkeleton key={i} rows={2} title={120} />
              ))}
            </Flexbox>
          ) : (
            items.map((item) => <CommentItem item={item} key={item.id} />)
          )}
        </Flexbox>
        {currentPage < totalPages && (
          <Button block loading={isPending} onClick={loadMore}>
            {loadMoreFailed ? tc('retry') : t('skills.details.comments.loadMore')}
          </Button>
        )}
      </>
    );
  }

  return <Flexbox gap={24}>{content}</Flexbox>;
});

export default CommentList;
