'use client';

import { Button, Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { ServerCrash } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { VirtuosoGrid } from 'react-virtuoso';

import { normalizeAsyncError } from '@/libs/swr/normalizeError';
import { useToolStore } from '@/store/tool';

import MarketSkillItem from '../Community/MarketSkillItem';
import Empty from '../Empty';
import Loading from '../Loading';
import { virtuosoGridStyles } from '../style';
import VirtuosoLoading from '../VirtuosoLoading';
import WantMoreSkills from '../WantMoreSkills';
import { useMarketSkillList } from './useMarketSkillList';

interface MarketSkillListProps {
  keywords?: string;
}

const MarketSkillList = memo<MarketSkillListProps>(({ keywords }) => {
  const { t } = useTranslation(['setting', 'common']);

  // Ensure agent skills are fetched so install status is available
  const useFetchAgentSkills = useToolStore((s) => s.useFetchAgentSkills);
  useFetchAgentSkills(true);

  const { error, isLoading, items, loadMore, page, retry, totalPages } =
    useMarketSkillList(keywords);

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
        <Button onClick={retry}>{t('retry', { ns: 'common' })}</Button>
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
