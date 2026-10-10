'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useDiscoverStore } from '@/store/discover';
import { assistantSelectors } from '@/store/discover/selectors';
import { AssistantSorts, McpSorts } from '@/types/discover';

import ListLoading from '../../components/ListLoading';
import Title from '../../components/Title';
import AssistantList from '../agent/features/List';
import McpList from '../mcp/features/List';
import CreatorRewardBanner from './features/CreatorRewardBanner';

const HomePage = memo(() => {
  const { t } = useTranslation('discover');
  const useAssistantList = useDiscoverStore((s) => s.useFetchAssistantList);
  const useMcpList = useDiscoverStore((s) => s.useFetchMcpList);

  const {
    error: assistantError,
    isLoading: assistantLoading,
    mutate: refetchAssistants,
    queryKey: assistantQueryKey,
  } = useAssistantList({
    page: 1,
    pageSize: 12,
    sort: AssistantSorts.Recommended,
  });
  const assistantList = useDiscoverStore(assistantSelectors.assistantList(assistantQueryKey));

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

HomePage.displayName = 'CommunityHomePage';

export default HomePage;
