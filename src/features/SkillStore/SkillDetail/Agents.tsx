'use client';

import { Center, cssVar, Grid, Icon, Text } from '@lobehub/ui';
import { InboxIcon, ServerCrash } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { VirtuosoGrid } from 'react-virtuoso';

import { ArticleSkeleton } from '@/components/Skeleton';

import AgentItem from './AgentItem';
import AgentsFooter, { type AgentsFooterContext } from './AgentsFooter';
import { useDetailContext } from './DetailContext';
import { agentListStyles as styles } from './style';
import { usePluginAgentList } from './usePluginAgentList';

const Agents = memo(() => {
  const { t } = useTranslation('plugin');
  const { identifier } = useDetailContext();

  const { error, isEmpty, isInitialLoading, isLoadingMore, items, loadMore, pageError, retry } =
    usePluginAgentList(identifier);

  // Initial loading state
  if (isInitialLoading) {
    return (
      <Grid gap={12} rows={2} width={'100%'}>
        {Array.from({ length: 4 }).map((_, index) => (
          <ArticleSkeleton avatar={40} key={index} rows={1} />
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
  if (isEmpty) {
    return (
      <Center gap={12} padding={40}>
        <Icon color={cssVar.colorTextDescription} icon={InboxIcon} size={80} />
        <Text type={'secondary'}>{t('skillDetail.noAgents')}</Text>
      </Center>
    );
  }

  // Use VirtuosoGrid for rendering
  return (
    <VirtuosoGrid<(typeof items)[number], AgentsFooterContext>
      components={{ Footer: AgentsFooter }}
      context={{ isLoadingMore, message: t('skillDetail.networkError'), onRetry: retry, pageError }}
      data={items}
      endReached={loadMore}
      increaseViewportBy={typeof window !== 'undefined' ? window.innerHeight : 0}
      itemClassName={styles.item}
      itemContent={(_, item) => <AgentItem key={item.identifier} {...item} />}
      listClassName={styles.list}
      overscan={24}
      style={{ height: '50vh', width: '100%' }}
    />
  );
});

export default Agents;
