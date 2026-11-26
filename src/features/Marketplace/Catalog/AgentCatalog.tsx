'use client';

import { Center, Segmented, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import { buildAssistantListQuery } from '@/features/CommunityAgentList/assistantListQuery';
import { CATEGORY_LABEL_KEYS } from '@/features/Onboarding/steps/AgentPickerStep/categoryLabels';
import { useOnboardingAgentTemplates } from '@/hooks/useOnboardingAgentTemplates';
import { useQuery } from '@/hooks/useQuery';
import Pagination from '@/routes/(main)/community/(list)/features/Pagination';
import { useDiscoverStore } from '@/store/discover';
import { assistantSelectors } from '@/store/discover/selectors';
import {
  AssistantCategory,
  type AssistantMarketSource,
  type AssistantQueryParams,
  AssistantSorts,
} from '@/types/discover';

import { AgentGrid, agentGridStyles, AgentSection } from '../Agents/AgentSection';
import { AgentGridSkeleton, AgentSectionSkeleton, FeaturedSkeleton } from '../Agents/AgentSkeleton';
import FeaturedAgentCard from '../Agents/FeaturedAgentCard';
import {
  AGENT_PREVIEW_COUNT,
  fromCommunity,
  fromTemplate,
  groupTemplates,
  isMarketplaceCategory,
  matchAgent,
  pickFeatured,
} from '../Agents/marketAgentCatalog';
import { MARKETPLACE_AGENT_PATH } from '../paths';
import { useSeenOnce } from './CatalogSection';
import DiscoverCatalogHeader from './DiscoverCatalogHeader';
import {
  buildCatalogListUrl,
  CATALOG_LIST_PAGE_SIZE,
  CATALOG_SECTION_SIZE,
  isCatalogListView,
  orderCategoriesByCount,
} from './sections';
import { catalogStyles } from './styles';

type AgentsTab = 'all' | 'public' | 'verified';

const TABS: AgentsTab[] = ['all', 'verified', 'public'];

const isAgentsTab = (value: string | null): value is AgentsTab => TABS.includes(value as AgentsTab);

/** The Agents page URL for a tab (omitted for "All"), keeping the search and source. */
const agentTabUrl = (tab: AgentsTab, query: { q?: string; source?: string }) => {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.source) params.set('source', query.source);
  if (tab !== 'all') params.set('tab', tab);
  const search = params.toString();
  return search ? `${MARKETPLACE_AGENT_PATH}?${search}` : MARKETPLACE_AGENT_PATH;
};

const useCategoryName = () => {
  const { t } = useTranslation('tool');
  return (category: string) =>
    isMarketplaceCategory(category) ? t(CATEGORY_LABEL_KEYS[category]) : category;
};

/** Community categories browsed in "Public", in the community's own order. */
const COMMUNITY_CATEGORIES = Object.values(AssistantCategory).filter(
  (category) => category !== AssistantCategory.All && category !== AssistantCategory.Discover,
);

const useCommunityAgents = (query: AssistantQueryParams, enabled = true) => {
  const useAssistantList = useDiscoverStore((s) => s.useFetchAssistantList);
  const { queryKey, ...state } = useAssistantList(buildAssistantListQuery(query), { enabled });
  const data = useDiscoverStore(assistantSelectors.assistantList(queryKey));
  const agents = useMemo(() => (data?.items ?? []).map(fromCommunity), [data]);
  return { ...state, agents, data };
};

/** One community category's preview; it loads once scrolled near. */
const CommunityCategory = memo<{
  category: AssistantCategory;
  count: number;
  eager: boolean;
  q?: string;
  source?: AssistantMarketSource;
}>(({ category, count, eager, q, source }) => {
  const { t } = useTranslation('discover');
  const [sectionRef, seen] = useSeenOnce(eager);
  const { agents, data, error, mutate } = useCommunityAgents(
    { category, includeCategoryCounts: false, pageSize: CATALOG_SECTION_SIZE, q, source },
    seen,
  );

  if (data?.items.length === 0) return null;

  return (
    <AgentSection
      count={data?.totalCount ?? count}
      sectionRef={sectionRef}
      title={t(`category.assistant.${category}`)}
      to={
        (data?.totalCount ?? count) > CATALOG_SECTION_SIZE
          ? buildCatalogListUrl(MARKETPLACE_AGENT_PATH, { category, q, source })
          : undefined
      }
    >
      {error && !data ? (
        <AsyncError error={error} variant={'inline'} onRetry={() => void mutate()} />
      ) : !data ? (
        <AgentGridSkeleton count={CATALOG_SECTION_SIZE} />
      ) : (
        <AgentGrid agents={agents} source={source} />
      )}
    </AgentSection>
  );
});

CommunityCategory.displayName = 'MarketplaceCommunityCategory';

/**
 * LobeHub Market's community Agents: the recommended ones, then each category
 * with a preview whose "View all" opens the whole, paged category.
 */
