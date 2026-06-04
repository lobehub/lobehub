import { Button } from 'antd';
import { RefreshCwIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ConnectorToolPermission } from '@/database/schemas';
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
  const disconnectConnector = useToolStore((s) => s.disconnectConnector);
  const updateToolPermission = useToolStore((s) => s.updateToolPermission);

  if (!connector) return null;

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
            onClick={() => syncConnectorTools(connectorId)}
          >
            {t('connector.sync', 'Sync')}
          </Button>
          <Button danger size="small" onClick={() => disconnectConnector(connectorId)}>
            {t('connector.disconnect', 'Disconnect')}
          </Button>
        </div>
      </div>

      {/* Tool permissions */}
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
    </div>
  );
});

ConnectorDetail.displayName = 'ConnectorDetail';

export default ConnectorDetail;
