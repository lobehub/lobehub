'use client';

import { Avatar, Icon } from '@lobehub/ui';
import { McpIcon } from '@lobehub/ui/icons';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import AsyncBoundary from '@/components/AsyncBoundary';
import { CatalogRowsSkeleton } from '@/components/Skeleton/MarketplaceCatalog';
import SkillListRow from '@/features/Settings/skill/features/SkillListRow';
import { useFetchInstalledPlugins } from '@/hooks/useFetchInstalledPlugins';
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
import { type DiscoverMcpItem, McpCategory, type McpQueryParams, McpSorts } from '@/types/discover';

import CatalogViewTabs from '../CatalogViewTabs';
import { MARKETPLACE_CONNECTOR_PATH, MARKETPLACE_MCP_PATH } from '../paths';
import CatalogListView from './CatalogListView';
import CatalogSection, { useSeenOnce } from './CatalogSection';
import DiscoverCatalogHeader from './DiscoverCatalogHeader';
import { openMcpConnectModal } from './McpConnectModal';
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
import { useCatalogIntegrations } from './useCatalogIntegrations';

const McpCatalogRow = memo<{ item: DiscoverMcpItem }>(({ item }) => {
  const { description, icon, identifier, name } = item;
  const { t } = useTranslation('discover');
  const { t: ts } = useTranslation('setting');
  const navigate = useCatalogDetailNavigate();
  const { allowed: canCreate } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');
  const connectLabel = ts('connectorMarket.action.connect');
  const installed = useToolStore(pluginSelectors.isPluginInstalled(identifier));

  const openDetail = () => {
    discoverService
      .reportMcpEvent({ event: 'click', identifier, source: location.pathname })
      .catch(() => {});
    navigate(urlJoin(MARKETPLACE_MCP_PATH, identifier));
  };

  return (
    <SkillListRow
      summary={description}
      testId={'mcp-item'}
      title={name}
      extra={
        <RowAction
          addLabel={connectLabel}
          disabled={!canCreate || !canEdit}
          installed={installed}
          installedLabel={t('catalog.installed')}
          name={name}
          onAdd={() =>
            openMcpConnectModal(item, t('catalog.rowAction', { action: connectLabel, name }))
          }
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
      to={buildCatalogListUrl(MARKETPLACE_CONNECTOR_PATH, { category, q })}
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
  integrationSection,
  q,
}: {
  integrationSection?: ReactNode;
  q?: string;
}) => {
  const categories = useMcpCategory();
  const useMcpCategories = useDiscoverStore((s) => s.useMcpCategories);
  const { error, isLoading, mutate, queryKey } = useMcpCategories({ q });
  const counts = useDiscoverStore(mcpSelectors.mcpCategories(queryKey));
  const groups = orderCategoriesByCount(categories, counts, MCP_PSEUDO_CATEGORIES);

  return (
    <div {...stylex.props(catalogStyles.sections)}>
      {integrationSection}
      <AsyncBoundary
        data={counts.length > 0 ? counts : undefined}
        error={error}
        isLoading={isLoading}
        loading={<CatalogRowsSkeleton />}
        onRetry={() => void mutate()}
      >
        {groups.length === 0 ? (
          <McpCatalogList query={{ q }} showEmpty={!integrationSection} />
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
            path={MARKETPLACE_CONNECTOR_PATH}
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

const ConnectorCatalog = () => {
  const { t } = useTranslation('discover');
  const { group, ...query } = useQuery() as McpQueryParams & { group?: string };
  const { category, q, sort } = query;
  const categories = useMcpCategory();
  const integrations = useCatalogIntegrations(q);
  const useFetchConnectors = useToolStore((s) => s.useFetchConnectors);
  const connections = useFetchConnectors(true);
  useFetchInstalledPlugins();

  const isIntegrationGroup = group === 'integrations';
  const isMarketGroup = isCatalogListView(query) || Boolean(query.connectionType);
  const backTo = buildCatalogListUrl(MARKETPLACE_CONNECTOR_PATH, { q });
  const title = isIntegrationGroup
    ? integrations.label
    : (categories.find((item) => item.key === category)?.label ??
      (sort === McpSorts.CreatedAt ? t('catalog.new') : t('catalog.allConnectors')));

  return (
    <div
      {...stylex.props(
        catalogStyles.frame,
        (isIntegrationGroup || isMarketGroup) && catalogStyles.groupFrame,
      )}
    >
      <DiscoverCatalogHeader
        group={isIntegrationGroup || isMarketGroup ? { backTo, title } : undefined}
        kind={'connector'}
      />
      <CatalogViewTabs active={'discover'} kind={'connector'} />
      {isIntegrationGroup ? (
        <CatalogListView
          empty={<McpEmpty search={Boolean(q)} />}
          error={connections.error}
          hasData={integrations.count > 0}
          isEmpty={integrations.count === 0}
          loading={connections.isLoading}
          onRetry={() => void connections.mutate()}
        >
          {integrations.rows()}
        </CatalogListView>
      ) : isMarketGroup ? (
        <McpCatalogList query={query} />
      ) : (
        <McpCatalogGroups
          q={q}
          integrationSection={
            integrations.count > 0 ? (
              <CatalogSection
                count={integrations.count}
                label={integrations.label}
                loading={false}
                to={buildCatalogListUrl(MARKETPLACE_CONNECTOR_PATH, { group: 'integrations', q })}
              >
                {integrations.rows(CATALOG_SECTION_SIZE)}
              </CatalogSection>
            ) : undefined
          }
        />
      )}
    </div>
  );
};

export default ConnectorCatalog;
