import { Block, Flexbox, Text } from '@lobehub/ui';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { RouteLoading } from '@/components/Skeleton/RouteSegment';
import { CatalogGrid } from '@/features/MarketplaceCatalog/CatalogGrid';
import { CatalogSections } from '@/features/MarketplaceCatalog/CatalogSections';
import McpItem from '@/features/SkillStore/SkillList/Community/Item';
import { useCategory } from '@/hooks/useMCPCategory';
import McpEmpty from '@/routes/(main)/community/features/McpEmpty';
import { useDiscoverStore } from '@/store/discover';
import { mcpSelectors } from '@/store/discover/selectors';
import { McpCategory, type McpListResponse, type McpQueryParams, McpSorts } from '@/types/discover';

interface McpResultsProps {
  featured?: boolean;
  preview?: boolean;
  query: McpQueryParams;
  renderPagination?: (data: McpListResponse) => ReactNode;
}

export const MCP_MARKETPLACE_PATH = '/community/mcp';

export const McpResults = ({ featured, preview, query, renderPagination }: McpResultsProps) => {
  const { t } = useTranslation('discover');
  const useList = useDiscoverStore((s) => s.useFetchMcpList);
  const category =
    query.category === McpCategory.All || query.category === McpCategory.Discover
      ? undefined
      : query.category;
  const { queryKey, isLoading, error, mutate } = useList({
    ...query,
    category,
    pageSize: preview ? 6 : 24,
    sort: query.sort ?? McpSorts.Recommended,
  });
  const data = useDiscoverStore(mcpSelectors.mcpList(queryKey));
  const items = featured ? data?.items.filter((item) => item.isFeatured) : data?.items;
  const rows = (
    <CatalogGrid>
      {items?.map((item) => (
        <McpItem key={item.identifier} {...item} marketplace />
      ))}
    </CatalogGrid>
  );

  if (featured && data && !items?.length) return null;

  return (
    <AsyncBoundary
      data={data}
      error={error}
      isEmpty={!items?.length}
      isLoading={isLoading}
      loading={preview ? undefined : <RouteLoading />}
      empty={
        preview ? (
          <Text type="secondary">{t('catalog.emptyCategory')}</Text>
        ) : (
          <McpEmpty search={Boolean(query.q)} />
        )
      }
      onRetry={mutate}
    >
      {featured ? (
        <Block gap={12} padding={16} variant="filled">
          <Text as="h2" fontSize={18} weight={600}>
            {t('skills.lobehubPicks')}
          </Text>
          {rows}
        </Block>
      ) : (
        <Flexbox gap={20}>
          {rows}
          {data && data.totalCount > data.pageSize && renderPagination?.(data)}
        </Flexbox>
      )}
    </AsyncBoundary>
  );
};

export const McpCategorySections = () => {
  const { t } = useTranslation('discover');
  const categories = useCategory().filter(
    ({ key }) => key !== McpCategory.All && key !== McpCategory.Discover,
  );

  return (
    <CatalogSections
      categories={categories}
      moreLabel={t('skills.moreCategories')}
      path={MCP_MARKETPLACE_PATH}
      renderPreview={(category) => <McpResults preview query={{ category }} />}
    />
  );
};