const CommunityAgents = memo<{ q?: string; source?: AssistantMarketSource }>(({ q, source }) => {
  const { t } = useTranslation('discover');
  const { agents, data, error, isLoading, mutate } = useCommunityAgents({
    includeCategoryCounts: true,
    pageSize: CATALOG_SECTION_SIZE,
    q,
    source,
  });
  const useAssistantCategories = useDiscoverStore((s) => s.useFetchAssistantCategories);
  const { queryKey } = useAssistantCategories({ q, source }, { enabled: !data?.categoryCounts });
  const fallbackCounts = useDiscoverStore(assistantSelectors.assistantCategories(queryKey));
  const groups = orderCategoriesByCount(
    COMMUNITY_CATEGORIES.map((key) => ({ key, label: key })),
    data?.categoryCounts ?? fallbackCounts,
  );

  if (error && !data)
    return <AsyncError error={error} variant={'inline'} onRetry={() => void mutate()} />;
  if (isLoading && !data)
    return (
      <>
        <AgentSectionSkeleton count={CATALOG_SECTION_SIZE} />
        <AgentSectionSkeleton />
      </>
    );
  if (agents.length === 0 && groups.length === 0)
    return (
      <Center paddingBlock={48}>
        <Text type={'secondary'}>{t('marketplaceAgents.emptySearch')}</Text>
      </Center>
    );

  return (
    <>
      {agents.length > 0 && (!q || groups.length === 0) && (
        <AgentSection
          count={data?.totalCount}
          title={t(q ? 'catalog.allAgents' : 'catalog.recommended')}
          to={
            (data?.totalCount ?? 0) > CATALOG_SECTION_SIZE
              ? buildCatalogListUrl(MARKETPLACE_AGENT_PATH, {
                  q,
                  sort: AssistantSorts.Recommended,
                  source,
                })
              : undefined
          }
        >
          <AgentGrid agents={agents} source={source} />
        </AgentSection>
      )}
      {groups.map(({ count, key }, index) => (
        <CommunityCategory
          category={key}
          count={count}
          eager={index < 2}
          key={key}
          q={q}
          source={source}
        />
      ))}
    </>
  );
});

CommunityAgents.displayName = 'MarketplaceCommunityAgents';

/**
 * LobeHub's own Agents (all reviewed), by category. "All" leads with the
 * featured cards.
 */
const VerifiedAgents = memo<{ all: boolean; onMore: (category: string) => void; q: string }>(
  ({ all, onMore, q }) => {
    const { t } = useTranslation('discover');
    const categoryName = useCategoryName();
    const { data: templates, error, isLoading, mutate } = useOnboardingAgentTemplates();
    const searching = q.length > 0;

    const groups = useMemo(
      () =>
        groupTemplates(templates ?? [])
          .map((group) => ({ ...group, items: group.items.filter((a) => matchAgent(a, q)) }))
          .filter((group) => group.items.length > 0),
      [q, templates],
    );
    const featured = useMemo(() => pickFeatured(templates ?? []), [templates]);

    if (isLoading && !templates)
      return (
        <>
          {all && !searching && <FeaturedSkeleton />}
          <AgentSectionSkeleton />
          <AgentSectionSkeleton />
        </>
      );

    if (error && !templates)
      return <AsyncError error={error} variant={'inline'} onRetry={() => void mutate()} />;

    return (
      <>
        {all && !searching && featured.length > 0 && (
          <AgentSection title={t('marketplaceAgents.featured')}>
            <div {...stylex.props(agentGridStyles.cards)}>
              {featured.map((agent) => (
                <FeaturedAgentCard agent={agent} key={agent.id} />
              ))}
            </div>
          </AgentSection>
        )}
        {groups.length === 0 && searching ? (
          <Center paddingBlock={48}>
            <Text type={'secondary'}>{t('marketplaceAgents.emptySearch')}</Text>
          </Center>
        ) : (
          groups.map(({ category, items }) => (
            <AgentSection
              count={items.length}
              key={category}
              title={categoryName(category)}
              onMore={
                !searching && items.length > AGENT_PREVIEW_COUNT
                  ? () => onMore(category)
                  : undefined
              }
            >
              <AgentGrid
                agents={searching ? items : items.slice(0, AGENT_PREVIEW_COUNT)}
                source={'new'}
              />
            </AgentSection>
          ))
        )}
      </>
    );
  },
);

VerifiedAgents.displayName = 'MarketplaceVerifiedAgents';

/** One LobeHub category's own page: every Agent in it. */
const AgentGroupPage = memo<{ category: string; q: string }>(({ category, q }) => {
  const { data: templates, isLoading } = useOnboardingAgentTemplates();
  const agents = useMemo(
    () =>
      (templates ?? [])
        .filter((item) => item.category === category)
        .map(fromTemplate)
        .filter((agent) => matchAgent(agent, q)),
    [category, q, templates],
  );

  if (isLoading && !templates) return <AgentGridSkeleton count={8} />;
  return <AgentGrid agents={agents} source={'new'} />;
});

AgentGroupPage.displayName = 'MarketplaceAgentGroupPage';

