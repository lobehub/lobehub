import { getComposioAppByIdentifier, getLobehubSkillProviderById } from '@lobechat/const';
import { confirmModal } from '@lobehub/ui/base-ui';
import { Button } from 'antd';
import { PencilIcon, RefreshCwIcon, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ConnectorToolPermission } from '@/database/schemas';
import { ConnectorSourceType } from '@/database/schemas';
import { useToolStore } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector';

import CustomConnectorModal from '../CustomConnectorModal';
import { getLocalizedConnectorDetail } from './localization';
import ToolPermissionGroup from './ToolPermissionGroup';

interface ConnectorDetailProps {
  connectorId: string;
  lifecycleActions?: ReactNode;
  onDelete?: () => void;
}

const ConnectorDetail = memo<ConnectorDetailProps>(
  ({ connectorId, lifecycleActions, onDelete }) => {
    const { t } = useTranslation('tool');
    const { t: ts } = useTranslation('setting');
    const [customModalOpen, setCustomModalOpen] = useState(false);

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
    const deleteConnector = useToolStore((s) => s.deleteConnector);
    const uninstallBuiltinTool = useToolStore((s) => s.uninstallBuiltinTool);
    const uninstallMCPPlugin = useToolStore((s) => s.uninstallMCPPlugin);
    const fetchConnectors = useToolStore((s) => s.fetchConnectors);
    const updateToolPermission = useToolStore((s) => s.updateToolPermission);

    const isMcpConnector = connector?.sourceType === ConnectorSourceType.custom;
    const isBuiltin = connector?.sourceType === ConnectorSourceType.builtin;
    const isMarketplace = connector?.sourceType === ConnectorSourceType.marketplace;

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

    const handleUninstall = () => {
      if (!connector) return;
      confirmModal({
        okButtonProps: { danger: true },
        onOk: async () => {
          if (isBuiltin) {
            await uninstallBuiltinTool(connector.identifier);
          } else if (isMarketplace) {
            await uninstallMCPPlugin(connector.identifier);
          }
          await deleteConnector(connectorId);
          onDelete?.();
        },
        title: t('connector.uninstallConfirm', 'Uninstall this tool?'),
      });
    };

    if (!connector) return null;

    const lobehubProvider = isMarketplace
      ? getLobehubSkillProviderById(connector.identifier)
      : undefined;
    const composioApp = isMarketplace
      ? getComposioAppByIdentifier(connector.identifier)
      : undefined;
    const { name: connectorName, description: connectorDescription } = getLocalizedConnectorDetail({
      composioApp,
      connector,
      lobehubProvider,
      t: ts,
    });

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

    const handleBatchPermission = async (
      toolIds: string[],
      permission: ConnectorToolPermission,
    ) => {
      await Promise.all(toolIds.map((id) => updateToolPermission(id, permission)));
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header — full-bleed bar with bottom border, aligned with the left pane's header */}
        <div
          style={{
            alignItems: 'center',
            borderBlockEnd: '1px solid var(--ant-color-border-secondary)',
            display: 'flex',
            flexShrink: 0,
            gap: 8,
            height: 42,
            justifyContent: 'space-between',
            paddingInline: 16,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 500 }}>{connectorName}</div>
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
            {/* Edit button for custom MCP connectors — only http type has a server URL to edit */}
            {isMcpConnector && connector?.mcpConnectionType === 'http' && (
              <Button
                icon={<PencilIcon size={14} />}
                size="small"
                onClick={() => setCustomModalOpen(true)}
              >
                {t('connector.edit', 'Edit')}
              </Button>
            )}
            {lifecycleActions !== undefined ? (
              lifecycleActions
            ) : (
              <>
                {/* Disconnect / Delete for custom MCP connectors */}
                {isMcpConnector && (
                  <>
                    <Button danger size="small" onClick={() => disconnectConnector(connectorId)}>
                      {t('connector.disconnect', 'Disconnect')}
                    </Button>
                    <Button
                      danger
                      icon={<Trash2 size={14} />}
                      size="small"
                      onClick={() => {
                        confirmModal({
                          okButtonProps: { danger: true },
                          onOk: async () => {
                            await deleteConnector(connectorId);
                            onDelete?.();
                          },
                          title: t('connector.deleteConfirm', 'Delete this connector?'),
                        });
                      }}
                    >
                      {t('connector.delete', 'Delete')}
                    </Button>
                  </>
                )}
                {/* Uninstall for builtin and marketplace tools */}
                {(isBuiltin || isMarketplace) && (
                  <Button danger icon={<Trash2 size={14} />} size="small" onClick={handleUninstall}>
                    {t('connector.uninstall', 'Uninstall')}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Body */}
        <div
          style={{
            display: 'flex',
            flex: 1,
            flexDirection: 'column',
            minHeight: 0,
            padding: 16,
          }}
        >
          {/* Description */}
          {connectorDescription && (
            <div
              style={{
                color: 'var(--ant-color-text-secondary)',
                fontSize: 13,
                lineHeight: 1.6,
                marginBottom: 16,
              }}
            >
              {connectorDescription}
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

          {/* Edit modal — only http connectors have a server URL to edit */}
          {isMcpConnector && connector?.mcpConnectionType === 'http' && (
            <CustomConnectorModal
              connectorId={connectorId}
              open={customModalOpen}
              onClose={() => setCustomModalOpen(false)}
              onEditSuccess={() => {
                fetchConnectors();
              }}
            />
          )}
        </div>
      </div>
    );
  },
);

ConnectorDetail.displayName = 'ConnectorDetail';

export default ConnectorDetail;
