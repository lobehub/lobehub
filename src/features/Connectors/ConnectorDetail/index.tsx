import {
  getComposioAppByIdentifier,
  getLobehubSkillProviderById,
  hasCallableMcpEndpoint,
} from '@lobechat/const';
import { Button, confirmModal, Flexbox, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PencilIcon, RefreshCwIcon, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { createContext, memo, use, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ConnectorToolPermission } from '@/database/schemas';
import { ConnectorSourceType } from '@/database/schemas';
import { useConnectorManageable } from '@/hooks/useConnectorManagePolicy';
import { refreshConnectorManagePolicy } from '@/services/connectorManagePolicy';
import { useToolStore } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector';
import { densityTokens } from '@/styles/density.stylex';
import { type ConnectorActionError, toConnectorActionError } from '@/utils/connectorActionError';

import ConnectorActionErrorText from '../ConnectorActionErrorText';
import CustomConnectorModal from '../CustomConnectorModal';
import { formatConnectorActionErrorToast } from '../formatConnectorActionError';
import ConnectorAccounts from './ConnectorAccounts';
import ConnectorDetailIcon from './ConnectorDetailIcon';
import ConnectorOverviewInfo, { getConnectorKind } from './ConnectorOverviewInfo';
import { getLocalizedConnectorDetail } from './localization';
import ManageTooltip from './ManageTooltip';
import Section from './Section';
import ToolPermissionGroup from './ToolPermissionGroup';

/**
 * Set by a page that already shows the connector's icon and name (the
 * Marketplace app page), so a connector detail rendered anywhere below it —
 * however many wrappers deep — drops its own and keeps only the actions.
 */
export const ConnectorDetailEmbeddedContext = createContext(false);

interface ConnectorDetailProps {
  /**
   * Title of the owning agent when this is an agent-dimension connector. Drives
   * the delete/uninstall confirmation copy — deleting an agent connector also
   * removes its tool from that agent.
   */
  agentTitle?: string | null;
  connectorId: string;
  /**
   * The page around it already shows the connector's icon and name (the
   * Marketplace app page): drop them here and keep only the actions.
   */
  hideIdentity?: boolean;
  lifecycleActions?: ReactNode;
  /**
   * Extra content rendered in the Overview tab, below the connector facts.
   * Used by the unified settings' agent connectors to show the owning agent +
   * a jump-to-use action.
   */
  middleSlot?: ReactNode;
  onDelete?: () => void;
}

const styles = stylex.create({
  // Inside a page that scrolls on its own: no second scroller, no inset.
  bodyEmbedded: {
    overflowY: 'visible',
    paddingBlock: 0,
    paddingInline: 0,
  },
  body: {
    flex: '1',
    minHeight: 0,
    overflowY: 'auto',
    paddingBlockStart: 8,
    paddingBlockEnd: 24,
    paddingInline: densityTokens['--lobe-density-card-padding'],
  },
  description: {
    color: cssVar.colorText,
    fontSize: densityTokens['--lobe-density-font-size'],
    lineHeight: 1.6,
  },
  // Identity on the left (icon, name, who made it and what it is), the
  // connector's own actions on the right; one scrolling page below.
  header: {
    flexShrink: 0,
    flexWrap: 'wrap',
    paddingBlockStart: '8px',
    paddingBlockEnd: '24px',
    paddingInline: densityTokens['--lobe-density-card-padding'],
  },
  meta: {
    color: cssVar.colorTextSecondary,
    fontSize: densityTokens['--lobe-density-font-size'],
  },
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
  },
  title: {
    color: cssVar.colorText,
    fontSize: cssVar.fontSizeHeading3,
    fontWeight: 600,
    lineHeight: 1.3,
    marginBlock: 0,
  },
});

