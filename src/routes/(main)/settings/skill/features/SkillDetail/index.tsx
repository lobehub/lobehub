'use client';

import { getLobehubSkillProviderById } from '@lobechat/const';
import { Avatar, Markdown, Skeleton } from '@lobehub/ui';
import { Button, confirmModal } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { Plus, SquareArrowOutUpRight, Trash2, Unplug, Wrench } from 'lucide-react';
import { lazy, memo, Suspense, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConnectorDetail, CustomConnectorModal } from '@/features/Connectors';
import { useSkillConnect } from '@/features/SkillStore/SkillList/LobeHub/useSkillConnect';
import { usePermission } from '@/hooks/usePermission';
import { useToolStore } from '@/store/tool';
import { builtinToolSelectors, lobehubSkillStoreSelectors } from '@/store/tool/selectors';
import { connectorSelectors } from '@/store/tool/slices/connector';
import { pluginSelectors } from '@/store/tool/slices/plugin/selectors';

import { getLocalizedBuiltinSkillDetail, getNoPermissionsTitle } from './localization';

const AgentSkillDetail = lazy(() => import('@/features/AgentSkillDetail'));

export type ToolDetailType =
  'agent-skill' | 'builtin' | 'builtin-skill' | 'lobehub-connector' | 'mcp-connector' | 'plugin';

