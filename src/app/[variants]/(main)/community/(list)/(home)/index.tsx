'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDiscoverStore } from '@/store/discover';
import { McpSorts, AssistantSorts } from '@/types/discover';

import Title from '../../components/Title';
import AssistantList from '../assistant/features/List';
import McpList from '../mcp/features/List';
import Loading from './loading';

const HomePage = memo(() => {
  const { t } = useTranslation('discover');
  const useAssistantList = useDiscoverStore((s) => s.useAssistantList);
  const useMcpList = useDiscoverStore((s) => s.useFetchMcpList);

  const { data: assistantList, isLoading: assistantLoading } = useAssistantList({
    page: 1,
    pageSize: 12,
    sort: AssistantSorts.Recommended,
  });

  const { data: mcpList, isLoading: pluginLoading } = useMcpList({
    page: 1,
    pageSize: 12,
    sort: McpSorts.Recommended,
  });

  if (assistantLoading || pluginLoading || !assistantList || !mcpList) return <Loading />;

  return (
    <>
      <Title more={t('home.more')} moreLink={'/community/assistant'}>
        {t('home.featuredAssistants')}
      </Title>
      <AssistantList data={assistantList.items} rows={4} />
      <div />
      <Title more={t('home.more')} moreLink={'/community/mcp'}>
        {t('home.featuredTools')}
      </Title>
      <McpList data={mcpList.items} rows={4} />
    </>
  );
});

export default HomePage;
