'use client';

import { Avatar, Icon } from '@lobehub/ui';
import { McpIcon } from '@lobehub/ui/icons';
import * as stylex from '@stylexjs/stylex';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import SkillListRow from '@/features/Settings/skill/features/SkillListRow';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useCategory as useMcpCategory } from '@/hooks/useMCPCategory';
import { useQuery } from '@/hooks/useQuery';
import Pagination from '@/routes/(main)/community/(list)/features/Pagination';
import McpEmpty from '@/routes/(main)/community/features/McpEmpty';
import { discoverService } from '@/services/discover';
import { useDiscoverStore } from '@/store/discover';
import { mcpSelectors } from '@/store/discover/selectors';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';
import { type DiscoverMcpItem, McpCategory, type McpQueryParams, McpSorts } from '@/types/discover';

import CatalogViewTabs from '../CatalogViewTabs';
import { MARKETPLACE_CONNECTOR_PATH, MARKETPLACE_MCP_PATH } from '../paths';
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

/**
 * A market MCP server as a Codex catalog row. Both the row and `+` open its
 * detail page: adding a server needs its connection settings, which live there.
 */
const McpCatalogRow = memo<{ item: DiscoverMcpItem }>(({ item }) => {
  const { description, icon, identifier, name } = item;
  const { t } = useTranslation('discover');
  const navigate = useWorkspaceAwareNavigate();
  const installed = useToolStore(pluginSelectors.isPluginInstalled(identifier));

  const openDetail = useCallback(() => {
    discoverService
      .reportMcpEvent({ event: 'click', identifier, source: location.pathname })
      .catch(() => {});
    navigate(urlJoin(MARKETPLACE_MCP_PATH, identifier));
  }, [identifier, navigate]);

  return (
    <SkillListRow
      summary={description}
      testId={'mcp-item'}
      title={name}
      extra={
        <RowAction
          addLabel={t('catalog.add')}
          installed={installed}
          installedLabel={t('catalog.installed')}
          onAdd={openDetail}
        />
      }
      icon={() =>
        icon ? (
          <Avatar avatar={icon} shape={'square'} size={24} />
        ) : (
          <Icon icon={McpIcon} size={20} />
        )
      }
      onClick={openDetail}
    />
  );
});

McpCatalogRow.displayName = 'MarketplaceMcpCatalogRow';

interface McpGroup {
  eager: boolean;
  label: string;
  params: McpQueryParams;
  to: string;
}

/** One Discover group: fetches its preview once it nears the viewport. */
const McpCatalogGroup = memo<McpGroup>(({ eager, label, params, to }) => {
  const [sectionRef, seen] = useSeenOnce(eager);
  const useMcpList = useDiscoverStore((s) => s.useFetchMcpList);
  const { error, mutate, queryKey } = useMcpList(
    { ...params, page: 1, pageSize: CATALOG_SECTION_SIZE },
    { enabled: seen },
  );
  const data = useDiscoverStore(mcpSelectors.mcpList(queryKey));

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
        <McpCatalogRow item={item} key={item.identifier} />
      ))}
    </CatalogSection>
  );
});

McpCatalogGroup.displayName = 'MarketplaceMcpCatalogGroup';

/** The sorts that open the page as their own groups, before the categories. */
const useFeaturedMcpGroups = () => {
  const { t } = useTranslation('discover');
  return useMemo(
    () => [
      { label: t('catalog.recommended'), sort: McpSorts.Recommended },
      { label: t('catalog.new'), sort: McpSorts.CreatedAt },
    ],
    [t],
  );
};

/** `discover` and `all` are views of the whole catalog, not groups of their own. */
const MCP_PSEUDO_CATEGORIES = [McpCategory.All, McpCategory.Discover];

/** The bare Discover page: Recommended, New, then every category with servers. */
const McpCatalogGroups = memo(() => {
  const categories = useMcpCategory();
  const featured = useFeaturedMcpGroups();
  const useMcpCategories = useDiscoverStore((s) => s.useMcpCategories);
  const { queryKey } = useMcpCategories({});
  const counts = useDiscoverStore(mcpSelectors.mcpCategories(queryKey));

  const groups = useMemo(
    () => [
      ...featured.map(({ label, sort }) => ({
        key: sort,
        label,
        params: { sort },
        to: buildCatalogListUrl(MARKETPLACE_CONNECTOR_PATH, { sort }),
      })),
      ...orderCategoriesByCount(categories, counts, MCP_PSEUDO_CATEGORIES).map(
        ({ key, label }) => ({
          key,
          label,
          params: { category: key, sort: McpSorts.Recommended },
          to: buildCatalogListUrl(MARKETPLACE_CONNECTOR_PATH, { category: key }),
        }),
      ),
    ],
    [categories, counts, featured],
  );

  return (
    <div {...stylex.props(catalogStyles.sections)}>
      {groups.map(({ key, ...group }, index) => (
        <McpCatalogGroup eager={index < 2} key={key} {...group} />
      ))}
    </div>
  );
});

McpCatalogGroups.displayName = 'MarketplaceMcpCatalogGroups';

/** Every server of one category, sort or search, behind a group heading. */
const McpCatalogList = memo(() => {
  const { t } = useTranslation('discover');
  const { q, page, category, sort, order } = useQuery() as McpQueryParams;
  const categories = useMcpCategory();
  const featured = useFeaturedMcpGroups();
  const useMcpList = useDiscoverStore((s) => s.useFetchMcpList);
  const { error, isLoading, mutate, queryKey } = useMcpList({
    category,
    order,
    page,
    pageSize: CATALOG_LIST_PAGE_SIZE,
    q,
    sort: sort ?? McpSorts.Recommended,
  });
  const data = useDiscoverStore(mcpSelectors.mcpList(queryKey));
  const items = data?.items ?? [];

  const title = q
    ? t('catalog.searchResults', { keyword: q })
    : (categories.find((item) => item.key === category)?.label ??
      featured.find((item) => item.sort === sort)?.label ??
      t(`mcp.sorts.${sort}` as any));

  return (
    <CatalogListView
      backTo={MARKETPLACE_CONNECTOR_PATH}
      empty={<McpEmpty />}
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
            path={MARKETPLACE_CONNECTOR_PATH}
            total={data.totalCount}
          />
        )
      }
      onRetry={() => mutate()}
    >
      {items.map((item) => (
        <McpCatalogRow item={item} key={item.identifier} />
      ))}
    </CatalogListView>
  );
});

McpCatalogList.displayName = 'MarketplaceMcpCatalogList';

/**
 * `/marketplace/connector`: the Discover half of Connectors, which merges the
 * former MCP list into the connector entry. Laid out like Codex Plugins: groups
 * (Recommended, New, then each category) previewing a few rows; a group
 * heading opens its full list. Installed connectors are the other tab.
 */
const ConnectorCatalog = memo(() => {
  const query = useQuery() as McpQueryParams;

  return (
    <>
      <CatalogViewTabs active={'discover'} kind={'connector'} />
      {isCatalogListView(query) ? <McpCatalogList /> : <McpCatalogGroups />}
    </>
  );
});

ConnectorCatalog.displayName = 'MarketplaceConnectorCatalog';

export default ConnectorCatalog;
