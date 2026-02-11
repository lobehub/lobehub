'use client';

import { type SkillListItem } from '@lobechat/types';
import { Center, Icon, Text } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { ServerCrash } from 'lucide-react';
import { memo, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { VirtuosoGrid } from 'react-virtuoso';

import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/selectors';
import { type DiscoverMcpItem } from '@/types/discover';

import AgentSkillItem from '../CustomList/AgentSkillItem';
import Empty from '../Empty';
import Loading from '../Loading';
import VirtuosoLoading from '../VirtuosoLoading';
import { virtuosoGridStyles } from '../style';
import Item from './Item';

type CommunityListItem =
  | { itemType: 'agentSkill'; skill: SkillListItem }
  | { data: DiscoverMcpItem, itemType: 'mcp'; };

export const CommunityList = memo(() => {
  const { t } = useTranslation('setting');

  const [
    keywords,
    isMcpListInit,
    allItems,
    currentPage,
    searchLoading,
    useFetchMCPPluginList,
    loadMoreMCPPlugins,
    resetMCPPluginList,
    useFetchAgentSkills,
  ] = useToolStore((s) => [
    s.mcpSearchKeywords,
    s.isMcpListInit,
    s.mcpPluginItems,
    s.currentPage,
    s.searchLoading,
    s.useFetchMCPPluginList,
    s.loadMoreMCPPlugins,
    s.resetMCPPluginList,
    s.useFetchAgentSkills,
  ]);

  const marketAgentSkills = useToolStore(agentSkillsSelectors.getMarketAgentSkills, isEqual);
  useFetchAgentSkills(true);

  const filteredMarketAgentSkills = useMemo(() => {
    const lowerKeywords = (keywords || '').toLowerCase().trim();
    if (!lowerKeywords) return marketAgentSkills;

    return marketAgentSkills.filter((skill) => {
      const name = skill.name?.toLowerCase() || '';
      const identifier = skill.identifier?.toLowerCase() || '';
      return name.includes(lowerKeywords) || identifier.includes(lowerKeywords);
    });
  }, [marketAgentSkills, keywords]);

  const combinedItems = useMemo<CommunityListItem[]>(() => {
    const agentSkillItems: CommunityListItem[] = filteredMarketAgentSkills.map((skill) => ({
      itemType: 'agentSkill' as const,
      skill,
    }));
    const mcpItems: CommunityListItem[] = allItems.map((data) => ({
      data,
      itemType: 'mcp' as const,
    }));
    return [...agentSkillItems, ...mcpItems];
  }, [filteredMarketAgentSkills, allItems]);

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

    if (combinedItems.length === 0) return <Empty search={hasSearchKeywords} />;

    return (
      <VirtuosoGrid
        components={{
          Footer: isLoading ? VirtuosoLoading : () => <div style={{ height: 16 }} />,
        }}
        data={combinedItems}
        endReached={loadMoreMCPPlugins}
        increaseViewportBy={typeof window !== 'undefined' ? window.innerHeight : 0}
        itemClassName={virtuosoGridStyles.item}
        itemContent={(_, item) =>
          item.itemType === 'agentSkill' ? (
            <AgentSkillItem skill={item.skill} />
          ) : (
            <Item {...item.data} />
          )
        }
        listClassName={virtuosoGridStyles.list}
        overscan={24}
        style={{ height: '60vh', width: '100%' }}
      />
    );
  };

  return renderContent();
});

CommunityList.displayName = 'CommunityList';

export default CommunityList;
