import { parsePluginEntry } from '@lobechat/types';
import {
  Button,
  confirmModal,
  DropdownMenu,
  Flexbox,
  Icon,
  stopPropagation,
  toast,
} from '@lobehub/ui';
import { MoreHorizontalIcon, Trash2 } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import CustomConnectorModal from '@/features/Connectors/CustomConnectorModal';
import { asLegacyMigrationPlugin } from '@/features/Connectors/legacyMigrationPlugin';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import { mcpStoreSelectors, pluginSelectors } from '@/store/tool/selectors';
import { connectorSelectors } from '@/store/tool/slices/connector';
import { type LobeToolType } from '@/types/tool/tool';

import ConnectorConfigureButton from './ConnectorConfigureButton';
import EditCustomPlugin from './EditCustomPlugin';

interface ActionsProps {
  identifier: string;
  isMCP?: boolean;
  type: LobeToolType;
}

const Actions = memo<ActionsProps>(({ identifier, type, isMCP }) => {
  const mobile = useServerConfigStore((s) => s.isMobile);
  const isCustomPlugin = type === 'customPlugin';
  const isCommunityMCP = !isCustomPlugin && isMCP;
  const [installed, installing, unInstallPlugin, installMCPPlugin, migrateLegacyPlugin] =
    useToolStore((s) => [
      pluginSelectors.isPluginInstalled(identifier)(s),
      mcpStoreSelectors.isPluginInstallLoading(identifier)(s),
      // A community MCP may be installed as a connector, which only this removes.
      isCommunityMCP ? s.uninstallMCPPlugin : s.uninstallCustomPlugin,
      s.installMCPPlugin,
      s.migrateLegacyPluginToConnector,
    ]);

  const { t } = useTranslation('plugin');

  const { allowed: canCreate } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');
  const [togglePlugin, removePlugin, hasPluginEntry] = useAgentStore((s) => [
    s.togglePlugin,
    s.removePlugin,
    (agentSelectors.currentAgentConfig(s)?.plugins ?? []).some(
      (entry) => parsePluginEntry(entry).identifier === identifier,
    ),
  ]);
  // A marketplace MCP installed as a connector, a reinstall over a legacy row
  // included: its tools run on the connector, so its settings are edited there,
  // not in the plugin settings modal.
  const marketConnector = useToolStore((s) =>
    isCommunityMCP
      ? connectorSelectors.marketplaceMcpConnectorByIdentifier(identifier)(s)
      : undefined,
  );

  // Painted from the local cache: settings and connection parameters only
  // arrive with the server's records, so configuring waits for them.
  const isConfirming = useToolStore(pluginSelectors.isInstalledPluginsCacheOnly);

  const [showModal, setModal] = useState(false);
  const [showMigrationRepair, setShowMigrationRepair] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const legacyPluginRow = useToolStore(pluginSelectors.getInstalledPluginById(identifier));
  const migrationRepairPlugin =
    isCommunityMCP &&
    legacyPluginRow?.type === 'plugin' &&
    legacyPluginRow.customParams?.mcp?.type !== 'cloud'
      ? asLegacyMigrationPlugin(legacyPluginRow)
      : undefined;

  // A market-hosted (cloud) connector has no connection settings to edit.
  const showConfigureButton = marketConnector
    ? marketConnector.mcpConnectionType !== 'cloud'
    : isCustomPlugin || isMCP;
  // Server-side migration reads the confirmed row itself; a custom migration
  // form still waits for it because it seeds the edit from the client record.
  const confirming = isConfirming && !isCommunityMCP;

  const configureButton = marketConnector ? (
    <ConnectorConfigureButton canEdit={canEdit} connector={marketConnector} />
  ) : (
    <Button
      disabled={!canEdit || confirming || migrating}
      loading={confirming || migrating}
      onClick={() => {
        if (!canEdit || confirming || migrating) return;
        if (isCustomPlugin) {
          setModal(true);
        } else if (isCommunityMCP) {
          confirmModal({
            content: t('store.actions.confirmMigrate'),
            okText: t('store.actions.upgrade'),
            onOk: async () => {
              setMigrating(true);
              try {
                await migrateLegacyPlugin(identifier);
                toast.success(t('store.actions.migrateSuccess'));
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : t('store.actions.migrateFailed'),
                );
                // The legacy settings editor used to be the repair path for a
                // moved endpoint or broken launch command. Migration keeps that
                // path by reopening the connection form with the failed values;
                // saving it retries the server-side migration with those repairs.
                if (migrationRepairPlugin) setShowMigrationRepair(true);
              } finally {
                setMigrating(false);
              }
            },
            title: t('store.actions.upgrade'),
          });
        }
      }}
    >
      {isCommunityMCP ? t('store.actions.upgrade') : t('store.actions.configure')}
    </Button>
  );

  return (
    <>
      <Flexbox horizontal align={'center'} gap={8} onClick={stopPropagation}>
        {installed ? (
          <Flexbox horizontal gap={4}>
            {showConfigureButton &&
              (isCustomPlugin ? (
                <EditCustomPlugin identifier={identifier} open={showModal} onOpenChange={setModal}>
                  {configureButton}
                </EditCustomPlugin>
              ) : (
                configureButton
              ))}
            <DropdownMenu
              placement="bottomRight"
              items={[
                {
                  danger: true,
                  disabled: !canEdit,
                  icon: <Icon icon={Trash2} />,
                  key: 'uninstall',
                  label: t('store.actions.uninstall'),
                  onClick: () => {
                    if (!canEdit) return;
                    confirmModal({
                      okButtonProps: { danger: true },
                      onOk: async () => {
                        // Drop any agent-level entry (auto / pinned / disabled) before uninstalling
                        if (hasPluginEntry) {
                          await removePlugin(identifier);
                        }
                        await unInstallPlugin(identifier);
                      },
                      content: t('store.actions.confirmUninstall'),
                      okText: t('store.actions.uninstall'),
                      title: t('store.actions.uninstall'),
                    });
                  },
                },
              ]}
            >
              <Button icon={<Icon icon={MoreHorizontalIcon} />} loading={installing} />
            </DropdownMenu>
          </Flexbox>
        ) : (
          <Button
            disabled={!canCreate || !canEdit}
            loading={installing}
            size={mobile ? 'small' : undefined}
            onClick={async () => {
              if (!canCreate || !canEdit) return;
              if (isMCP) {
                await installMCPPlugin(identifier);
                await togglePlugin(identifier, true);
              }
            }}
          >
            {t('store.actions.install')}
          </Button>
        )}
      </Flexbox>
      {migrationRepairPlugin && (
        <CustomConnectorModal
          legacyPlugin={migrationRepairPlugin}
          open={showMigrationRepair}
          onClose={() => setShowMigrationRepair(false)}
          onEditSuccess={() => setShowMigrationRepair(false)}
        />
      )}
    </>
  );
});

export default Actions;
