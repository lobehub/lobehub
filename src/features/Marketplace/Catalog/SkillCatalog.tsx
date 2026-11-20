'use client';

import { Avatar } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import AsyncBoundary from '@/components/AsyncBoundary';
import { CatalogRowsSkeleton } from '@/components/Skeleton/MarketplaceCatalog';
import { useMarketSkillInstall } from '@/features/CommunitySkillDetail/useMarketSkillInstall';
import AgentSkillItem from '@/features/Settings/skill/features/AgentSkillItem';
import { matchesConnectorKeyword } from '@/features/Settings/skill/features/connectorSections';
import SkillListRow from '@/features/Settings/skill/features/SkillListRow';
import { useQuery } from '@/hooks/useQuery';
import { useSkillCategory } from '@/hooks/useSkillCategory';
import Pagination from '@/routes/(main)/community/(list)/features/Pagination';
import SortButton from '@/routes/(main)/community/(list)/features/SortButton';
import SkillEmpty from '@/routes/(main)/community/features/SkillEmpty';
import { discoverService } from '@/services/discover';
import { useDiscoverStore } from '@/store/discover';
import { skillSelectors } from '@/store/discover/selectors';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/selectors';
import {
  type DiscoverSkillItem,
  SkillCategory,
  type SkillQueryParams,
  SkillSorts,
} from '@/types/discover';

import CatalogViewTabs from '../CatalogViewTabs';
import { buildInstalledDetailPath } from '../InstalledNav';
import { MARKETPLACE_SKILL_PATH } from '../paths';
import CatalogListView from './CatalogListView';
import CatalogSection, { useSeenOnce } from './CatalogSection';
import DiscoverCatalogHeader from './DiscoverCatalogHeader';
import RowAction from './RowAction';
import {
  buildCatalogListUrl,
  CATALOG_LIST_PAGE_SIZE,
  CATALOG_SECTION_SIZE,
  isCatalogListView,
  orderCategoriesByCount,
} from './sections';
import { catalogStyles } from './styles';
import { useCatalogDetailNavigate } from './useCatalogDetailNavigate';

const SkillCatalogRow = memo<{ item: DiscoverSkillItem }>(({ item }) => {
  const { description, icon, identifier, name } = item;
  const { t } = useTranslation('discover');
  const { t: tp } = useTranslation('plugin');
  const { canCreate, install, installed, installing } = useMarketSkillInstall(identifier, name);
  const navigate = useCatalogDetailNavigate();

  return (
    <SkillListRow
      icon={() => <Avatar avatar={icon || name} shape={'square'} size={24} />}
      summary={description}
      testId={'skill-item'}
      title={name}
      extra={
        <RowAction
          addLabel={tp('store.actions.install')}
          disabled={!canCreate}
          installed={installed}
          installedLabel={t('skills.details.header.installed')}
          loading={installing}
          name={name}
          onAdd={install}
        />
      }
      onClick={() => {
        discoverService
          .reportSkillEvent({ event: 'click', identifier, source: location.pathname })
          .catch(() => {});
        navigate(urlJoin(MARKETPLACE_SKILL_PATH, identifier));
      }}
    />
  );
});

SkillCatalogRow.displayName = 'MarketplaceSkillCatalogRow';

interface SkillGroup {
  category: SkillCategory;
  count: number;
  eager: boolean;
  label: string;
  q?: string;
}

const SkillCatalogGroup = ({ category, count, eager, label, q }: SkillGroup) => {
  const [sectionRef, seen] = useSeenOnce(eager);
  const useSkillList = useDiscoverStore((s) => s.useFetchSkillList);
  const { error, mutate, queryKey } = useSkillList(
    { category, page: 1, pageSize: CATALOG_SECTION_SIZE, q, sort: SkillSorts.InstallCount },
    { enabled: seen },
  );
  const data = useDiscoverStore(skillSelectors.skillList(queryKey));

  if (data?.items.length === 0) return null;

  return (
    <CatalogSection
      count={data?.totalCount ?? count}
      error={data ? undefined : error}
      label={label}
      loading={!data}
      sectionRef={sectionRef}
      to={buildCatalogListUrl(MARKETPLACE_SKILL_PATH, { category, q })}
      onRetry={() => void mutate()}
    >
      {data?.items.slice(0, CATALOG_SECTION_SIZE).map((item) => (
        <SkillCatalogRow item={item} key={item.identifier} />
      ))}
    </CatalogSection>
  );
};

