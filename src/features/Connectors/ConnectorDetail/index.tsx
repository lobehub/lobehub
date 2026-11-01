import { getComposioAppByIdentifier, getLobehubSkillProviderById } from '@lobechat/const';
import { Button, confirmModal, Flexbox, Tabs, Text, toast, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PencilIcon, RefreshCwIcon, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ConnectorToolPermission } from '@/database/schemas';
import { ConnectorSourceType } from '@/database/schemas';
import { useConnectorManageable } from '@/hooks/useConnectorManagePolicy';
import { refreshConnectorManagePolicy } from '@/services/connectorManagePolicy';
import { useToolStore } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector';
import { type ConnectorActionError, toConnectorActionError } from '@/utils/connectorActionError';

import ConnectorActionErrorText from '../ConnectorActionErrorText';
import CustomConnectorModal from '../CustomConnectorModal';
import { formatConnectorActionErrorToast } from '../formatConnectorActionError';
import ConnectorDetailIcon from './ConnectorDetailIcon';
import ConnectorOverviewInfo, { getConnectorKind } from './ConnectorOverviewInfo';
import { getLocalizedConnectorDetail } from './localization';
import ToolPermissionGroup from './ToolPermissionGroup';

interface ConnectorDetailProps {
  /**
   * Title of the owning agent when this is an agent-dimension connector. Drives
   * the delete/uninstall confirmation copy — deleting an agent connector also
   * removes its tool from that agent.
   */
  agentTitle?: string | null;
  connectorId: string;
  lifecycleActions?: ReactNode;
  /**
   * Extra content rendered in the Overview tab, below the connector facts.
   * Used by the unified settings' agent connectors to show the owning agent +
   * a jump-to-use action.
   */
  middleSlot?: ReactNode;
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

type ConnectorDetailTab = 'overview' | 'tools';

const styles = stylex.create({
  body: {
    flex: '1',
    minHeight: 0,
    overflowY: 'auto',
    paddingBlock: 24,
    paddingInline: 16,
  },
  description: {
    color: cssVar.colorText,
    fontSize: 14,
    lineHeight: 1.6,
  },
  header: {
    flexShrink: 0,
    paddingBlockStart: '8px',
    paddingBlockEnd: '16px',
    paddingInline: 16,
  },
  meta: {
    color: cssVar.colorTextSecondary,
    fontSize: 13,
  },
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
  },
  sectionLabel: {
    color: cssVar.colorTextTertiary,
    fontSize: 12,
    fontWeight: 500,
  },
  tabs: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    flexShrink: 0,
    paddingInline: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: 600,
    lineHeight: 1.4,
    marginBlock: 0,
  },
});

const Section = ({ children, label }: { children: ReactNode; label: string }) => (
  <Flexbox gap={8}>
    <span {...stylex.props(styles.sectionLabel)}>{label}</span>
    {children}
  </Flexbox>
);

