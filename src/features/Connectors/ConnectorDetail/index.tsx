import { Button } from 'antd';
import { RefreshCwIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { ConnectorToolPermission } from '@/database/schemas';
import { ConnectorSourceType } from '@/database/schemas';
import { useToolStore } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector';

import ToolPermissionGroup from './ToolPermissionGroup';

interface ConnectorDetailProps {
  connectorId: string;
}

const ConnectorDetail = memo<ConnectorDetailProps>(({ connectorId }) => {
  const { t } = useTranslation('tool');

  const connector = useToolStore(connectorSelectors.connectorById(connectorId));
  const { readTools, createTools, updateTools, deleteTools } = useToolStore(
    connectorSelectors.connectorToolsGrouped(connectorId),
  );
  const syncing = useToolStore(connectorSelectors.isSyncing(connectorId));

  const syncConnectorTools = useToolStore((s) => s.syncConnectorTools);
  const syncBuiltinTool = useToolStore((s) => s.syncBuiltinTool);
  const syncPluginTools = useToolStore((s) => s.syncPluginTools);
  const resetConnectorPermissions = useToolStore((s) => s.resetConnectorPermissions);
  const disconnectConnector = useToolStore((s) => s.disconnectConnector);
  const updateToolPermission = useToolStore((s) => s.updateToolPermission);

  const isMcpConnector = connector?.sourceType === ConnectorSourceType.custom;

  const handleSync = useCallback(async () => {
    if (!connector) return;
    if (connector.sourceType === ConnectorSourceType.builtin) {
      await syncBuiltinTool(connector.identifier);
    } else if (connector.sourceType === ConnectorSourceType.marketplace) {
      await syncPluginTools(connector.identifier);
    } else {
      await syncConnectorTools(connectorId);
    }
  }, [connector, connectorId, syncBuiltinTool, syncPluginTools, syncConnectorTools]);

  if (!connector) return null;

  // Sync button label: re-sync tool list from manifest (does NOT reset permissions)
  const syncLabel =
    connector?.sourceType === ConnectorSourceType.custom
      ? t('connector.sync', 'Sync')
      : t('connector.refresh', 'Refresh');

  const hasTools =
    readTools.length > 0 ||
    createTools.length > 0 ||
    updateTools.length > 0 ||
    deleteTools.length > 0;

  const handleBatchPermission = async (toolIds: string[], permission: ConnectorToolPermission) => {
    await Promise.all(toolIds.map((id) => updateToolPermission(id, permission)));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 16 }}>
      {/* Header */}
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          gap: 8,
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600 }}>{connector.name}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* Reset permissions: restore all tools to auto (fully open) */}
          <Button size="small" onClick={() => resetConnectorPermissions(connectorId)}>
            {t('connector.resetPermissions', 'Reset permissions')}
          </Button>
          {/* Sync/Refresh: re-sync tool list from manifest */}
          <Button
            icon={<RefreshCwIcon size={14} />}
            loading={syncing}
            size="small"
            onClick={handleSync}
          >
            {syncLabel}
          </Button>
          {isMcpConnector && (
            <Button danger size="small" onClick={() => disconnectConnector(connectorId)}>
              {t('connector.disconnect', 'Disconnect')}
            </Button>
          )}
        </div>
      </div>

      {/* Description */}
      {typeof connector.metadata?.description === 'string' && connector.metadata.description && (
        <div
          style={{
            color: 'var(--ant-color-text-secondary)',
            fontSize: 13,
            lineHeight: 1.6,
            marginBottom: 16,
          }}
        >
          {connector.metadata.description}
        </div>
      )}

      {hasTools ? (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <ToolPermissionGroup
            label={t('connector.readOnlyTools', 'Read-only tools')}
            tools={readTools}
            onBatchPermission={handleBatchPermission}
            onPermissionChange={updateToolPermission}
          />
          <ToolPermissionGroup
            label={t('connector.createTools', 'Create tools')}
            tools={createTools}
            onBatchPermission={handleBatchPermission}
            onPermissionChange={updateToolPermission}
          />
          <ToolPermissionGroup
            label={t('connector.updateTools', 'Update tools')}
            tools={updateTools}
            onBatchPermission={handleBatchPermission}
            onPermissionChange={updateToolPermission}
          />
          <ToolPermissionGroup
            label={t('connector.deleteTools', 'Delete tools')}
            tools={deleteTools}
            onBatchPermission={handleBatchPermission}
            onPermissionChange={updateToolPermission}
          />
        </div>
      ) : (
        <div style={{ color: 'var(--lobe-colors-neutral-500)', fontSize: 14 }}>
          {t('connector.noTools', 'No tool permissions to configure.')}
        </div>
      )}
    </div>
  );
});

ConnectorDetail.displayName = 'ConnectorDetail';

export default ConnectorDetail;
