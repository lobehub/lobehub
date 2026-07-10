import { getComposioAppByIdentifier, getLobehubSkillProviderById } from '@lobechat/const';
import { Button, confirmModal } from '@lobehub/ui/base-ui';
import { useSize } from 'ahooks';
import { createStaticStyles } from 'antd-style';
import { PencilIcon, RefreshCwIcon, Trash2, Unplug } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ConnectorToolPermission } from '@/database/schemas';
import { ConnectorSourceType } from '@/database/schemas';
import { useToolStore } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector';

import CustomConnectorModal from '../CustomConnectorModal';
import { getLocalizedConnectorDetail } from './localization';
import ToolPermissionGroup from './ToolPermissionGroup';

const COMPACT_HEADER_WIDTH = 760;

const styles = createStaticStyles(({ css, cssVar }) => ({
  actionButton: css`
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    line-height: 1;
  `,
  actionLabel: css`
    white-space: nowrap;
  `,
  actions: css`
    display: flex;
    flex-shrink: 0;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: flex-end;

    max-width: 100%;
  `,
  header: css`
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    min-height: 42px;
    padding-block: 12px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  headerTitle: css`
    overflow: hidden;
    flex: 1 1 auto;

    min-width: 0;

    font-size: 14px;
    font-weight: 500;
    line-height: 1.5;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface ConnectorDetailProps {
  connectorId: string;
  lifecycleActions?: ReactNode;
  onDelete?: () => void;
}

const ConnectorDetail = memo<ConnectorDetailProps>(
  ({ connectorId, lifecycleActions, onDelete }) => {
    const { t } = useTranslation('tool');
    const { t: ts } = useTranslation('setting');
    const headerRef = useRef<HTMLDivElement | null>(null);
    const [customModalOpen, setCustomModalOpen] = useState(false);
    const headerSize = useSize(headerRef);

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
    const isCompactHeader = (headerSize?.width ?? Number.POSITIVE_INFINITY) < COMPACT_HEADER_WIDTH;

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

    const renderCompactableButton = ({
      danger,
      disabled,
      icon,
      label,
      loading,
      onClick,
    }: {
      danger?: boolean;
      disabled?: boolean;
      icon: ReactNode;
      label: string;
      loading?: boolean;
      onClick: () => void | Promise<void>;
    }) => (
      <Button
        aria-label={label}
        className={styles.actionButton}
        danger={danger}
        disabled={disabled}
        icon={icon}
        loading={loading}
        size="small"
        title={isCompactHeader ? label : undefined}
        onClick={onClick}
      >
        {!isCompactHeader && <span className={styles.actionLabel}>{label}</span>}
      </Button>
    );

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div className={styles.header} ref={headerRef}>
          <div className={styles.headerTitle}>{connectorName}</div>
          <div className={styles.actions}>
            <Button size="small" onClick={() => resetConnectorPermissions(connectorId)}>
              {t('connector.resetPermissions', 'Reset permissions')}
            </Button>
            {renderCompactableButton({
              icon: <RefreshCwIcon size={14} />,
              label: syncLabel,
              loading: syncing,
              onClick: handleSync,
            })}
            {isMcpConnector &&
              connector?.mcpConnectionType === 'http' &&
              renderCompactableButton({
                icon: <PencilIcon size={14} />,
                label: t('connector.edit', 'Edit'),
                onClick: () => setCustomModalOpen(true),
              })}
            {lifecycleActions !== undefined ? (
              lifecycleActions
            ) : (
              <>
                {isMcpConnector && (
                  <>
                    {renderCompactableButton({
                      danger: true,
                      icon: <Unplug size={14} />,
                      label: t('connector.disconnect', 'Disconnect'),
                      onClick: () => disconnectConnector(connectorId),
                    })}
                    {renderCompactableButton({
                      danger: true,
                      icon: <Trash2 size={14} />,
                      label: t('connector.delete', 'Delete'),
                      onClick: () => {
                        confirmModal({
                          okButtonProps: { danger: true },
                          onOk: async () => {
                            await deleteConnector(connectorId);
                            onDelete?.();
                          },
                          title: t('connector.deleteConfirm', 'Delete this connector?'),
                        });
                      },
                    })}
                  </>
                )}
                {(isBuiltin || isMarketplace) &&
                  renderCompactableButton({
                    danger: true,
                    icon: <Trash2 size={14} />,
                    label: t('connector.uninstall', 'Uninstall'),
                    onClick: handleUninstall,
                  })}
              </>
            )}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flex: 1,
            flexDirection: 'column',
            minHeight: 0,
            padding: 16,
          }}
        >
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