const ConnectorDetail = memo<ConnectorDetailProps>(
  ({ agentTitle, connectorId, lifecycleActions, middleSlot, onDelete }) => {
    const { t } = useTranslation('tool');
    const { t: ts } = useTranslation('setting');

    const [customModalOpen, setCustomModalOpen] = useState(false);
    const [tab, setTab] = useState<ConnectorDetailTab>('overview');

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
    const forgetComposioConnection = useToolStore((s) => s.forgetComposioConnection);
    const uninstallBuiltinTool = useToolStore((s) => s.uninstallBuiltinTool);
    const uninstallMCPPlugin = useToolStore((s) => s.uninstallMCPPlugin);
    const fetchConnectors = useToolStore((s) => s.fetchConnectors);
    const updateToolPermission = useToolStore((s) => s.updateToolPermission);

    const isMcpConnector = connector?.sourceType === ConnectorSourceType.custom;
    const isBuiltin = connector?.sourceType === ConnectorSourceType.builtin;
    const isMarketplace = connector?.sourceType === ConnectorSourceType.marketplace;

    // Members co-maintain shared connectors unless the workspace restricted it;
    // editing the stored credentials stays with the creator or a workspace
    // owner. The server enforces both, this keeps the UI honest about it.
    const { canManage, canManageCredentials, isPending, restrictedByPolicy } =
      useConnectorManageable(connector);
    const creatorOnlyTooltip = t(
      'connector.manageOnlyCreator',
      'Only the creator or a workspace owner can manage this connector',
    );
    const deniedTooltip = restrictedByPolicy
      ? ts('tools.connectorFeedback.manageOnly')
      : creatorOnlyTooltip;
    // While the policy loads the controls are disabled without a reason yet.
    const manageTooltip = canManage || isPending ? undefined : deniedTooltip;
    const credentialsTooltip = canManageCredentials || isPending ? undefined : deniedTooltip;

    // Deleting/uninstalling revokes the user's authorization; spell out the
    // consequence. For an agent-owned connector it ALSO unpins the tool from
    // that agent (server-side, see `connector.delete`) — surface that instead.
    const deleteConfirmContent = connector?.agentId
      ? t('connector.deleteAgentConfirmContent', {
          agent: agentTitle || t('connector.thisAgent', 'this agent'),
          defaultValue:
            'This connector belongs to the agent “{{agent}}”. Deleting it will also remove this tool from that agent.',
        })
      : t('connector.deleteAccountConfirmContent', {
          defaultValue:
            'This removes the connector and its authorization from your account. Any agent that uses it will need to be re-authorized afterwards.',
        });

    // A 403 means the cached policy was stale: refetch it so the buttons turn
    // disabled with their hover reason, rather than reporting a permission error
    // for a button that looked usable. Returns whether it was such a rejection.
    const settlePermissionRejection = useCallback((error: unknown) => {
      const httpStatus = (error as { data?: { httpStatus?: number } })?.data?.httpStatus;
      if (httpStatus !== 403) return false;
      void refreshConnectorManagePolicy();
      return true;
    }, []);

    const notifyActionError = useCallback(
      (error: unknown) => {
        if (settlePermissionRejection(error)) return;
        toast.error(formatConnectorActionErrorToast(t, error));
      },
      [settlePermissionRejection, t],
    );

    // A failed uninstall / delete / disconnect also stays in the panel: the toast
    // is gone long before the user looks back. Keyed by connector so switching
    // to another one never shows a stale reason.
    const [removeError, setRemoveError] = useState<{
      connectorId: string;
      error: ConnectorActionError;
    }>();
    const notifyRemoveError = useCallback(
      (error: unknown) => {
        if (settlePermissionRejection(error)) return;
        notifyActionError(error);
        setRemoveError({ connectorId, error: toConnectorActionError('remove', error) });
      },
      [connectorId, notifyActionError, settlePermissionRejection],
    );

    // Custom connector sync uses the stored credentials (on desktop it reads them
    // through the creator/owner-only edit read), so it follows the credentials
    // gate. Builtin/marketplace bootstrap syncs are no-ops for non-managers.
    const canSync = canManageCredentials || connector?.sourceType !== ConnectorSourceType.custom;

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
        content: deleteConfirmContent,
        okButtonProps: { danger: true },
        onOk: async () => {
          setRemoveError(undefined);
          try {
            if (isBuiltin) {
              await uninstallBuiltinTool(connector.identifier);
            } else if (isMarketplace) {
              await uninstallMCPPlugin(connector.identifier);
            }
            await deleteConnector(connectorId);
            // The Composio list does not watch these writes; without this the
            // uninstalled row keeps showing as connected until a reload.
            if (getComposioAppByIdentifier(connector.identifier))
              forgetComposioConnection(connector.identifier);
            onDelete?.();
          } catch (error) {
            notifyRemoveError(error);
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

    const toolCount =
      readTools.length + createTools.length + updateTools.length + deleteTools.length;
    const hasTools = toolCount > 0;

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

    const actions = (
      <>
        {/* Sync/Refresh: re-sync tool list from manifest */}
        <ManageTooltip title={canSync ? undefined : credentialsTooltip}>
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
          <ManageTooltip title={credentialsTooltip}>
            <Button
              disabled={!canManageCredentials}
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
                      setRemoveError(undefined);
                      try {
                        await disconnectConnector(connectorId);
                      } catch (error) {
                        notifyRemoveError(error);
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
                        content: deleteConfirmContent,
                        okButtonProps: { danger: true },
                        onOk: async () => {
                          setRemoveError(undefined);
                          try {
                            await deleteConnector(connectorId);
                            onDelete?.();
                          } catch (error) {
                            notifyRemoveError(error);
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
              <ManageTooltip title={credentialsTooltip}>
                <Button
                  danger
                  disabled={!canManageCredentials}
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
      </>
    );

    const overview = (
      <Flexbox gap={24}>
        {removeError?.connectorId === connectorId && (
          <ConnectorActionErrorText error={removeError.error} name={connectorName} />
        )}

        {connectorDescription && (
          <Section label={t('connector.overview.about')}>
            <div {...stylex.props(styles.description)}>{connectorDescription}</div>
          </Section>
        )}

        <Section label={t('connector.overview.connection')}>
          <ConnectorOverviewInfo connector={connector} />
          <Flexbox horizontal gap={8} paddingBlock={'4px 0'} wrap={'wrap'}>
            {actions}
          </Flexbox>
        </Section>

        {middleSlot}
      </Flexbox>
    );

    const tools = hasTools ? (
      <Flexbox gap={16}>
        <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
          {/* The count already sits under the title; say what the controls decide instead. */}
          <Text fontSize={13} type={'secondary'}>
            {t('connector.toolsHint')}
          </Text>
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
        </Flexbox>
        <div>
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
      </Flexbox>
    ) : (
      <div style={{ color: 'var(--lobe-colors-neutral-500)', fontSize: 14 }}>
        {t('connector.noTools', 'No tool permissions to configure.')}
      </div>
    );

    return (
      <div {...stylex.props(styles.root)}>
        <Flexbox horizontal align={'center'} gap={16} {...stylex.props(styles.header)}>
          <ConnectorDetailIcon connector={connector} />
          <Flexbox gap={2} style={{ minWidth: 0 }}>
            <h2 {...stylex.props(styles.title)}>{connectorName}</h2>
            <Flexbox horizontal align={'center'} gap={6} {...stylex.props(styles.meta)}>
              <span>{t(`connector.kind.${getConnectorKind(connector)}`)}</span>
              {hasTools && (
                <>
                  <span aria-hidden>·</span>
                  <span>{t('connector.toolCount', { count: toolCount })}</span>
                </>
              )}
            </Flexbox>
          </Flexbox>
        </Flexbox>

        {/* Overview (authorization / lifecycle) and Tools (permissions) are two separate jobs */}
        <div {...stylex.props(styles.tabs)}>
          <Tabs
            activeKey={tab}
            size={'middle'}
            variant={'point'}
            items={[
              { key: 'overview', label: t('connector.tab.overview') },
              {
                key: 'tools',
                label: (
                  <Flexbox horizontal align={'center'} gap={6}>
                    {t('connector.tab.tools')}
                    {toolCount > 0 && (
                      <Text fontSize={12} type={'secondary'}>
                        {toolCount}
                      </Text>
                    )}
                  </Flexbox>
                ),
              },
            ]}
            onChange={(key) => setTab(key as ConnectorDetailTab)}
          />
        </div>

        {/* Body */}
        <div {...stylex.props(styles.body)}>
          {tab === 'tools' ? tools : overview}

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
