import { Button, Flexbox, Tooltip } from '@lobehub/ui';
import { ArrowLeft, Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { CustomConnectorModal } from '@/features/Connectors';
import { CatalogBody } from '@/features/MarketplaceCatalog/CatalogBody';
import { catalogDetailQuery } from '@/features/MarketplaceCatalog/catalogDetailQuery';
import { CatalogHeader } from '@/features/MarketplaceCatalog/CatalogHeader';
import SkillDetail from '@/features/Settings/skill/features/SkillDetail';
import { parseMobileSelection } from '@/features/Settings/skill/mobileSelection';
import { useConnectorManageable } from '@/hooks/useConnectorManagePolicy';
import { useCategory } from '@/hooks/useMCPCategory';
import { useQuery } from '@/hooks/useQuery';
import { useToolStore } from '@/store/tool';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { type McpListResponse, type McpQueryParams, McpSorts } from '@/types/discover';
import { isMobileSurface } from '@/utils/mobileSurface';

import { InstalledMcp } from './InstalledMcp';
import { MCP_MARKETPLACE_PATH, McpCategorySections, McpResults } from './McpCatalog';

const AddMcp = () => {
  const { t } = useTranslation(['discover', 'setting']);
  const [open, setOpen] = useState(false);
  const { canManage, isPending } = useConnectorManageable();

  return (
    <>
      <Tooltip
        title={
          canManage || isPending
            ? undefined
            : t('tools.connectorFeedback.manageOnly', { ns: 'setting' })
        }
      >
        <span style={{ display: 'inline-flex' }}>
          <Button disabled={!canManage} icon={Plus} onClick={() => setOpen(true)}>
            {t('catalog.addConnector')}
          </Button>
        </span>
      </Tooltip>
      {open && <CustomConnectorModal open={open} onClose={() => setOpen(false)} />}
    </>
  );
};

interface McpMarketplaceProps {
  renderPagination: (data: McpListResponse) => ReactNode;
  sortControl: ReactNode;
}

export const McpMarketplace = ({ sortControl, renderPagination }: McpMarketplaceProps) => {
  const { t } = useTranslation('discover');
  const [params, setParams] = useSearchParams();
  const query = useQuery() as McpQueryParams;
  const categories = useCategory().filter(({ key }) => key !== 'discover');
  const signedIn = Boolean(useUserStore(authSelectors.isLogin));
  const fetchConnectors = useToolStore((s) => s.useFetchConnectors);
  const fetchPlugins = useToolStore((s) => s.useFetchInstalledPlugins);
  fetchConnectors(signedIn);
  fetchPlugins(signedIn);
  const selected = parseMobileSelection(params.get('open'));
  const filtered = Boolean(
    query.q || query.category || query.page || query.sort || query.connectionType,
  );
  const back = () => setParams(catalogDetailQuery(params), { replace: true });
  if (selected && (selected.type === 'mcp-connector' || selected.type === 'plugin'))
    return (
      <Flexbox align="flex-start">
        <Button icon={ArrowLeft} type="text" onClick={back}>
          {t('tab.connector')}
        </Button>
        <Flexbox width="100%">
          <SkillDetail
            identifier={selected.identifier}
            key={selected.identifier}
            type={selected.type}
            onDelete={back}
          />
        </Flexbox>
      </Flexbox>
    );

  return (
    <Flexbox gap={24}>
      <CatalogHeader
        action={signedIn && <AddMcp />}
        categories={categories}
        description={t('mcp.marketplaceDescription')}
        searchLabel={t('catalog.searchConnectors')}
        title={t('tab.connector')}
      />
      {signedIn && isMobileSurface() && (
        <details>
          <summary>{t('plugins.installed')}</summary>
          <InstalledMcp hideTitle />
        </details>
      )}
      <CatalogBody
        allLabel={t('catalog.allConnectors')}
        categories={<McpCategorySections />}
        categoryLabel={categories.find(({ key }) => key === query.category && key !== 'all')?.label}
        featured={<McpResults featured preview query={{ sort: McpSorts.IsFeatured }} />}
        filtered={filtered}
        path={MCP_MARKETPLACE_PATH}
        results={<McpResults query={query} renderPagination={renderPagination} />}
        searching={Boolean(query.q)}
        sortControl={sortControl}
      />
    </Flexbox>
  );
};
