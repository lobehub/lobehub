'use client';

import { Center, Icon, Text } from '@lobehub/ui';
import { uniqBy } from 'es-toolkit/compat';
import { ServerCrash } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VirtuosoGrid } from 'react-virtuoso';

import { useClientDataSWR } from '@/libs/swr';
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

const MarketSkillList = memo<MarketSkillListProps>(({ keywords }) => {
  const { t } = useTranslation('setting');

  // Ensure agent skills are fetched so install status is available
  const useFetchAgentSkills = useToolStore((s) => s.useFetchAgentSkills);
  useFetchAgentSkills(true);

  // Market skills pagination state
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<DiscoverSkillItem[]>([]);
  const [totalPages, setTotalPages] = useState<number>();

  const locale = globalHelpers.getCurrentLanguage();
  const { data, isLoading, error } = useClientDataSWR(
    ['skill-store-market-skills', locale, keywords || '', page].filter(Boolean).join('-'),
    () =>
      discoverService.getSkillList({
        page,
        pageSize: 20,
        q: keywords || undefined,
        sort: SkillSorts.InstallCount,
      }),
    { revalidateOnFocus: false },
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
    if (totalPages === undefined || page < totalPages) {
      setPage((p) => p + 1);
    }
  }, [page, totalPages]);

  if (isLoading && items.length === 0) return <Loading />;

  if (error) {
    return (
      <Center gap={12} padding={40}>
        <Icon icon={ServerCrash} size={80} />
        <Text type={'secondary'}>{t('skillStore.networkError')}</Text>
      </Center>
    );
  }

  if (items.length === 0) return <Empty search={Boolean(keywords?.trim())} />;

  const hasReachedEnd = totalPages !== undefined && page >= totalPages;

  const renderFooter = () => {
    if (isLoading) return <VirtuosoLoading />;
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
