'use client';

import { Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { ServerCrash } from 'lucide-react';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Virtuoso } from 'react-virtuoso';

import { useToolStore } from '@/store/tool';

import Loading from '../PluginStore/Loading';
import VirtuosoLoading from '../PluginStore/VirtuosoLoading';
import CommunityItem from './CommunityItem';

interface CommunityListProps {
  keywords: string;
}

export const CommunityList = memo<CommunityListProps>(({ keywords }) => {
  const { t } = useTranslation('setting');

  const [
    isMcpListInit,
    allItems,
    totalCount,
    currentPage,
    searchLoading,
    useFetchMCPPluginList,
    loadMoreMCPPlugins,
    resetMCPPluginList,
  ] = useToolStore((s) => [
    s.isMcpListInit,
    s.mcpPluginItems,
    s.totalCount,
    s.currentPage,
    s.searchLoading,
    s.useFetchMCPPluginList,
    s.loadMoreMCPPlugins,
    s.resetMCPPluginList,
  ]);

  useEffect(() => {
    resetMCPPluginList(keywords);
  }, [keywords, resetMCPPluginList]);

  const { isLoading, error } = useFetchMCPPluginList({
    page: currentPage,
    pageSize: 20,
    q: keywords,
  });

  if (searchLoading || !isMcpListInit) return <Loading />;

  if (error) {
    return (
      <Center gap={12} padding={40}>
        <Icon icon={ServerCrash} size={80} />
        <Text type={'secondary'}>{t('skillStore.networkError')}</Text>
      </Center>
    );
  }

  if (allItems.length === 0) {
    return (
      <Flexbox align={'center'} gap={8} padding={48}>
        <Text type={'secondary'}>{t('skillStore.empty')}</Text>
      </Flexbox>
    );
  }

  return (
    <Virtuoso
      components={{
        Footer: isLoading ? VirtuosoLoading : undefined,
      }}
      data={allItems}
      endReached={loadMoreMCPPlugins}
      increaseViewportBy={typeof window !== 'undefined' ? window.innerHeight : 0}
      itemContent={(index) => {
        const item = allItems[index];
        // Render two items per row
        if (index % 2 !== 0) return null;

        const nextItem = allItems[index + 1];
        return (
          <Flexbox gap={12} horizontal paddingBlock={6} paddingInline={16}>
            <CommunityItem {...item} />
            {nextItem && <CommunityItem {...nextItem} />}
          </Flexbox>
        );
      }}
      overscan={24}
      style={{ height: '60vh', width: '100%' }}
      totalCount={Math.ceil((totalCount || 0) / 2)}
    />
  );
});

CommunityList.displayName = 'CommunityList';

export default CommunityList;
