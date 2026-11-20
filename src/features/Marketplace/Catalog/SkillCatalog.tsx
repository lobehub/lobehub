'use client';

import { Avatar } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { createSkillDetailModal } from '@/features/CommunitySkillDetail';
import { useMarketSkillInstall } from '@/features/CommunitySkillDetail/useMarketSkillInstall';
import SkillListRow from '@/features/Settings/skill/features/SkillListRow';
import { useQuery } from '@/hooks/useQuery';
import { useSkillCategory } from '@/hooks/useSkillCategory';
import Pagination from '@/routes/(main)/community/(list)/features/Pagination';
import SkillEmpty from '@/routes/(main)/community/features/SkillEmpty';
import { discoverService } from '@/services/discover';
import { useDiscoverStore } from '@/store/discover';
import { skillSelectors } from '@/store/discover/selectors';
import { useToolStore } from '@/store/tool';
import {
  type DiscoverSkillItem,
  SkillCategory,
  type SkillQueryParams,
  SkillSorts,
} from '@/types/discover';

import CatalogViewTabs from '../CatalogViewTabs';
import { MARKETPLACE_SKILL_PATH } from '../paths';
import CatalogListView from './CatalogListView';
import CatalogSection, { useSeenOnce } from './CatalogSection';
import RowAction from './RowAction';
import {
  buildCatalogListUrl,
  CATALOG_LIST_PAGE_SIZE,
  CATALOG_SECTION_SIZE,
  isCatalogListView,
  orderCategoriesByCount,
} from './sections';
import { catalogStyles } from './styles';

/** A market skill as a Codex catalog row: open its detail, `+` installs it. */
const SkillCatalogRow = memo<{ item: DiscoverSkillItem }>(({ item }) => {
  const { description, icon, identifier, name } = item;
  const { t } = useTranslation('discover');
  const { t: tp } = useTranslation('plugin');
  const { canCreate, install, installed, installing } = useMarketSkillInstall(identifier, name);

  const openDetail = useCallback(() => {
    discoverService
      .reportSkillEvent({ event: 'click', identifier, source: location.pathname })
      .catch(() => {});
    createSkillDetailModal({ identifier });
  }, [identifier]);

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
          onAdd={install}
        />
      }
      onClick={openDetail}
    />
  );
});

SkillCatalogRow.displayName = 'MarketplaceSkillCatalogRow';

interface SkillGroup {
  eager: boolean;
  label: string;
  params: SkillQueryParams;
  to: string;
}

/** One Discover group: fetches its preview once it nears the viewport. */
const SkillCatalogGroup = memo<SkillGroup>(({ eager, label, params, to }) => {
  const [sectionRef, seen] = useSeenOnce(eager);
  const useSkillList = useDiscoverStore((s) => s.useFetchSkillList);
  const { error, mutate, queryKey } = useSkillList(
    { ...params, page: 1, pageSize: CATALOG_SECTION_SIZE },
    { enabled: seen },
  );
  const data = useDiscoverStore(skillSelectors.skillList(queryKey));

  // A group with nothing in it is not worth a heading.
  if (data && data.items.length === 0) return null;

  return (
    <CatalogSection
      error={data ? undefined : error}
      label={label}
      loading={!data}
      sectionRef={sectionRef}
      to={to}
      onRetry={() => mutate()}
    >
      {data?.items.map((item) => (
        <SkillCatalogRow item={item} key={item.identifier} />
      ))}
    </CatalogSection>
  );
});

SkillCatalogGroup.displayName = 'MarketplaceSkillCatalogGroup';

/** The sorts that open the page as their own groups, before the categories. */
const useFeaturedSkillGroups = () => {
  const { t } = useTranslation('discover');
  return useMemo(
    () => [
      { label: t('catalog.popular'), sort: SkillSorts.InstallCount },
      { label: t('catalog.new'), sort: SkillSorts.CreatedAt },
    ],
    [t],
  );
};

/** The bare Discover page: Popular, New, then every category with skills. */
const SkillCatalogGroups = memo(() => {
  const categories = useSkillCategory();
  const featured = useFeaturedSkillGroups();
  const useSkillCategories = useDiscoverStore((s) => s.useSkillCategories);
  const { queryKey } = useSkillCategories({});
  const counts = useDiscoverStore(skillSelectors.skillCategories(queryKey));

  const groups = useMemo(
    () => [
      ...featured.map(({ label, sort }) => ({
        key: sort,
        label,
        params: { sort },
        to: buildCatalogListUrl(MARKETPLACE_SKILL_PATH, { sort }),
      })),
      ...orderCategoriesByCount(categories, counts, [SkillCategory.All]).map(({ key, label }) => ({
        key,
        label,
        params: { category: key, sort: SkillSorts.InstallCount },
        to: buildCatalogListUrl(MARKETPLACE_SKILL_PATH, { category: key }),
      })),
    ],
    [categories, counts, featured],
  );

  return (
    <div {...stylex.props(catalogStyles.sections)}>
      {groups.map(({ key, ...group }, index) => (
        <SkillCatalogGroup eager={index < 2} key={key} {...group} />
      ))}
    </div>
  );
});

SkillCatalogGroups.displayName = 'MarketplaceSkillCatalogGroups';

/** Every skill of one category, sort or search, behind a group heading. */
const SkillCatalogList = memo(() => {
  const { t } = useTranslation('discover');
  const { q, page, category, sort, order } = useQuery() as SkillQueryParams;
  const categories = useSkillCategory();
  const featured = useFeaturedSkillGroups();
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

  const title = q
    ? t('catalog.searchResults', { keyword: q })
    : (categories.find((item) => item.key === category)?.label ??
      featured.find((item) => item.sort === sort)?.label ??
      t(`skills.sorts.${sort}` as any));

  return (
    <CatalogListView
      backTo={MARKETPLACE_SKILL_PATH}
      empty={<SkillEmpty />}
      error={error}
      hasData={!!data}
      isEmpty={items.length === 0}
      loading={isLoading}
      title={title}
      pagination={
        data && (
          <Pagination
            currentPage={data.currentPage}
            pageSize={data.pageSize}
            path={MARKETPLACE_SKILL_PATH}
            total={data.totalCount}
          />
        )
      }
      onRetry={() => mutate()}
    >
      {items.map((item) => (
        <SkillCatalogRow item={item} key={item.identifier} />
      ))}
    </CatalogListView>
  );
});

SkillCatalogList.displayName = 'MarketplaceSkillCatalogList';

/**
 * `/marketplace/skill`: the skills catalog laid out like Codex Plugins. With no
 * filter it is a page of groups (Popular, New, then each category) previewing
 * a few rows; a group heading opens that group's full list.
 */
const SkillCatalog = memo(() => {
  const query = useQuery() as SkillQueryParams;
  // Rows show whether each skill is already installed.
  const useFetchAgentSkills = useToolStore((s) => s.useFetchAgentSkills);
  useFetchAgentSkills(true);

  return (
    <>
      {/* Desktop and mobile both mount this page, so the Discover / Installed switch lives here. */}
      <CatalogViewTabs active={'discover'} kind={'skill'} />
      {isCatalogListView(query) ? <SkillCatalogList /> : <SkillCatalogGroups />}
    </>
  );
});

SkillCatalog.displayName = 'MarketplaceSkillCatalog';

export default SkillCatalog;
