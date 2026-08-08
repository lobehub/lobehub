'use client';

import { Empty, Flexbox, Skeleton } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { MessageSquare } from 'lucide-react';
import { memo, useCallback, useState, useTransition } from 'react';
import { useTranslation } from 'react-i18next';

import { type SkillCommentItem, type SkillCommentListResponse } from '@/types/discover';

import CommentItem from './CommentItem';

export interface CommentListProps {
  fetchMore: (params: {
    order?: 'asc' | 'desc';
    page?: number;
    pageSize?: number;
    sort?: 'createdAt' | 'upvotes';
  }) => Promise<SkillCommentListResponse>;
  initialData?: SkillCommentListResponse;
}

const CommentList = memo<CommentListProps>(({ initialData, fetchMore }) => {
  const { t } = useTranslation('discover');
  const { t: tc } = useTranslation('common');
  const [items, setItems] = useState<SkillCommentItem[]>(initialData?.items ?? []);
  const [currentPage, setCurrentPage] = useState(initialData?.currentPage ?? 1);
  const [totalPages, setTotalPages] = useState(initialData?.totalPages ?? 1);
  const [totalCount, setTotalCount] = useState(initialData?.totalCount ?? 0);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleLoadMore = useCallback(() => {
    const nextPage = currentPage + 1;
    startTransition(async () => {
      // Keep failures inside the transition: preserve loaded comments and
      // turn the button into a retry instead of surfacing to an error boundary
      try {
        const res = await fetchMore({ order: 'desc', page: nextPage, sort: 'createdAt' });
        setItems((prev) => [...prev, ...res.items]);
        setCurrentPage(res.currentPage);
        setTotalPages(res.totalPages);
        setTotalCount(res.totalCount);
        setLoadMoreFailed(false);
      } catch {
        setLoadMoreFailed(true);
      }
    });
  }, [currentPage, fetchMore]);

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
                <Skeleton active key={i} paragraph={{ rows: 2 }} title={{ width: 120 }} />
              ))}
            </Flexbox>
          ) : (
            items.map((item) => <CommentItem item={item} key={item.id} />)
          )}
        </Flexbox>
        {currentPage < totalPages && (
          <Button block loading={isPending} onClick={handleLoadMore}>
            {loadMoreFailed ? tc('retry') : t('skills.details.comments.loadMore')}
          </Button>
        )}
      </>
    );
  }

  return <Flexbox gap={24}>{content}</Flexbox>;
});

export default CommentList;
