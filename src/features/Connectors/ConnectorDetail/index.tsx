import { getComposioAppByIdentifier, getLobehubSkillProviderById } from '@lobechat/const';
import { Tooltip } from '@lobehub/ui';
import { Button, confirmModal } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { PencilIcon, RefreshCwIcon, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ConnectorToolPermission } from '@/database/schemas';
import { ConnectorSourceType } from '@/database/schemas';
import { useResourceManageable } from '@/hooks/useResourceManageable';
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

/**
 * Tooltip wrapper for the manage gate. Disabled native buttons swallow hover
 * events, so the tooltip needs an enabled wrapper element to anchor on; when
 * there is no gate message, render children untouched.
 */
const ManageTooltip = ({ children, title }: { children: ReactNode; title?: string }) =>
  title ? (
    <Tooltip title={title}>
      <span style={{ display: 'inline-flex' }}>{children}</span>
    </Tooltip>
  ) : (
    children
  );

const ConnectorDetail = memo<ConnectorDetailProps>(
  ({ connectorId, lifecycleActions, onDelete }) => {
    const { t } = useTranslation('tool');
    const { t: ts } = useTranslation('setting');
    const { message } = App.useApp();
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

    // Only the creator or a workspace owner may manage this connector — the
    // server enforces the same rule, this keeps the UI honest about it.
    const canManage = useResourceManageable(connector?.userId);
    const manageTooltip = canManage
      ? undefined
      : t(
          'connector.manageOnlyCreator',
          'Only the creator or a workspace owner can manage this connector',
        );

    const notifyActionError = useCallback(
      (error: unknown) => {
        const httpStatus = (error as { data?: { httpStatus?: number } })?.data?.httpStatus;
        message.error(
          httpStatus === 403
            ? t(
                'connector.manageOnlyCreator',
                'Only the creator or a workspace owner can manage this connector',
              )
            : t('connector.actionFailed', 'Operation failed, please try again'),
        );
      },
      [message, t],
    );

    // Custom connector sync hits the remote MCP server with stored credentials
    // and rewrites tool rows — creator/owner only (enforced server-side too).
    // Builtin/marketplace bootstrap syncs are no-ops for non-managers.
    const canSync = canManage || connector?.sourceType !== ConnectorSourceType.custom;

    const handleSync = useCallback(async () => {
      if (!connector) return;
      try {
        if (connector.sourceType === ConnectorSourceType.builtin) {
          await syncBuiltinTool(connector.identifier);
        } else if (connector.sourceType === ConnectorSourceType.marketplace) {
          await syncPluginTools(connector.identifier);
        } else {
          await syncConnectorTools(connectorId);
        }
      } catch (error) {
        notifyActionError(error);
      }
    }, [
      connector,
      connectorId,
      notifyActionError,
      syncBuiltinTool,
      syncPluginTools,
      syncConnectorTools,
    ]);

    const handleUninstall = () => {
      if (!connector) return;
      confirmModal({
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            if (isBuiltin) {
              await uninstallBuiltinTool(connector.identifier);
            } else if (isMarketplace) {
              await uninstallMCPPlugin(connector.identifier);
            }
            await deleteConnector(connectorId);
            onDelete?.();
          } catch (error) {
            notifyActionError(error);
          }
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

    const handlePermissionChange = async (toolId: string, permission: ConnectorToolPermission) => {
      try {
        await updateToolPermission(toolId, permission);
      } catch (error) {
        notifyActionError(error);
      }
    };

    const handleBatchPermission = async (
      toolIds: string[],
      permission: ConnectorToolPermission,
    ) => {
      try {
        await Promise.all(toolIds.map((id) => updateToolPermission(id, permission)));
      } catch (error) {
        notifyActionError(error);
      }
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
            <ManageTooltip title={manageTooltip}>
              <Button
                disabled={!canManage}
                size="small"
                onClick={async () => {
                  try {
                    await resetConnectorPermissions(connectorId);
                  } catch (error) {
                    notifyActionError(error);
                  }
                }}
              >
                {t('connector.resetPermissions', 'Reset permissions')}
              </Button>
            </ManageTooltip>
            {/* Sync/Refresh: re-sync tool list from manifest */}
            <ManageTooltip title={canSync ? undefined : manageTooltip}>
              <Button
                disabled={!canSync}
                icon={<RefreshCwIcon size={14} />}
                loading={syncing}
                size="small"
                onClick={handleSync}
              >
                {syncLabel}
              </Button>
            </ManageTooltip>
            {/* Edit button for custom MCP connectors — only http type has a server URL to edit */}
            {isMcpConnector && connector?.mcpConnectionType === 'http' && (
              <ManageTooltip title={manageTooltip}>
                <Button
                  disabled={!canManage}
                  icon={<PencilIcon size={14} />}
                  size="small"
                  onClick={() => setCustomModalOpen(true)}
                >
                  {t('connector.edit', 'Edit')}
                </Button>
              </ManageTooltip>
            )}
            {lifecycleActions !== undefined ? (
              lifecycleActions
            ) : (
              <>
                {/* Disconnect / Delete for custom MCP connectors */}
                {isMcpConnector && (
                  <>
                    <ManageTooltip title={manageTooltip}>
                      <Button
                        danger
                        disabled={!canManage}
                        size="small"
                        onClick={async () => {
                          try {
                            await disconnectConnector(connectorId);
                          } catch (error) {
                            notifyActionError(error);
                          }
                        }}
                      >
                        {t('connector.disconnect', 'Disconnect')}
                      </Button>
                    </ManageTooltip>
                    <ManageTooltip title={manageTooltip}>
                      <Button
                        danger
                        disabled={!canManage}
                        icon={<Trash2 size={14} />}
                        size="small"
                        onClick={() => {
                          confirmModal({
                            okButtonProps: { danger: true },
                            onOk: async () => {
                              try {
                                await deleteConnector(connectorId);
                                onDelete?.();
                              } catch (error) {
                                notifyActionError(error);
                              }
                            },
                            title: t('connector.deleteConfirm', 'Delete this connector?'),
                          });
                        }}
                      >
                        {t('connector.delete', 'Delete')}
                      </Button>
                    </ManageTooltip>
                  </>
                )}
                {/* Uninstall for builtin and marketplace tools */}
                {(isBuiltin || isMarketplace) && (
                  <ManageTooltip title={manageTooltip}>
                    <Button
                      danger
                      disabled={!canManage}
                      icon={<Trash2 size={14} />}
                      size="small"
                      onClick={handleUninstall}
                    >
                      {t('connector.uninstall', 'Uninstall')}
                    </Button>
                  </ManageTooltip>
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
                disabled={!canManage}
                label={t('connector.readOnlyTools', 'Read-only tools')}
                tools={readTools}
                onBatchPermission={handleBatchPermission}
                onPermissionChange={handlePermissionChange}
              />
              <ToolPermissionGroup
                disabled={!canManage}
                label={t('connector.createTools', 'Create tools')}
                tools={createTools}
                onBatchPermission={handleBatchPermission}
                onPermissionChange={handlePermissionChange}
              />
              <ToolPermissionGroup
                disabled={!canManage}
                label={t('connector.updateTools', 'Update tools')}
                tools={updateTools}
                onBatchPermission={handleBatchPermission}
                onPermissionChange={handlePermissionChange}
              />
              <ToolPermissionGroup
                disabled={!canManage}
                label={t('connector.deleteTools', 'Delete tools')}
                tools={deleteTools}
                onBatchPermission={handleBatchPermission}
                onPermissionChange={handlePermissionChange}
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
