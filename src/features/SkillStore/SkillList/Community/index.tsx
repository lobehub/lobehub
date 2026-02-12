'use client';

import { Center, Icon, Text } from '@lobehub/ui';
import { ServerCrash } from 'lucide-react';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { VirtuosoGrid } from 'react-virtuoso';

import { useToolStore } from '@/store/tool';

import Empty from '../Empty';
import Loading from '../Loading';
import { virtuosoGridStyles } from '../style';
import VirtuosoLoading from '../VirtuosoLoading';
import WantMoreSkills from '../WantMoreSkills';
import Item from './Item';

export const CommunityList = memo(() => {
  const { t } = useTranslation('setting');

  const [
    keywords,
    isMcpListInit,
    allItems,
    currentPage,
    totalPages,
    searchLoading,
    useFetchMCPPluginList,
    loadMoreMCPPlugins,
    resetMCPPluginList,
  ] = useToolStore((s) => [
    s.mcpSearchKeywords,
    s.isMcpListInit,
    s.mcpPluginItems,
    s.currentPage,
    s.totalPages,
    s.searchLoading,
    s.useFetchMCPPluginList,
    s.loadMoreMCPPlugins,
    s.resetMCPPluginList,
  ]);

  const prevKeywordsRef = useRef(keywords);

  useEffect(() => {
    // Only reset when keywords actually change, not on initial mount
    if (prevKeywordsRef.current !== keywords) {
      prevKeywordsRef.current = keywords;
      resetMCPPluginList(keywords);
    }
  }, [keywords, resetMCPPluginList]);

  const { isLoading, error } = useFetchMCPPluginList({
    page: currentPage,
    pageSize: 20,
    q: keywords,
  });

  const hasSearchKeywords = Boolean(keywords && keywords.trim());

  const renderContent = () => {
    // Show loading when searching, not initialized, or first page is loading with no items
    if (searchLoading || !isMcpListInit || (isLoading && allItems.length === 0)) return <Loading />;

    if (error) {
      return (
        <Center gap={12} padding={40}>
          <Icon icon={ServerCrash} size={80} />
          <Text type={'secondary'}>{t('skillStore.networkError')}</Text>
        </Center>
      );
    }

    if (allItems.length === 0) return <Empty search={hasSearchKeywords} />;

    // Check if we've reached the end of the list
    const hasReachedEnd = totalPages !== undefined && currentPage >= totalPages;

    const renderFooter = () => {
      if (isLoading) return <VirtuosoLoading />;
      if (hasReachedEnd) return <WantMoreSkills />;
      return <div style={{ height: 16 }} />;
    };

    return (
      <VirtuosoGrid
        data={allItems}
        endReached={loadMoreMCPPlugins}
        increaseViewportBy={typeof window !== 'undefined' ? window.innerHeight : 0}
        itemClassName={virtuosoGridStyles.item}
        itemContent={(_, item) => <Item {...item} />}
        listClassName={virtuosoGridStyles.list}
        overscan={24}
        style={{ height: '60vh', width: '100%' }}
        components={{
          Footer: renderFooter,
        }}
      />
    );
  };

  return renderContent();
});

CommunityList.displayName = 'CommunityList';

export default CommunityList;
