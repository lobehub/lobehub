'use client';

import { Avatar, Button, Tag } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import AsyncBoundary from '@/components/AsyncBoundary';
import { CatalogRowsSkeleton } from '@/components/Skeleton/MarketplaceCatalog';
import { buildAssistantListQuery } from '@/features/CommunityAgentList/assistantListQuery';
import SkillListRow from '@/features/Settings/skill/features/SkillListRow';
import { useQuery } from '@/hooks/useQuery';
import Pagination from '@/routes/(main)/community/(list)/features/Pagination';
import SortButton from '@/routes/(main)/community/(list)/features/SortButton';
import AssistantEmpty from '@/routes/(main)/community/features/AssistantEmpty';
import { discoverService } from '@/services/discover';
import { useDiscoverStore } from '@/store/discover';
import { assistantSelectors } from '@/store/discover/selectors';
import {
  AssistantCategory,
  type AssistantMarketSource,
  type AssistantQueryParams,
  AssistantSorts,
  type DiscoverAssistantItem,
} from '@/types/discover';

import { MARKETPLACE_AGENT_PATH, MARKETPLACE_PATH } from '../paths';
import CatalogListView from './CatalogListView';
import CatalogSection, { useSeenOnce } from './CatalogSection';
import DiscoverCatalogHeader from './DiscoverCatalogHeader';
import {
  buildCatalogListUrl,
  CATALOG_LIST_PAGE_SIZE,
  CATALOG_SECTION_SIZE,
  isCatalogListView,
  orderCategoriesByCount,
} from './sections';
import { catalogStyles } from './styles';
import { useCatalogDetailNavigate } from './useCatalogDetailNavigate';

const BROWSE_CATEGORIES = Object.values(AssistantCategory).filter(
  (category) => category !== AssistantCategory.All && category !== AssistantCategory.Discover,
);

const AgentCatalogRow = ({
  item,
  source,
}: {
  item: DiscoverAssistantItem;
  source?: AssistantMarketSource;
}) => {
  const { t } = useTranslation('discover');
  const navigate = useCatalogDetailNavigate();
  const { avatar, backgroundColor, description, identifier, title, type = 'agent' } = item;
  const isGroup = type === 'agent-group';
  const name = title || identifier;
  const label = t('assistants.detail');

  const openDetail = () => {
    const path = urlJoin(
      isGroup ? `${MARKETPLACE_PATH}/group_agent` : MARKETPLACE_AGENT_PATH,
      identifier,
    );
    discoverService
      .reportAgentEvent({ event: 'click', identifier, source: location.pathname })
      .catch(() => {});
    navigate(buildCatalogListUrl(path, { source }));
  };

  return (
    <SkillListRow
      agentType={type}
      summary={description}
      testId={'assistant-item'}
      title={name}
      extra={
        <>
          {isGroup && <Tag size={'small'}>{t('groupAgents.tag')}</Tag>}
          <Button
            aria-label={t('catalog.rowAction', { action: label, name })}
            size={'small'}
            onClick={(event) => {
              event.stopPropagation();
              openDetail();
            }}
          >
            {label}
          </Button>
        </>
      }
      icon={() => (
        <Avatar avatar={avatar || name} background={backgroundColor} shape={'square'} size={32} />
      )}
      onClick={openDetail}
    />
  );
};

const useCatalogAgents = (query: AssistantQueryParams, enabled = true) => {
  const useAssistantList = useDiscoverStore((s) => s.useFetchAssistantList);
  const { queryKey, ...state } = useAssistantList(buildAssistantListQuery(query), { enabled });
  return { ...state, data: useDiscoverStore(assistantSelectors.assistantList(queryKey)) };
};

const AgentCatalogGroup = ({
  category,
  count,
  eager,
  label,
  q,
  source,
}: {
  category: AssistantCategory;
  count: number;
  eager: boolean;
  label: string;
  q?: string;
  source?: AssistantMarketSource;
}) => {
  const [sectionRef, seen] = useSeenOnce(eager);
  const { data, error, mutate } = useCatalogAgents(
    { category, includeCategoryCounts: false, pageSize: CATALOG_SECTION_SIZE, q, source },
    seen,
  );

  if (data?.items.length === 0) return null;

  return (
    <CatalogSection
      count={data?.totalCount ?? count}
      error={data ? undefined : error}
      label={label}
      loading={!data}
      sectionRef={sectionRef}
      to={buildCatalogListUrl(MARKETPLACE_AGENT_PATH, { category, q, source })}
      onRetry={() => void mutate()}
    >
      {data?.items.slice(0, CATALOG_SECTION_SIZE).map((item) => (
        <AgentCatalogRow item={item} key={item.identifier} source={source} />
      ))}
    </CatalogSection>
  );
};

