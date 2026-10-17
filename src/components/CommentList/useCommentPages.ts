import isEqual from 'fast-deep-equal';
import { useCallback, useState, useTransition } from 'react';

import { type SkillCommentItem, type SkillCommentListResponse } from '@/types/discover';

export type FetchCommentPage = (params: {
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  sort?: 'createdAt' | 'upvotes';
}) => Promise<SkillCommentListResponse>;

/**
 * Paged comment state seeded from a first page, with "load more" appending
 * later pages.
 */
export const useCommentPages = (
  initialData: SkillCommentListResponse | undefined,
  fetchMore: FetchCommentPage,
) => {
  const [items, setItems] = useState<SkillCommentItem[]>(initialData?.items ?? []);
  const [currentPage, setCurrentPage] = useState(initialData?.currentPage ?? 1);
  const [totalPages, setTotalPages] = useState(initialData?.totalPages ?? 1);
  const [totalCount, setTotalCount] = useState(initialData?.totalCount ?? 0);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  // The first page can arrive after mount: a persisted copy seeds the list,
  // then revalidation replaces it. Reseed from the refreshed first page when
  // its content actually changes; an identical refresh keeps any later pages
  // the user already loaded.
  const [seed, setSeed] = useState(initialData);
  if (initialData !== seed) {
    setSeed(initialData);
    if (initialData && !isEqual(initialData, seed)) {
      setItems(initialData.items);
      setCurrentPage(initialData.currentPage);
      setTotalPages(initialData.totalPages);
      setTotalCount(initialData.totalCount);
      setLoadMoreFailed(false);
    }
  }

  const loadMore = useCallback(() => {
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

  return { currentPage, isPending, items, loadMore, loadMoreFailed, totalCount, totalPages };
};