const ConnectorDetail = memo<ConnectorDetailProps>(
  ({
    agentTitle,
    connectorId,
    hideIdentity: hideIdentityProp,
    lifecycleActions,
    middleSlot,
    onDelete,
  }) => {
    const hideIdentity = use(ConnectorDetailEmbeddedContext) || !!hideIdentityProp;
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
    const forgetComposioConnection = useToolStore((s) => s.forgetComposioConnection);
    const uninstallMCPPlugin = useToolStore((s) => s.uninstallMCPPlugin);
    const fetchConnectors = useToolStore((s) => s.fetchConnectors);
    const updateToolPermission = useToolStore((s) => s.updateToolPermission);

    const isMcpConnector = connector?.sourceType === ConnectorSourceType.custom;
    // The edit modal stores a server URL or a stdio command, args and env
    const isEditable =
      isMcpConnector &&
      (connector?.mcpConnectionType === 'http' || connector?.mcpConnectionType === 'stdio');
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

    // A marketplace row without an endpoint only projects a legacy plugin's
    // tools; one installed on the connector path syncs from its own server.
    const isPluginProjection = isMarketplace && !!connector && !hasCallableMcpEndpoint(connector);
    // A sync that connects to the server uses the stored credentials (on desktop
    // it reads them through the creator/owner-only edit read), so it follows the
    // credentials gate. Builtin/manifest bootstrap syncs are no-ops for non-managers.
    const syncsFromServer =
      connector?.sourceType === ConnectorSourceType.custom ||
      (isMarketplace && !isPluginProjection && connector?.mcpConnectionType !== 'cloud');
    const canSync = canManageCredentials || !syncsFromServer;

    const handleSync = useCallback(async () => {
      if (!connector) return;
      try {
        if (connector.sourceType === ConnectorSourceType.builtin) {
          await syncBuiltinTool(connector.identifier);
        } else if (isPluginProjection) {
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
      isPluginProjection,
      notifyActionError,
      syncBuiltinTool,
      syncPluginTools,
      syncConnectorTools,
    ]);

    const handleUninstall = () => {
      if (!connector || !isMarketplace) return;
      confirmModal({
        // The modal's built-in label is not localized.
        cancelText: t('cancel', { ns: 'common' }),
        content: deleteConfirmContent,
        okButtonProps: { danger: true },
        onOk: async () => {
          setRemoveError(undefined);
          try {
            await uninstallMCPPlugin(connector.identifier);
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
        {/* Edit button for custom MCP connectors: their server URL or stdio command */}
        {isEditable && (
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
      </>
    );

    const hasDangerActions =
      lifecycleActions !== undefined ? !!lifecycleActions : isMcpConnector || isMarketplace;

    // Disconnect / delete / uninstall sit apart at the bottom, in their own card.
    const dangerActions = (
      <>
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
                        cancelText: t('cancel', { ns: 'common' }),
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
            {isMarketplace && (
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

        <Section
          label={ts('connectorMarket.detail.information')}
          extra={
            // Embedded, there is no header row: its actions join the first card's label.
            hideIdentity ? (
              <Flexbox horizontal gap={8} wrap={'wrap'}>
                {actions}
              </Flexbox>
            ) : undefined
          }
        >
          <ConnectorOverviewInfo connector={connector} />
        </Section>

        {/* Accounts are their own section: removing one account is not the
            connector-level Disconnect / Delete above. */}
        {connector.authKind === 'oauth2' && (
          <ConnectorAccounts
            canManage={canManage}
            connector={connector}
            disabledReason={manageTooltip}
            key={connectorId}
          />
        )}

        {middleSlot}
      </Flexbox>
    );

    const tools = hasTools ? (
      <Flexbox gap={12}>
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

    // Built-in tools ship with LobeHub; other sources name no single author.
    const author = isBuiltin ? 'LobeHub' : undefined;

    return (
      <div {...stylex.props(styles.root)}>
        {!hideIdentity && (
          <Flexbox
            horizontal
            align={'center'}
            gap={16}
            justify={'space-between'}
            {...stylex.props(styles.header)}
          >
            <Flexbox horizontal align={'center'} gap={16} style={{ minWidth: 0 }}>
              <ConnectorDetailIcon connector={connector} size={'large'} />
              <Flexbox gap={4} style={{ minWidth: 0 }}>
                <h2 {...stylex.props(styles.title)}>{connectorName}</h2>
                <Flexbox horizontal align={'center'} gap={6} {...stylex.props(styles.meta)}>
                  {author && (
                    <>
                      <span>{ts('connectorMarket.detail.byAuthor', { author })}</span>
                      <span aria-hidden>·</span>
                    </>
                  )}
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
            <Flexbox horizontal align={'center'} flex={'none'} gap={8} wrap={'wrap'}>
              {actions}
            </Flexbox>
          </Flexbox>
        )}

        {/* One page: what it is and who authorized it, then what its tools may do. */}
        <div {...stylex.props(styles.body, hideIdentity && styles.bodyEmbedded)}>
          <Flexbox gap={32}>
            {overview}
            <Section
              label={
                <Flexbox horizontal align={'baseline'} as={'span'} gap={8}>
                  {ts('connectorMarket.detail.tools')}
                  {toolCount > 0 && (
                    <Text as={'span'} fontSize={14} type={'secondary'} weight={400}>
                      {toolCount}
                    </Text>
                  )}
                </Flexbox>
              }
            >
              {tools}
            </Section>
            {hasDangerActions && (
              <Section label={t('connector.dangerZone.title')}>
                <Flexbox
                  horizontal
                  align={'center'}
                  gap={16}
                  justify={'space-between'}
                  wrap={'wrap'}
                >
                  <Text style={{ minWidth: 0 }} type={'secondary'}>
                    {t('connector.dangerZone.desc', { name: connectorName })}
                  </Text>
                  <Flexbox horizontal align={'center'} flex={'none'} gap={8}>
                    {dangerActions}
                  </Flexbox>
                </Flexbox>
              </Section>
            )}
          </Flexbox>

          {/* Edit modal for an http or stdio custom connector */}
          {isEditable && (
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