const styles = createStaticStyles(({ css, cssVar }) => ({
  description: css`
    margin-block-start: 8px;
    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
  `,
  header: css`
    display: flex;
    gap: 12px;
    align-items: flex-start;
    justify-content: space-between;

    padding-block: 20px 16px;
    padding-inline: 24px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  name: css`
    font-size: 16px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  noPermissions: css`
    padding: 24px;
    font-size: 14px;
    color: ${cssVar.colorTextTertiary};
  `,
  noPermissionsHeader: css`
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    margin-block-end: 8px;
  `,
  noPermissionsTitle: css`
    font-size: 16px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
}));

interface SkillDetailProps {
  identifier: string;
  onDelete?: () => void;
  type: ToolDetailType;
}

interface LobehubConnectorActionProps {
  identifier: string;
  label: string;
  onDisconnected?: () => void;
}

const LobehubConnectorAction = memo<LobehubConnectorActionProps>(
  ({ identifier, label, onDisconnected }) => {
    const { t } = useTranslation('setting');
    const { allowed: canCreate } = usePermission('create_content');
    const { allowed: canEdit } = usePermission('edit_own_content');
    const { handleConnect, handleDisconnect, isConnected, isConnecting } = useSkillConnect({
      identifier,
      type: 'lobehub',
    });

    const handleConfirmDisconnect = useCallback(() => {
      if (!canEdit) return;

      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content: t('tools.lobehubSkill.disconnectConfirm.desc', { name: label }),
        okButtonProps: { danger: true },
        okText: t('tools.lobehubSkill.disconnect'),
        onOk: async () => {
          const disconnected = await handleDisconnect();
          if (disconnected) onDisconnected?.();
        },
        title: t('tools.lobehubSkill.disconnectConfirm.title', { name: label }),
      });
    }, [canEdit, handleDisconnect, label, onDisconnected, t]);

    if (isConnected) {
      return (
        <Button
          danger
          disabled={!canEdit}
          icon={<Unplug size={14} />}
          loading={isConnecting}
          size="small"
          onClick={handleConfirmDisconnect}
        >
          {t('tools.lobehubSkill.disconnect')}
        </Button>
      );
    }

    return (
      <Button
        disabled={!canCreate || !canEdit}
        icon={<SquareArrowOutUpRight size={14} />}
        loading={isConnecting}
        size="small"
        onClick={() => {
          if (!canCreate || !canEdit) return;
          handleConnect();
        }}
      >
        {t('tools.lobehubSkill.connect')}
      </Button>
    );
  },
);

LobehubConnectorAction.displayName = 'LobehubConnectorAction';

/**
 * Right panel for the Settings > Skill master-detail layout.
 *
 * - 'agent-skill': renders AgentSkillDetail inline (user/market agent skills with UUID id)
 * - 'builtin-skill': renders BuiltinSkill description panel (Artifacts, Task, etc.)
 * - 'builtin'/'plugin'/'mcp-connector': syncs connector entry, renders permission editor
 */
const SkillDetail = memo<SkillDetailProps>(({ identifier, type, onDelete }) => {
  const { t } = useTranslation('plugin');
  const { t: ts } = useTranslation('setting');
  const [syncing, setSyncing] = useState(false);
  const [noManifest, setNoManifest] = useState(false);
  const [migrateOpen, setMigrateOpen] = useState(false);

  const { allowed: canCreate } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');

  const syncBuiltinTool = useToolStore((s) => s.syncBuiltinTool);
  const syncPluginTools = useToolStore((s) => s.syncPluginTools);
  const syncToolsFromClient = useToolStore((s) => s.syncToolsFromClient);
  const fetchConnectors = useToolStore((s) => s.fetchConnectors);
  const installBuiltinTool = useToolStore((s) => s.installBuiltinTool);
  const uninstallBuiltinTool = useToolStore((s) => s.uninstallBuiltinTool);
  const deleteAgentSkill = useToolStore((s) => s.deleteAgentSkill);
  const connector = useToolStore(connectorSelectors.connectorByIdentifier(identifier));

  // Legacy `user_installed_plugins` custom MCP that was never migrated to a
  // connector. Such a row has no `user_connectors` entry, so the panel falls
  // into the "no configurable permissions" empty state. We offer to upgrade it
  // in place via the connector migration flow instead of leaving a dead end.
  const legacyPlugin = useToolStore(pluginSelectors.getCustomPluginById(identifier), isEqual);
  const canMigrateLegacy =
    (type === 'mcp-connector' || type === 'plugin') && Boolean(legacyPlugin?.customParams?.mcp);

  // For lobehub-connector: get the server's tool list from the store
  const lobehubServer = useToolStore(lobehubSkillStoreSelectors.getServerByIdentifier(identifier));
  const lobehubProvider =
    type === 'lobehub-connector' ? getLobehubSkillProviderById(identifier) : undefined;
  const lobehubLabel =
    type === 'lobehub-connector'
      ? lobehubProvider?.label || lobehubServer?.name || identifier
      : identifier;

  // For builtin-skill: look up from store
  const builtinSkill = useToolStore(
    (s) => s.builtinSkills?.find((sk) => sk.identifier === identifier),
    isEqual,
  );
  const isBuiltinInstalled = useToolStore(builtinToolSelectors.isBuiltinToolInstalled(identifier));

  const isConnectorType =
    type === 'builtin' ||
    type === 'plugin' ||
    type === 'mcp-connector' ||
    type === 'lobehub-connector';

  const { title: builtinSkillTitle, description: builtinSkillDescription } =
    getLocalizedBuiltinSkillDetail(builtinSkill, identifier, ts);
  const noPermissionsTitle = getNoPermissionsTitle(identifier, type, ts);

  const renderLobehubConnectorAction = (onDisconnected?: () => void) => {
    if (type !== 'lobehub-connector') return undefined;

    return (
      <LobehubConnectorAction
        identifier={identifier}
        label={lobehubLabel}
        onDisconnected={onDisconnected}
      />
    );
  };

  useEffect(() => {
    if (!isConnectorType) return;

    setNoManifest(false);
    const ensureConnector = async () => {
      setSyncing(true);
      try {
        if (type === 'builtin') {
          await syncBuiltinTool(identifier);
        } else if (type === 'lobehub-connector') {
          // Use tools from the lobehub skill server (already fetched via OAuth flow)
          const tools = (lobehubServer?.tools ?? []).map((t) => ({
            description: t.description,
            inputSchema: t.inputSchema as Record<string, unknown>,
            toolName: t.name,
          }));
          if (tools.length === 0) {
            setNoManifest(true);
          } else {
            await syncToolsFromClient({
              identifier,
              name: lobehubServer?.name || identifier,
              sourceType: 'marketplace',
              tools,
            });
          }
        } else if (type === 'plugin') {
          await syncPluginTools(identifier);
        } else {
          await fetchConnectors();
        }
      } catch {
        setNoManifest(true);
      } finally {
        setSyncing(false);
      }
    };

    ensureConnector();
  }, [
    fetchConnectors,
    identifier,
    isConnectorType,
    lobehubServer?.name,
    lobehubServer?.tools,
    syncBuiltinTool,
    syncPluginTools,
    syncToolsFromClient,
    type,
  ]);

  const handleUninstallBuiltin = () => {
    confirmModal({
      okButtonProps: { danger: true },
      onOk: async () => {
        await uninstallBuiltinTool(identifier);
      },
      title: t('store.actions.confirmUninstall'),
    });
  };

  const handleDeleteAgentSkill = () => {
    confirmModal({
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteAgentSkill(identifier);
        onDelete?.();
      },
      title: t('store.actions.confirmUninstall'),
    });
  };

  // ── Render by type ──────────────────────────────────────────────────────────

  if (type === 'agent-skill') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div
          style={{
            alignItems: 'center',
            borderBlockEnd: '1px solid var(--ant-color-border-secondary)',
            display: 'flex',
            flexShrink: 0,
            justifyContent: 'flex-end',
            padding: '8px 16px',
          }}
        >
          <Button
            danger
            disabled={!canEdit}
            icon={<Trash2 size={14} />}
            size="small"
            onClick={handleDeleteAgentSkill}
          >
            {t('store.actions.uninstall')}
          </Button>
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Suspense
            fallback={
              <div style={{ padding: 24 }}>
                <Skeleton active paragraph={{ rows: 6 }} title={false} />
              </div>
            }
          >
            <AgentSkillDetail skillId={identifier} />
          </Suspense>
        </div>
      </div>
    );
  }

  if (type === 'builtin-skill') {
    return (
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div className={styles.header}>
          <div style={{ alignItems: 'flex-start', display: 'flex', gap: 12 }}>
            {builtinSkill?.avatar && <Avatar avatar={builtinSkill.avatar} size={40} />}
            <div>
              <div className={styles.name}>{builtinSkillTitle}</div>
              {builtinSkillDescription && (
                <div className={styles.description}>{builtinSkillDescription}</div>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', flexShrink: 0, gap: 8 }}>
            {isBuiltinInstalled ? (
              <Button danger disabled={!canEdit} size="small" onClick={handleUninstallBuiltin}>
                {t('store.actions.uninstall')}
              </Button>
            ) : (
              <Button
                disabled={!canCreate}
                icon={<Plus size={14} />}
                size="small"
                onClick={() => installBuiltinTool(identifier)}
              >
                {t('store.actions.install')}
              </Button>
            )}
          </div>
        </div>
        {builtinSkill?.content && (
          <div style={{ padding: '16px 24px' }}>
            <Markdown variant="chat">{builtinSkill.content}</Markdown>
          </div>
        )}
      </div>
    );
  }

  // Connector types: builtin tool / plugin / mcp-connector
  if (syncing) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton active paragraph={{ rows: 6 }} title={false} />
      </div>
    );
  }

  if (noManifest || !connector) {
    return (
      <div className={styles.noPermissions}>
        <div className={styles.noPermissionsHeader}>
          <div className={styles.noPermissionsTitle}>
            {type === 'lobehub-connector' ? lobehubLabel : noPermissionsTitle}
          </div>
          {canMigrateLegacy ? (
            <Button
              disabled={!canCreate || !canEdit}
              icon={<Wrench size={14} />}
              size="small"
              type="primary"
              onClick={() => {
                if (!canCreate || !canEdit) return;
                setMigrateOpen(true);
              }}
            >
              {ts('tools.legacyConnector.configure')}
            </Button>
          ) : (
            renderLobehubConnectorAction()
          )}
        </div>
        {canMigrateLegacy
          ? ts('tools.legacyConnector.upgradeDesc')
          : ts('tools.noConfigurablePermissions')}
        {canMigrateLegacy && legacyPlugin && (
          <CustomConnectorModal
            legacyPlugin={legacyPlugin}
            open={migrateOpen}
            onClose={() => setMigrateOpen(false)}
            onEditSuccess={async () => {
              setMigrateOpen(false);
              setNoManifest(false);
              // The migration created a `user_connectors` row keyed by the same
              // identifier; refresh so this panel resolves it and swaps to the
              // permission editor.
              await fetchConnectors();
            }}
          />
        )}
      </div>
    );
  }

  return (
    <ConnectorDetail
      connectorId={connector.id}
      lifecycleActions={renderLobehubConnectorAction(() => setNoManifest(true))}
      onDelete={onDelete}
    />
  );
});

SkillDetail.displayName = 'SkillDetail';

export default SkillDetail;