const AgentCatalogGroups = ({ q, source }: Pick<AssistantQueryParams, 'q' | 'source'>) => {
  const { t } = useTranslation('discover');
  const { data, error, isLoading, mutate } = useCatalogAgents({
    includeCategoryCounts: true,
    pageSize: CATALOG_SECTION_SIZE,
    q,
    source,
  });
  const useAssistantCategories = useDiscoverStore((s) => s.useFetchAssistantCategories);
  const { queryKey } = useAssistantCategories({ q, source }, { enabled: !data?.categoryCounts });
  const fallbackCounts = useDiscoverStore(assistantSelectors.assistantCategories(queryKey));
  const groups = orderCategoriesByCount(
    BROWSE_CATEGORIES.map((key) => ({ key, label: t(`category.assistant.${key}`) })),
    data?.categoryCounts ?? fallbackCounts,
  );

  return (
    <div {...stylex.props(catalogStyles.sections)}>
      <AsyncBoundary
        data={data}
        empty={<AssistantEmpty search={Boolean(q)} />}
        error={error}
        isEmpty={data?.items.length === 0 && groups.length === 0}
        isLoading={isLoading}
        loading={<CatalogRowsSkeleton />}
        onRetry={() => void mutate()}
      >
        {data && data.items.length > 0 && (!q || groups.length === 0) && (
          <CatalogSection
            count={data.totalCount}
            label={t(q ? 'catalog.allAgents' : 'catalog.recommended')}
            loading={false}
            to={buildCatalogListUrl(MARKETPLACE_AGENT_PATH, {
              q,
              sort: AssistantSorts.Recommended,
              source,
            })}
          >
            {data.items.slice(0, CATALOG_SECTION_SIZE).map((item) => (
              <AgentCatalogRow item={item} key={item.identifier} source={source} />
            ))}
          </CatalogSection>
        )}
        {groups.map(({ count, key, label }, index) => (
          <AgentCatalogGroup
            category={key}
            count={count}
            eager={index < 2}
            key={key}
            label={label}
            q={q}
            source={source}
          />
        ))}
      </AsyncBoundary>
    </div>
  );
};

const AgentCatalogList = ({ query }: { query: AssistantQueryParams }) => {
  const { data, error, isLoading, mutate } = useCatalogAgents({
    ...query,
    includeCategoryCounts: false,
    pageSize: CATALOG_LIST_PAGE_SIZE,
  });

  return (
    <CatalogListView
      empty={<AssistantEmpty search={Boolean(query.q)} />}
      error={error}
      hasData={Boolean(data)}
      isEmpty={!data?.items.length}
      loading={isLoading}
      pagination={
        data &&
        data.totalPages > 1 && (
          <Pagination
            currentPage={data.currentPage}
            pageSize={data.pageSize}
            path={MARKETPLACE_AGENT_PATH}
            total={data.totalCount}
          />
        )
      }
      onRetry={() => void mutate()}
    >
      {data?.items.map((item) => (
        <AgentCatalogRow item={item} key={item.identifier} source={query.source} />
      ))}
    </CatalogListView>
  );
};

export const AgentCatalog = () => {
  const { t } = useTranslation('discover');
  const query = useQuery() as AssistantQueryParams;
  const { category, q, sort, source } = query;
  const isGroup = isCatalogListView(query);
  const categoryLabel = BROWSE_CATEGORIES.find((key) => key === category);
  const title = categoryLabel
    ? t(`category.assistant.${categoryLabel}`)
    : t(sort === AssistantSorts.Recommended && !q ? 'catalog.recommended' : 'catalog.allAgents');

  return (
    <div {...stylex.props(catalogStyles.frame, isGroup && catalogStyles.groupFrame)}>
      <DiscoverCatalogHeader
        kind={'agent'}
        sortControl={<SortButton resetPage />}
        group={
          isGroup
            ? { backTo: buildCatalogListUrl(MARKETPLACE_AGENT_PATH, { q, source }), title }
            : undefined
        }
      />
      {isGroup ? <AgentCatalogList query={query} /> : <AgentCatalogGroups q={q} source={source} />}
    </div>
  );
};
