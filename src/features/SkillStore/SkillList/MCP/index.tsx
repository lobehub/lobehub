'use client';

import { Center, Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { ServerCrash } from 'lucide-react';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { VirtuosoGrid } from 'react-virtuoso';

import AsyncError from '@/components/AsyncError';
import { useToolStore } from '@/store/tool';

import Item from '../Community/Item';
import Empty from '../Empty';
import Loading from '../Loading';
import { virtuosoGridStyles } from '../style';
import VirtuosoLoading from '../VirtuosoLoading';
import WantMoreSkills from '../WantMoreSkills';
import { canAutoLoadMore, resolveMCPListFooter } from './utils';

export const MCPList = memo(() => {
  const { t } = useTranslation('setting');

  const [keywords, list, useFetchMCPPluginList, loadMoreMCPPlugins, resetMCPPluginList] =
    useToolStore((s) => [
      s.mcpSearchKeywords,
      s.mcpPluginList,
      s.useFetchMCPPluginList,
      s.loadMoreMCPPlugins,
      s.resetMCPPluginList,
    ]);

  const prevKeywordsRef = useRef(keywords);

  useEffect(() => {
    if (prevKeywordsRef.current !== keywords) {
      prevKeywordsRef.current = keywords;
      resetMCPPluginList(keywords);
    }
  }, [keywords, resetMCPPluginList]);

  const { error, isValidating } = useFetchMCPPluginList({ pageSize: 20, q: keywords });

  const allItems = list?.items ?? [];
  const hasSearchKeywords = Boolean(keywords && keywords.trim());
  // A view painted for another search term is not the answer on screen yet.
  const isStaleQuery = !!list && (list.q ?? undefined) !== (keywords || undefined);

  if (error && !list) {
    return (
      <Center gap={12} padding={40}>
        <Icon icon={ServerCrash} size={80} />
        <Text type={'secondary'}>{t('skillStore.networkError')}</Text>
      </Center>
    );
  }

  if (!list || isStaleQuery || (isValidating && allItems.length === 0)) return <Loading />;

  if (allItems.length === 0) return <Empty search={hasSearchKeywords} />;

  const renderFooter = () => {
    switch (resolveMCPListFooter(list)) {
      case 'loading': {
        return <VirtuosoLoading />;
      }
      case 'error': {
        return (
          <Flexbox align={'center'} paddingBlock={12}>
            <AsyncError
              error={list.loadMoreError}
              variant={'inline'}
              onRetry={() => {
                void loadMoreMCPPlugins();
              }}
            />
          </Flexbox>
        );
      }
      case 'exhausted': {
        return <WantMoreSkills />;
      }
      default: {
        return <div style={{ height: 16 }} />;
      }
    }
  };

  return (
    <VirtuosoGrid
      components={{ Footer: renderFooter }}
      data={allItems}
      increaseViewportBy={typeof window !== 'undefined' ? window.innerHeight : 0}
      itemClassName={virtuosoGridStyles.item}
      itemContent={(_, item) => <Item {...item} />}
      listClassName={virtuosoGridStyles.list}
      overscan={24}
      style={{ height: '60vh', width: '100%' }}
      endReached={() => {
        // While a page is failing, paging waits for the explicit retry above
        // instead of hammering the endpoint on every scroll.
        if (!canAutoLoadMore(list)) return;
        void loadMoreMCPPlugins();
      }}
    />
  );
});

MCPList.displayName = 'MCPList';

export default MCPList;
