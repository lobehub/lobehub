'use client';

import { Avatar, Icon } from '@lobehub/ui';
import { McpIcon } from '@lobehub/ui/icons';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import AsyncBoundary from '@/components/AsyncBoundary';
import { CatalogRowsSkeleton } from '@/components/Skeleton/MarketplaceCatalog';
import { matchesConnectorKeyword } from '@/features/Settings/skill/features/connectorSections';
import { RowAddAction, RowMoreMenu } from '@/features/Settings/skill/features/RowActions';
import SkillListRow from '@/features/Settings/skill/features/SkillListRow';
import { useCategory as useMcpCategory } from '@/hooks/useMCPCategory';
import { usePermission } from '@/hooks/usePermission';
import { useQuery } from '@/hooks/useQuery';
import Pagination from '@/routes/(main)/community/(list)/features/Pagination';
import McpEmpty from '@/routes/(main)/community/features/McpEmpty';
import { discoverService } from '@/services/discover';
import { useDiscoverStore } from '@/store/discover';
import { mcpSelectors } from '@/store/discover/selectors';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';
import { connectorSelectors } from '@/store/tool/slices/connector';
import { type DiscoverMcpItem, McpCategory, type McpQueryParams, McpSorts } from '@/types/discover';

import CatalogViewTabs from '../CatalogViewTabs';
import { buildInstalledDetailPath, MARKETPLACE_MCP_PATH } from '../paths';
import CatalogListView from './CatalogListView';
import CatalogSection, { useSeenOnce } from './CatalogSection';
import DiscoverCatalogHeader from './DiscoverCatalogHeader';
import { getInstalledMcpItems } from './installedMcps';
import { openMcpConnectModal } from './McpConnectModal';
import {
  buildCatalogListUrl,
  CATALOG_LIST_PAGE_SIZE,
  CATALOG_SECTION_SIZE,
  isCatalogListView,
  orderCategoriesByCount,
} from './sections';
import { catalogStyles } from './styles';
import { useCatalogDetailNavigate } from './useCatalogDetailNavigate';

