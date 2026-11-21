import { uniqBy } from 'es-toolkit/compat';
import { useCallback, useMemo, useState } from 'react';

import { useDiscoverStore } from '@/store/discover';
import { normalizeSkillListParams } from '@/store/discover/slices/skill/action';
import { skillListQueryKey } from '@/store/discover/slices/skill/projection';
import { globalHelpers } from '@/store/global/helpers';
import { type DiscoverSkillItem, type SkillQueryParams, SkillSorts } from '@/types/discover';

// All store tabs stay mounted. Deduplicate reopening the modal to avoid rate limits.
const MARKET_SKILL_LIST_DEDUPING_INTERVAL = 60_000;
const PAGE_SIZE = 20;

const pageParams = (q: string | undefined, page: number): SkillQueryParams => ({
  page,
  pageSize: PAGE_SIZE,
  q,
  sort: SkillSorts.InstallCount,
});

/**
 * The Skill Store's market tab, read from the discover `skillList` replica.
 * Each (search term · page) is one entry, so reopening the store paints the
 * last confirmed first page before the network answers, and the community
 * skill list and the store share one cache of the same endpoint.
 */
export const useMarketSkillList = (keywords?: string) => {
  const q = keywords || undefined;
  // Pages walked so far, owned by the search term and UI language they were
  // walked for: either changing starts again from the first page in the same
  // render (each language is its own set of entries).
  const locale = globalHelpers.getCurrentLanguage();
  const [walked, setWalked] = useState({ locale, page: 1, q });
  const page = walked.q === q && walked.locale === locale ? walked.page : 1;

  const useFetchSkillList = useDiscoverStore((s) => s.useFetchSkillList);
  const { error, revalidate } = useFetchSkillList(pageParams(q, page), {
    dedupingInterval: MARKET_SKILL_LIST_DEDUPING_INTERVAL,
    revalidateOnFocus: false,
  });

  const skillListMap = useDiscoverStore((s) => s.skillListMap);
  const { items, loadedPages, totalPages } = useMemo(() => {
    let rows: DiscoverSkillItem[] = [];
    let loaded = 0;
    let total: number | undefined;
    for (let p = 1; p <= page; p++) {
      const entry = skillListMap[skillListQueryKey(normalizeSkillListParams(pageParams(q, p)))];
      if (!entry) break;
      rows = p === 1 ? entry.items : uniqBy([...rows, ...entry.items], (i) => i.identifier);
      loaded = p;
      total = entry.totalPages;
    }
    return { items: rows, loadedPages: loaded, totalPages: total };
  }, [page, q, skillListMap]);

  const firstPageKey = skillListQueryKey(normalizeSkillListParams(pageParams(q, 1)));
  // A hydrated first page may be stale or empty; "no skills" is only shown once
  // the server has answered it in this session.
  const isConfirmed = useDiscoverStore(
    (s) => s.skillListReplica.entries[firstPageKey]?.source === 'server',
  );

  const isLoading = loadedPages < page && !error;

  const loadMore = useCallback(() => {
    // Don't let the scroll observer walk into the next page while the current
    // one is still failing — that turns a rate limit into a silent retry loop.
    if (error || isLoading) return;
    if (totalPages === undefined || loadedPages < totalPages) {
      setWalked({ locale, page: loadedPages + 1, q });
    }
  }, [error, isLoading, loadedPages, locale, q, totalPages]);

  const retry = useCallback(() => {
    void revalidate();
  }, [revalidate]);

  return { error, isConfirmed, isLoading, items, loadMore, page, retry, totalPages };
};
