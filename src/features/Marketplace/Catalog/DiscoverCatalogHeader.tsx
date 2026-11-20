'use client';

import { memo, useState } from 'react';

import CatalogPageHeader from '@/features/Settings/skill/features/CatalogPageHeader';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { revalidateReplica } from '@/libs/replica';
import { mcpCategoriesResource, mcpListResource } from '@/store/discover/slices/mcp/projection';
import {
  skillCategoriesResource,
  skillListResource,
} from '@/store/discover/slices/skill/projection';
import { getToolStoreState } from '@/store/tool';
import { composioServersResource } from '@/store/tool/slices/composioStore/projection';
import { lobehubSkillServersResource } from '@/store/tool/slices/lobehubSkillStore/projection';
import { isMobileSurface } from '@/utils/mobileSurface';

import { CATALOG_VIEW_PATHS, type CatalogKind } from '../CatalogViewTabs';

interface DiscoverCatalogHeaderProps {
  kind: CatalogKind;
  query?: string;
}

const DiscoverCatalogHeader = memo<DiscoverCatalogHeaderProps>(({ kind, query = '' }) => {
  const router = useQueryRoute();
  const [keyword, setKeyword] = useState(query);
  const [lastQuery, setLastQuery] = useState(query);
  const [refreshing, setRefreshing] = useState(false);
  // Browser history and the catalog's Back action can both change the submitted search.
  if (query !== lastQuery) {
    setLastQuery(query);
    setKeyword(query);
  }

  const search = (value: string) => {
    const q = value.trim();
    router.push(CATALOG_VIEW_PATHS[kind].discover, { query: q ? { q } : {}, replace: true });
  };

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const tools = getToolStoreState();
      await Promise.allSettled(
        kind === 'skill'
          ? [
              revalidateReplica(skillCategoriesResource),
              revalidateReplica(skillListResource),
              tools.refreshAgentSkills(),
            ]
          : [
              revalidateReplica(mcpCategoriesResource),
              revalidateReplica(mcpListResource),
              revalidateReplica(lobehubSkillServersResource),
              revalidateReplica(composioServersResource),
              tools.fetchConnectors(),
              tools.refreshPlugins(),
            ],
      );
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <CatalogPageHeader
      compact={isMobileSurface()}
      keyword={keyword}
      refreshing={refreshing}
      viewMode={kind}
      onRefresh={refresh}
      onSearch={search}
      onKeywordChange={(value) => {
        setKeyword(value);
        if (!value && query) search('');
      }}
    />
  );
});

DiscoverCatalogHeader.displayName = 'DiscoverCatalogHeader';
export default DiscoverCatalogHeader;
