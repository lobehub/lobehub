import { uniqBy } from 'es-toolkit/compat';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { discoverKeys } from '@/libs/swr/keys';
import { discoverService } from '@/services/discover';
import { globalHelpers } from '@/store/global/helpers';
import { type DiscoverSkillItem, SkillSorts } from '@/types/discover';

// All store tabs stay mounted. Deduplicate reopening the modal to avoid rate limits.
const MARKET_SKILL_LIST_DEDUPING_INTERVAL = 60_000;

export const useMarketSkillList = (keywords?: string) => {
  // Market skills pagination state
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<DiscoverSkillItem[]>([]);
  const [totalPages, setTotalPages] = useState<number>();

  const locale = globalHelpers.getCurrentLanguage();
  const { data, isLoading, error, mutate } = useClientDataSWR(
    discoverKeys.skillStoreMarketSkills(locale, keywords || '', page),
    () =>
      discoverService.getSkillList({
        page,
        pageSize: 20,
        q: keywords || undefined,
        sort: SkillSorts.InstallCount,
      }),
    {
      dedupingInterval: MARKET_SKILL_LIST_DEDUPING_INTERVAL,
      revalidateOnFocus: false,
    },
  );

  const prevKeywordsRef = useRef(keywords);
  useEffect(() => {
    if (prevKeywordsRef.current !== keywords) {
      // A cached first page may never revalidate. Reset pagination and apply its
      // data together so a later reset cannot erase the cached search results.
      prevKeywordsRef.current = keywords;
      setPage(1);
      setItems(page === 1 ? data?.items || [] : []);
      setTotalPages(page === 1 ? data?.totalPages : undefined);
      return;
    }

    if (!data) return;
    setTotalPages(data.totalPages);

    if (page === 1) {
      setItems(data.items);
    } else {
      setItems((prev) => uniqBy([...prev, ...data.items], (i) => i.identifier));
    }
  }, [data, keywords, page]);

  const loadMore = useCallback(() => {
    // Don't let the scroll observer walk into the next page while the current
    // one is still failing — that turns a rate limit into a silent retry loop.
    if (error || isLoading) return;
    if (totalPages === undefined || page < totalPages) {
      setPage((p) => p + 1);
    }
  }, [error, isLoading, page, totalPages]);

  const retry = useCallback(() => {
    void mutate();
  }, [mutate]);

  return { error, isLoading, items, loadMore, page, retry, totalPages };
};
