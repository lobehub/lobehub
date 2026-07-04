'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useDiscoverStore } from '@/store/discover';
import { AssistantSorts, McpSorts } from '@/types/discover';

import ListLoading from '../../components/ListLoading';
import Title from '../../components/Title';
import AssistantList from '../agent/features/List';
import McpList from '../mcp/features/List';
import CreatorRewardBanner from './features/CreatorRewardBanner';

const HomePage = memo(() => {
  const { t } = useTranslation('discover');
  const useAssistantList = useDiscoverStore((s) => s.useAssistantList);
  const useMcpList = useDiscoverStore((s) => s.useFetchMcpList);

  const {
    data: assistantList,
    isLoading: assistantLoading,
    error: assistantError,
    mutate: refetchAssistants,
  } = useAssistantList({
    page: 1,
    pageSize: 12,
    sort: AssistantSorts.Recommended,
  });

  const {
    data: mcpList,
    isLoading: pluginLoading,
    error: mcpError,
    mutate: refetchMcp,
  } = useMcpList({
    page: 1,
    pageSize: 12,
    sort: McpSorts.Recommended,
  });

  // Gate each section independently so a failure in one featured list surfaces a
  // Retry there instead of leaving the whole page on a permanent skeleton
  // (LOBE-11223).
  return (
    <>
      <CreatorRewardBanner />
      <Title more={t('home.more')} moreLink={'/community/agent'}>
        {t('home.featuredAssistants')}
      </Title>
      <AsyncBoundary
        data={assistantList}
        error={assistantError}
        isLoading={assistantLoading}
        loading={<ListLoading length={8} rows={4} />}
        onRetry={() => refetchAssistants()}
      >
        <AssistantList data={assistantList?.items ?? []} rows={4} />
      </AsyncBoundary>
      <div />
      <Title more={t('home.more')} moreLink={'/community/mcp'}>
        {t('home.featuredTools')}
      </Title>
      <AsyncBoundary
        data={mcpList}
        error={mcpError}
        isLoading={pluginLoading}
        loading={<ListLoading length={8} rows={4} />}
        onRetry={() => refetchMcp()}
      >
        <McpList data={mcpList?.items ?? []} rows={4} />
      </AsyncBoundary>
    </>
  );
});

export default HomePage;