const SkillCatalogGroups = ({
  installedSection,
  q,
}: {
  installedSection?: React.ReactNode;
  q?: string;
}) => {
  const categories = useSkillCategory();
  const useSkillCategories = useDiscoverStore((s) => s.useSkillCategories);
  const { error, isLoading, mutate, queryKey } = useSkillCategories({ q });
  const counts = useDiscoverStore(skillSelectors.skillCategories(queryKey));
  const groups = orderCategoriesByCount(categories, counts, [SkillCategory.All]);

  return (
    <div {...stylex.props(catalogStyles.sections)}>
      {installedSection}
      <AsyncBoundary
        data={counts.length > 0 ? counts : undefined}
        error={error}
        isLoading={isLoading}
        loading={<CatalogRowsSkeleton />}
        onRetry={() => void mutate()}
      >
        {groups.length === 0 ? (
          <SkillCatalogList query={{ q }} showEmpty={!installedSection} />
        ) : (
          groups.map(({ count, key, label }, index) => (
            <SkillCatalogGroup
              category={key}
              count={count}
              eager={index < 2}
              key={key}
              label={label}
              q={q}
            />
          ))
        )}
      </AsyncBoundary>
    </div>
  );
};

const SkillCatalogList = ({
  query: { category, order, page, q, sort },
  showEmpty = true,
}: {
  query: SkillQueryParams;
  showEmpty?: boolean;
}) => {
  const useSkillList = useDiscoverStore((s) => s.useFetchSkillList);
  const { error, isLoading, mutate, queryKey } = useSkillList({
    category,
    order,
    page,
    pageSize: CATALOG_LIST_PAGE_SIZE,
    q,
    sort: sort ?? SkillSorts.InstallCount,
  });
  const data = useDiscoverStore(skillSelectors.skillList(queryKey));
  const items = data?.items ?? [];

  return (
    <CatalogListView
      empty={showEmpty && <SkillEmpty search={Boolean(q)} />}
      error={error}
      hasData={!!data}
      isEmpty={items.length === 0}
      loading={isLoading}
      pagination={
        data &&
        data.totalPages > 1 && (
          <Pagination
            currentPage={data.currentPage}
            pageSize={data.pageSize}
            path={MARKETPLACE_SKILL_PATH}
            total={data.totalCount}
          />
        )
      }
      onRetry={() => void mutate()}
    >
      {items.map((item) => (
        <SkillCatalogRow item={item} key={item.identifier} />
      ))}
    </CatalogListView>
  );
};

const SkillCatalog = () => {
  const { t } = useTranslation('discover');
  const { group, ...query } = useQuery() as SkillQueryParams & { group?: string };
  const { category, q, sort } = query;
  const categories = useSkillCategory();
  const openDetail = useCatalogDetailNavigate();
  const useFetchAgentSkills = useToolStore((s) => s.useFetchAgentSkills);
  const skillLibrary = useFetchAgentSkills(true);
  const installed = useToolStore(agentSkillsSelectors.getAgentSkills, isEqual);
  const localSkills = installed.filter((skill) =>
    matchesConnectorKeyword(q, [skill.name, skill.identifier, skill.description]),
  );

  const isInstalledGroup = group === 'installed';
  const isMarketGroup = isCatalogListView(query);
  const backTo = buildCatalogListUrl(MARKETPLACE_SKILL_PATH, { q });
  const localLabel = t('catalog.yourSkills');
  const title = isInstalledGroup
    ? localLabel
    : (categories.find((item) => item.key === category)?.label ??
      (sort === SkillSorts.CreatedAt ? t('catalog.new') : t('catalog.allSkills')));
  const renderLocalSkills = (skills: typeof localSkills) =>
    skills.map((skill) => (
      <AgentSkillItem
        key={skill.id}
        skill={skill}
        onSelect={() => openDetail(buildInstalledDetailPath('skill', skill.id, 'agent-skill'))}
      />
    ));

  return (
    <div
      {...stylex.props(
        catalogStyles.frame,
        (isInstalledGroup || isMarketGroup) && catalogStyles.groupFrame,
      )}
    >
      <DiscoverCatalogHeader
        group={isInstalledGroup || isMarketGroup ? { backTo, title } : undefined}
        kind={'skill'}
        sortControl={isMarketGroup && !isInstalledGroup ? <SortButton resetPage /> : undefined}
      />
      <CatalogViewTabs active={'discover'} kind={'skill'} />
      {isInstalledGroup ? (
        <CatalogListView
          empty={<SkillEmpty search={Boolean(q)} />}
          error={skillLibrary.error}
          hasData={installed.length > 0}
          isEmpty={localSkills.length === 0}
          loading={skillLibrary.isLoading}
          onRetry={() => void skillLibrary.mutate()}
        >
          {renderLocalSkills(localSkills)}
        </CatalogListView>
      ) : isMarketGroup ? (
        <SkillCatalogList query={query} />
      ) : (
        <SkillCatalogGroups
          q={q}
          installedSection={
            localSkills.length > 0 ? (
              <CatalogSection
                count={localSkills.length}
                label={localLabel}
                loading={false}
                to={buildCatalogListUrl(MARKETPLACE_SKILL_PATH, { group: 'installed', q })}
              >
                {renderLocalSkills(localSkills.slice(0, CATALOG_SECTION_SIZE))}
              </CatalogSection>
            ) : undefined
          }
        />
      )}
    </div>
  );
};

export default SkillCatalog;