/**
 * A community category or sort from an older link (`?category=`, `?sort=`,
 * `?page=`): the full, paged community list in the Agent rows.
 */
const CommunityListPage = memo<{ query: AssistantQueryParams }>(({ query }) => {
  const { t } = useTranslation('discover');
  const useAssistantList = useDiscoverStore((s) => s.useFetchAssistantList);
  const { error, isLoading, mutate, queryKey } = useAssistantList(
    buildAssistantListQuery({
      ...query,
      includeCategoryCounts: false,
      pageSize: CATALOG_LIST_PAGE_SIZE,
    }),
  );
  const data = useDiscoverStore(assistantSelectors.assistantList(queryKey));
  const agents = useMemo(() => (data?.items ?? []).map(fromCommunity), [data]);
  // A response missing a paging field reads as a single page.
  const paging = {
    currentPage: data?.currentPage ?? 1,
    pageSize: data?.pageSize ?? agents.length,
    totalCount: data?.totalCount ?? agents.length,
    totalPages: data?.totalPages ?? 0,
  };

  if (error && !data)
    return <AsyncError error={error} variant={'inline'} onRetry={() => void mutate()} />;
  if (isLoading && !data) return <AgentGridSkeleton count={8} />;
  if (agents.length === 0)
    return (
      <Center paddingBlock={48}>
        <Text type={'secondary'}>{t('marketplaceAgents.emptySearch')}</Text>
      </Center>
    );

  return (
    <>
      <AgentGrid agents={agents} source={query.source} />
      {paging.totalPages > 1 && (
        <Pagination
          currentPage={paging.currentPage}
          pageSize={paging.pageSize}
          path={MARKETPLACE_AGENT_PATH}
          total={paging.totalCount}
        />
      )}
    </>
  );
});

CommunityListPage.displayName = 'MarketplaceCommunityListPage';

/**
 * The Agents page: ready-made Agents with their own instructions and skills.
 * "Verified" is LobeHub's own set by category; "Public" is the LobeHub Market
 * community; "All" is the verified set with featured picks on top. "+" adds a
 * copy to my Agents. The tab (`?tab=`), a category page (`?group=`) and the
 * search (`?q=`) live in the URL, so Back returns to the same view.
 */
export const AgentCatalog = () => {
  const { t } = useTranslation('discover');
  const categoryName = useCategoryName();
  const query = useQuery() as AssistantQueryParams & { group?: string; tab?: string };
  const [params, setParams] = useSearchParams();
  const q = query.q?.trim() ?? '';
  const tabParam = params.get('tab');
  const tab: AgentsTab = isAgentsTab(tabParam) ? tabParam : 'all';
  const group = isMarketplaceCategory(query.group) ? query.group : undefined;
  const legacyList = !group && isCatalogListView(query);

  const setTab = (next: AgentsTab) => {
    const nextParams = new URLSearchParams(params);
    for (const key of ['category', 'group', 'page', 'sort']) nextParams.delete(key);
    if (next === 'all') nextParams.delete('tab');
    else nextParams.set('tab', next);
    setParams(nextParams);
  };

  const openGroup = (category: string) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set('group', category);
    nextParams.delete('q');
    setParams(nextParams);
  };

  // A curated category page returns to the tab it was opened from.
  const backTo = agentTabUrl(tab, { source: query.source });
  const legacyCategory = Object.values(AssistantCategory).find((key) => key === query.category);
  const legacyTitle = legacyCategory
    ? t(`category.assistant.${legacyCategory}`)
    : t(
        query.sort === AssistantSorts.Recommended && !q
          ? 'catalog.recommended'
          : 'catalog.allAgents',
      );

  const header = group ? (
    <DiscoverCatalogHeader group={{ backTo, title: categoryName(group) }} kind={'agent'} />
  ) : legacyList ? (
    <DiscoverCatalogHeader
      kind={'agent'}
      group={{
        // Community categories and sorts live under "Public".
        backTo: agentTabUrl('public', { q, source: query.source }),
        title: legacyTitle,
      }}
    />
  ) : (
    <DiscoverCatalogHeader
      kind={'agent'}
      titleExtra={
        <Segmented
          value={tab}
          variant={'outlined'}
          options={TABS.map((value) => ({
            label: t(`marketplaceAgents.tabs.${value}`),
            value,
          }))}
          onChange={(value) => setTab(value as AgentsTab)}
        />
      }
    />
  );

  return (
    <div {...stylex.props(catalogStyles.frame, (group || legacyList) && catalogStyles.groupFrame)}>
      {header}
      <div {...stylex.props(catalogStyles.sections)}>
        {group ? (
          <AgentGroupPage category={group} q={q} />
        ) : legacyList ? (
          <CommunityListPage query={query} />
        ) : tab === 'public' ? (
          <CommunityAgents q={q || undefined} source={query.source} />
        ) : (
          <VerifiedAgents all={tab === 'all'} q={q} onMore={openGroup} />
        )}
      </div>
    </div>
  );
};
