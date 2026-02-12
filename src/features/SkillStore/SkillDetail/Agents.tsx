'use client';

import { Center, Grid, Icon, Skeleton, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { InboxIcon, ServerCrash } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VirtuosoGrid } from 'react-virtuoso';

import { useClientDataSWR } from '@/libs/swr';
import { discoverService } from '@/services/discover';
import { type DiscoverAssistantItem } from '@/types/discover';

import AgentItem from './AgentItem';
import { useDetailContext } from './DetailContext';
import { agentListStyles as styles } from './style';
import VirtuosoLoading from './VirtuosoLoading';

const PAGE_SIZE = 12;

const Agents = memo(() => {
  const { t } = useTranslation('plugin');
  const { identifier } = useDetailContext();

  // Local state for pagination
  const [items, setItems] = useState<DiscoverAssistantItem[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [isInitialized, setIsInitialized] = useState(false);
  const prevPageRef = useRef(currentPage);

  // SWR fetch data (lazy loading - only requests when component mounts)
  const { data, isLoading, error } = useClientDataSWR(
    identifier ? ['skill-agents', identifier, currentPage] : null,
    () =>
      discoverService.getAgentsByPlugin({
        page: currentPage,
        pageSize: PAGE_SIZE,
        pluginId: identifier,
      }),
  );

  // Data accumulation logic
  useEffect(() => {
    if (data) {
      if (currentPage === 1) {
        setItems(data.items);
      } else if (currentPage > prevPageRef.current) {
        setItems((prev) => [...prev, ...data.items]);
      }
      setTotalCount(data.totalCount);
      setIsInitialized(true);
      prevPageRef.current = currentPage;
    }
  }, [data, currentPage]);

  const hasMore = items.length < totalCount;

  const loadMore = useCallback(() => {
    if (!isLoading && hasMore) {
      setCurrentPage((prev) => prev + 1);
    }
  }, [isLoading, hasMore]);

  // Initial loading state
  if (!isInitialized && isLoading) {
    return (
      <Grid gap={12} rows={2} width={'100%'}>
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton
            active
            avatar={{ shape: 'square', size: 40 }}
            key={index}
            paragraph={{ rows: 1 }}
          />
        ))}
      </Grid>
    );
  }

  // Error state
  if (error) {
    return (
      <Center gap={12} padding={40}>
        <Icon color={cssVar.colorTextDescription} icon={ServerCrash} size={80} />
        <Text type={'secondary'}>{t('skillDetail.networkError')}</Text>
      </Center>
    );
  }

  // Empty state
  if (isInitialized && items.length === 0) {
    return (
      <Center gap={12} padding={40}>
        <Icon color={cssVar.colorTextDescription} icon={InboxIcon} size={80} />
        <Text type={'secondary'}>{t('skillDetail.noAgents')}</Text>
      </Center>
    );
  }

  // Use VirtuosoGrid for rendering
  return (
    <VirtuosoGrid
      data={items}
      endReached={loadMore}
      increaseViewportBy={typeof window !== 'undefined' ? window.innerHeight : 0}
      itemClassName={styles.item}
      itemContent={(_, item) => <AgentItem key={item.identifier} {...item} />}
      listClassName={styles.list}
      overscan={24}
      style={{ height: '50vh', width: '100%' }}
      components={{
        Footer: isLoading ? VirtuosoLoading : () => <div style={{ height: 16 }} />,
      }}
    />
  );
});

export default Agents;
