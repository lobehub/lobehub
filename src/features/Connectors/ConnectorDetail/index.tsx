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
  const { readTools, writeTools } = useToolStore(
    connectorSelectors.connectorToolsGrouped(connectorId),
  );
  const syncing = useToolStore(connectorSelectors.isSyncing(connectorId));

  const syncConnectorTools = useToolStore((s) => s.syncConnectorTools);
  const syncBuiltinTool = useToolStore((s) => s.syncBuiltinTool);
  const syncPluginTools = useToolStore((s) => s.syncPluginTools);
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

  const syncLabel =
    connector?.sourceType === ConnectorSourceType.builtin
      ? t('connector.reset', 'Reset')
      : connector?.sourceType === ConnectorSourceType.marketplace
        ? t('connector.refresh', 'Refresh')
        : t('connector.sync', 'Sync');

  const hasTools = readTools.length > 0 || writeTools.length > 0;

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
        <span style={{ fontSize: 16, fontWeight: 600 }}>{connector.name}</span>
        <div style={{ display: 'flex', gap: 8 }}>
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

      {/* Tool permissions */}
      {hasTools ? (
        <>
          <div style={{ fontWeight: 500, marginBottom: 4 }}>
            {t('connector.toolPermissions', 'Tool permissions')}
          </div>
          <div style={{ color: 'var(--lobe-colors-neutral-500)', fontSize: 12, marginBottom: 12 }}>
            {t('connector.toolPermissionsDesc', 'Choose when AI is allowed to use these tools.')}
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <ToolPermissionGroup
              label={t('connector.readOnlyTools', 'Read-only tools')}
              tools={readTools}
              onBatchPermission={handleBatchPermission}
              onPermissionChange={updateToolPermission}
            />
            <ToolPermissionGroup
              label={t('connector.writeTools', 'Write/delete tools')}
              tools={writeTools}
              onBatchPermission={handleBatchPermission}
              onPermissionChange={updateToolPermission}
            />
          </div>
        </>
      ) : (
        <div style={{ color: 'var(--lobe-colors-neutral-500)', fontSize: 14 }}>
          {t('connector.noTools', 'No tool permissions to configure for this skill.')}
        </div>
      )}
    </div>
  );
});

ConnectorDetail.displayName = 'ConnectorDetail';

export default ConnectorDetail;
