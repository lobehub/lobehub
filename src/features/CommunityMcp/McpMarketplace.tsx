import { Button, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { ArrowLeft, ChevronRight, Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { CustomConnectorModal } from '@/features/Connectors';
import { CatalogHeader } from '@/features/MarketplaceCatalog/CatalogHeader';
import SkillDetail from '@/features/Settings/skill/features/SkillDetail';
import { parseMobileSelection } from '@/features/Settings/skill/mobileSelection';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useConnectorManageable } from '@/hooks/useConnectorManagePolicy';
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
          <Button disabled={!canManage} icon={Plus} type="primary" onClick={() => setOpen(true)}>
            {t('mcp.add')}
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
  const signedIn = Boolean(useUserStore(authSelectors.isLogin));
  const fetchConnectors = useToolStore((s) => s.useFetchConnectors);
  const fetchPlugins = useToolStore((s) => s.useFetchInstalledPlugins);
  fetchConnectors(signedIn);
  fetchPlugins(signedIn);
  const selected = parseMobileSelection(params.get('open'));
  const filtered = Boolean(
    query.q || query.category || query.page || query.sort || query.connectionType,
  );
  const back = () => {
    const next = new URLSearchParams(params);
    next.delete('open');
    setParams(next, { replace: true });
  };

  if (selected && (selected.type === 'mcp-connector' || selected.type === 'plugin'))
    return (
      <Flexbox align="flex-start">
        <Button icon={ArrowLeft} type="text" onClick={back}>
          MCP
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
        description={t('mcp.marketplaceDescription')}
        searchLabel={t('mcp.searchPlaceholder')}
        title="MCP"
      />
      {signedIn && isMobileSurface() && (
        <details>
          <summary>{t('plugins.installed')}</summary>
          <InstalledMcp />
        </details>
      )}
      {filtered ? (
        <>
          <Flexbox horizontal align="center" gap={8} justify="space-between">
            <WorkspaceLink to={MCP_MARKETPLACE_PATH}>← MCP</WorkspaceLink>
            {sortControl}
          </Flexbox>
          {query.category && (
            <Text as="h2" fontSize={18} weight={600}>
              {t(`mcp.categories.${query.category}.name`, { defaultValue: query.category })}
            </Text>
          )}
          <McpResults query={query} renderPagination={renderPagination} />
        </>
      ) : (
        <>
          <McpResults featured preview query={{ sort: McpSorts.IsFeatured }} />
          <Flexbox horizontal align="center" gap={8} justify="space-between">
            <WorkspaceLink
              style={{ alignItems: 'center', display: 'inline-flex', gap: 4 }}
              to={MCP_MARKETPLACE_PATH + '?category=all'}
            >
              {t('mcp.categories.all.description')}
              <Icon icon={ChevronRight} size={16} />
            </WorkspaceLink>
            {sortControl}
          </Flexbox>
          <McpCategorySections />
        </>
      )}
    </Flexbox>
  );
};
