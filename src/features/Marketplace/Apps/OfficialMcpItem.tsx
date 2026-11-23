'use client';

import type { OfficialMcpServerType } from '@lobechat/const';
import { toast } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { RowAddAction, RowMoreMenu } from '@/features/Settings/skill/features/RowActions';
import { ConnectedStatus } from '@/features/Settings/skill/features/SkillListRow';
import { usePermission } from '@/hooks/usePermission';
import { useToolStore } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector/selectors';
import { ConnectorOAuthError, openConnectorOAuthPopup } from '@/utils/connectorOAuth';

import { useCatalogDetailNavigate } from '../Catalog/useCatalogDetailNavigate';
import { buildInstalledDetailPath } from '../paths';
import AppRow from './AppRow';
import type { MarketplaceApp } from './catalog';
import { connectOfficialMcp } from './connectOfficialMcp';

interface OfficialMcpItemProps {
  app: MarketplaceApp;
  server: OfficialMcpServerType;
  summary: string;
}

/** A catalog row for a vendor's official MCP server: connect in place, then manage it as a connector. */
const OfficialMcpItem = memo<OfficialMcpItemProps>(({ app, server, summary }) => {
  const { t } = useTranslation('discover');
  const { t: ts } = useTranslation('setting');
  const navigate = useCatalogDetailNavigate();
  const { allowed: canCreate, reason } = usePermission('create_content');
  const [connecting, setConnecting] = useState(false);
  const useFetchConnectors = useToolStore((s) => s.useFetchConnectors);
  useFetchConnectors(true);
  const ready = useToolStore((s) => s.isConnectorsInit);
  const connector = useToolStore(connectorSelectors.sharedConnectorByIdentifier(server.identifier));
  const connected = connector?.status === 'connected';
  const label = t('catalog.rowAction', {
    action: connected ? t('apps.manage') : t('apps.connect'),
    name: server.label,
  });
  const openDetail = () =>
    navigate(buildInstalledDetailPath('mcp', server.identifier, 'mcp-connector'));

  const handleConnect = async () => {
    if (!ready || !canCreate || connecting) return;
    // Opened before any await so the browser keeps it
    const popup = server.auth === 'oauth' ? openConnectorOAuthPopup() : undefined;
    setConnecting(true);
    try {
      if (popup === null) throw new ConnectorOAuthError('blocked');
      await connectOfficialMcp(server, popup, useToolStore.getState);
    } catch (error) {
      if (!(error instanceof ConnectorOAuthError && error.reason === 'dismissed'))
        toast.error(
          ts('tools.connectorFeedback.connectFailed', { reason: (error as Error).message }),
        );
    } finally {
      popup?.close();
      setConnecting(false);
    }
  };

  return (
    <AppRow
      app={app}
      summary={summary}
      action={
        connected ? (
          <>
            <ConnectedStatus label={ts('tools.composio.connected')} />
            <RowMoreMenu label={label} onOpenDetail={openDetail} />
          </>
        ) : (
          <RowAddAction
            disabled={!ready || !canCreate}
            disabledReason={reason}
            label={label}
            loading={connecting}
            onClick={() => void handleConnect()}
          />
        )
      }
      onOpen={connected ? openDetail : () => void handleConnect()}
    />
  );
});

OfficialMcpItem.displayName = 'OfficialMcpItem';

export default OfficialMcpItem;