const McpCatalogRow = memo<{ item: DiscoverMcpItem }>(({ item }) => {
  const { description, icon, identifier, name } = item;
  const { t } = useTranslation('discover');
  const { t: ts } = useTranslation('setting');
  const navigate = useCatalogDetailNavigate();
  const { allowed: canCreate } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');
  const connectLabel = t('catalog.rowAction', {
    action: ts('connectorMarket.action.connect'),
    name,
  });
  const installed = useToolStore(pluginSelectors.isPluginInstalled(identifier));

  const openDetail = () => {
    discoverService
      .reportMcpEvent({ event: 'click', identifier, source: location.pathname })
      .catch(() => {});
    if (installed) {
      const state = useToolStore.getState();
      const legacy = pluginSelectors
        .installedPluginMetaList(state)
        .find((plugin) => plugin.identifier === identifier);
      if (legacy) {
        navigate(
          buildInstalledDetailPath(
            'mcp',
            identifier,
            legacy.type === 'customPlugin' ? 'mcp-connector' : 'plugin',
          ),
        );
        return;
      }
      const installs = connectorSelectors
        .marketplaceMcpConnectors(state)
        .filter((connector) => connector.identifier === identifier);
      const connector = installs.find((item) => item.visibility !== 'private') ?? installs[0];
      if (connector) {
        navigate(
          buildInstalledDetailPath('mcp', identifier, 'mcp-connector', connector.visibility),
        );
        return;
      }
    }
    navigate(urlJoin(MARKETPLACE_MCP_PATH, identifier));
  };

  return (
    <SkillListRow
      summary={description}
      testId={'mcp-item'}
      title={name}
      extra={
        installed ? (
          <RowMoreMenu onOpenDetail={openDetail} />
        ) : (
          <RowAddAction
            disabled={!canCreate || !canEdit}
            label={connectLabel}
            onClick={() => openMcpConnectModal(item, connectLabel)}
          />
        )
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
  category: McpCategory;
  count: number;
  eager: boolean;
  label: string;
  q?: string;
}

const McpCatalogGroup = ({ category, count, eager, label, q }: McpGroup) => {
  const [sectionRef, seen] = useSeenOnce(eager);
  const useMcpList = useDiscoverStore((s) => s.useFetchMcpList);
  const { error, mutate, queryKey } = useMcpList(
    { category, page: 1, pageSize: CATALOG_SECTION_SIZE, q, sort: McpSorts.Recommended },
    { enabled: seen },
  );
  const data = useDiscoverStore(mcpSelectors.mcpList(queryKey));

  if (data?.items.length === 0) return null;

  return (
    <CatalogSection
      count={data?.totalCount ?? count}
      error={data ? undefined : error}
      label={label}
      loading={!data}
      sectionRef={sectionRef}
      to={buildCatalogListUrl(MARKETPLACE_MCP_PATH, { category, q })}
      onRetry={() => void mutate()}
    >
      {data?.items.slice(0, CATALOG_SECTION_SIZE).map((item) => (
        <McpCatalogRow item={item} key={item.identifier} />
      ))}
    </CatalogSection>
  );
};

const MCP_PSEUDO_CATEGORIES = [McpCategory.All, McpCategory.Discover];

const McpCatalogGroups = ({
  installedSection,
  q,
}: {
  installedSection?: ReactNode;
  q?: string;
}) => {
  const categories = useMcpCategory();
  const useMcpCategories = useDiscoverStore((s) => s.useMcpCategories);
  const { error, isLoading, mutate, queryKey } = useMcpCategories({ q });
  const counts = useDiscoverStore(mcpSelectors.mcpCategories(queryKey));
  const groups = orderCategoriesByCount(categories, counts, MCP_PSEUDO_CATEGORIES);

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
          <McpCatalogList query={{ q }} showEmpty={!installedSection} />
        ) : (
          groups.map(({ count, key, label }, index) => (
            <McpCatalogGroup
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

const McpCatalogList = ({
  query: { category, connectionType, order, page, q, sort },
  showEmpty = true,
}: {
  query: McpQueryParams;
  showEmpty?: boolean;
}) => {
  const useMcpList = useDiscoverStore((s) => s.useFetchMcpList);
  const { error, isLoading, mutate, queryKey } = useMcpList({
    category,
    connectionType,
    order,
    page,
    pageSize: CATALOG_LIST_PAGE_SIZE,
    q,
    sort: sort ?? McpSorts.Recommended,
  });
  const data = useDiscoverStore(mcpSelectors.mcpList(queryKey));
  const items = data?.items ?? [];

  return (
    <CatalogListView
      empty={showEmpty && <McpEmpty search={Boolean(q)} />}
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
            path={MARKETPLACE_MCP_PATH}
            total={data.totalCount}
          />
        )
      }
      onRetry={() => void mutate()}
    >
      {items.map((item) => (
        <McpCatalogRow item={item} key={item.identifier} />
      ))}
    </CatalogListView>
  );
};

const McpCatalog = () => {
  const { t } = useTranslation('discover');
  const { group, ...query } = useQuery() as McpQueryParams & { group?: string };
  const installedGroup = group === 'installed';
  const openDetail = useCatalogDetailNavigate();
  const { t: ts } = useTranslation('setting');
  const connectors = useToolStore((s) => s.useFetchConnectors)(true);
  const plugins = useToolStore((s) => s.useFetchInstalledPlugins)(true);
  const initialized = useToolStore((s) => s.isConnectorsInit && s.isInstalledPluginsInit);
  const installed = useToolStore(getInstalledMcpItems, isEqual);
  const { category, q, sort } = query;
  const categories = useMcpCategory();
  const isMarketGroup = isCatalogListView(query) || Boolean(query.connectionType);
  const narrowed = installedGroup || isMarketGroup;
  const matches = installed.filter((item) =>
    matchesConnectorKeyword(q, [item.title, item.identifier, item.description]),
  );
  const label = t('catalog.yourMcpServers');
  const error = connectors.error ?? plugins.error;
  const loading = !initialized && (connectors.isLoading || plugins.isValidating);
  const retry = () => {
    void connectors.mutate();
    void plugins.revalidate();
  };
  const rows = (installedGroup ? matches : matches.slice(0, CATALOG_SECTION_SIZE)).map((item) => {
    const open = () => openDetail(item.path);
    return (
      <SkillListRow
        extra={<RowMoreMenu onOpenDetail={open} />}
        key={item.key}
        summary={item.private ? ts('skillView.connectorTabs.private') : item.description}
        title={item.title}
        icon={() =>
          item.avatar && item.avatar !== 'MCP_AVATAR' ? (
            <Avatar avatar={item.avatar} shape={'square'} size={24} />
          ) : (
            <Icon icon={McpIcon} size={20} />
          )
        }
        onClick={open}
      />
    );
  });
  const title = installedGroup
    ? label
    : (categories.find((item) => item.key === category)?.label ??
      (sort === McpSorts.CreatedAt ? t('catalog.new') : t('tab.mcp')));

  return (
    <div {...stylex.props(catalogStyles.frame, narrowed && catalogStyles.groupFrame)}>
      <DiscoverCatalogHeader
        kind={'mcp'}
        group={
          narrowed
            ? {
                backTo: buildCatalogListUrl(MARKETPLACE_MCP_PATH, { q }),
                title,
              }
            : undefined
        }
      />
      <CatalogViewTabs active={'discover'} kind={'mcp'} />
      {installedGroup ? (
        <CatalogListView
          empty={<McpEmpty search={Boolean(q)} title={q ? undefined : t('apps.noInstalledMcp')} />}
          error={error}
          hasData={initialized || matches.length > 0}
          isEmpty={matches.length === 0}
          loading={loading}
          onRetry={retry}
        >
          {rows}
        </CatalogListView>
      ) : isMarketGroup ? (
        <McpCatalogList query={query} />
      ) : (
        <McpCatalogGroups
          q={q}
          installedSection={
            matches.length || (!initialized && error) ? (
              <CatalogSection
                count={matches.length}
                error={matches.length ? undefined : error}
                label={label}
                loading={false}
                to={buildCatalogListUrl(MARKETPLACE_MCP_PATH, { group: 'installed', q })}
                onRetry={retry}
              >
                {rows}
              </CatalogSection>
            ) : undefined
          }
        />
      )}
    </div>
  );
};

export default McpCatalog;
