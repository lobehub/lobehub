'use client';

import { Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { uniqBy } from 'es-toolkit/compat';
import { ServerCrash } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VirtuosoGrid } from 'react-virtuoso';

import { useClientDataSWR } from '@/libs/swr';
import { discoverKeys } from '@/libs/swr/keys';
import { normalizeAsyncError } from '@/libs/swr/normalizeError';
import { discoverService } from '@/services/discover';
import { globalHelpers } from '@/store/global/helpers';
import { useToolStore } from '@/store/tool';
import { type DiscoverSkillItem, SkillSorts } from '@/types/discover';

import MarketSkillItem from '../Community/MarketSkillItem';
import Empty from '../Empty';
import Loading from '../Loading';
import { virtuosoGridStyles } from '../style';
import VirtuosoLoading from '../VirtuosoLoading';
import WantMoreSkills from '../WantMoreSkills';

interface MarketSkillListProps {
  keywords?: string;
}

/**
 * Collapse repeat mounts of the store into one upstream request.
 *
 * All three store tabs mount at once (they toggle with `display`, not
 * conditional rendering), so this list fetches whenever the modal opens — even
 * while the user is looking at another tab. The global `useClientDataSWR`
 * default is `dedupingInterval: 0`, which is right for interactive data the user
 * edits but wrong here: reopening the modal is not a request for fresher data,
 * and Market rate limits this endpoint.
 */
const MARKET_SKILL_LIST_DEDUPING_INTERVAL = 60_000;

const MarketSkillList = memo<MarketSkillListProps>(({ keywords }) => {
  const { t } = useTranslation(['setting', 'common']);

  // Ensure agent skills are fetched so install status is available
  const useFetchAgentSkills = useToolStore((s) => s.useFetchAgentSkills);
  useFetchAgentSkills(true);

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

  // Accumulate items across pages
  useEffect(() => {
    if (!data) return;
    setTotalPages(data.totalPages);

    if (page === 1) {
      setItems(data.items);
    } else {
      setItems((prev) => uniqBy([...prev, ...data.items], (i) => i.identifier));
    }
  }, [data, page]);

  // Reset on keyword change
  const prevKeywordsRef = useRef(keywords);
  useEffect(() => {
    if (prevKeywordsRef.current !== keywords) {
      prevKeywordsRef.current = keywords;
      setPage(1);
      setItems([]);
      setTotalPages(undefined);
    }
  }, [keywords]);

  const loadMore = useCallback(() => {
    // Don't let the scroll observer walk into the next page while the current
    // one is still failing — that turns a rate limit into a silent retry loop.
    if (error) return;
    if (totalPages === undefined || page < totalPages) {
      setPage((p) => p + 1);
    }
  }, [error, page, totalPages]);

  const retry = useCallback(() => {
    void mutate();
  }, [mutate]);

  // A rate limit is not a network error, and saying so sends the user off
  // debugging their connection. Both are retryable, just not immediately.
  const errorMessage =
    normalizeAsyncError(error).status === 429
      ? t('skillStore.rateLimited')
      : t('skillStore.networkError');

  if (isLoading && items.length === 0) return <Loading />;

  // Only take over the whole surface when there is nothing to show. Once pages
  // have loaded, a failed *next* page must not wipe them.
  if (error && items.length === 0) {
    return (
      <Center gap={12} padding={40}>
        <Icon icon={ServerCrash} size={80} />
        <Text type={'secondary'}>{errorMessage}</Text>
        <Button size={'small'} onClick={retry}>
          {t('retry', { ns: 'common' })}
        </Button>
      </Center>
    );
  }

  if (items.length === 0) return <Empty search={Boolean(keywords?.trim())} />;

  const hasReachedEnd = totalPages !== undefined && page >= totalPages;

  const renderFooter = () => {
    if (isLoading) return <VirtuosoLoading />;
    if (error)
      return (
        <Flexbox horizontal align={'center'} gap={8} justify={'center'} padding={16}>
          <Text type={'secondary'}>{errorMessage}</Text>
          <Button size={'small'} onClick={retry}>
            {t('retry', { ns: 'common' })}
          </Button>
        </Flexbox>
      );
    if (hasReachedEnd) return <WantMoreSkills />;
    return <div style={{ height: 16 }} />;
  };

  return (
    <VirtuosoGrid
      components={{ Footer: renderFooter }}
      data={items}
      endReached={loadMore}
      increaseViewportBy={typeof window !== 'undefined' ? window.innerHeight : 0}
      itemClassName={virtuosoGridStyles.item}
      itemContent={(_, item) => <MarketSkillItem {...item} />}
      listClassName={virtuosoGridStyles.list}
      overscan={24}
      style={{ height: '60vh', width: '100%' }}
    />
  );
});

MarketSkillList.displayName = 'MarketSkillList';

export default MarketSkillList;
