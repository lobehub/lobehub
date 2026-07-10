import { DropdownMenu, Flexbox, Icon, stopPropagation } from '@lobehub/ui';
import { Button, confirmModal } from '@lobehub/ui/base-ui';
import { Space } from 'antd';
import { MoreHorizontalIcon, Trash2 } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createMcpSettingsModal } from '@/features/MCP/MCPSettings/McpSettingsModal';
import { createPluginDetailModal } from '@/features/PluginDetailModal';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useServerConfigStore } from '@/store/serverConfig';
import { pluginHelpers, useToolStore } from '@/store/tool';
import { mcpStoreSelectors, pluginSelectors } from '@/store/tool/selectors';
import { type LobeToolType } from '@/types/tool/tool';

import EditCustomPlugin from './EditCustomPlugin';

interface ActionsProps {
  identifier: string;
  isMCP?: boolean;
  type: LobeToolType;
}

const Actions = memo<ActionsProps>(({ identifier, type, isMCP }) => {
  const mobile = useServerConfigStore((s) => s.isMobile);
  const [installed, installing, unInstallPlugin, installMCPPlugin] = useToolStore((s) => [
    pluginSelectors.isPluginInstalled(identifier)(s),
    mcpStoreSelectors.isPluginInstallLoading(identifier)(s),
    s.uninstallCustomPlugin,
    s.installMCPPlugin,
  ]);

  const isCustomPlugin = type === 'customPlugin';
  const { t } = useTranslation('plugin');
  const plugin = useToolStore(pluginSelectors.getToolManifestById(identifier));
  const { allowed: canCreate } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');
  const [togglePlugin, isPluginEnabledInAgent] = useAgentStore((s) => [
    s.togglePlugin,
    agentSelectors.currentAgentPlugins(s).includes(identifier),
  ]);
  const hasSettings = pluginHelpers.isSettingSchemaNonEmpty(plugin?.settings);

  const [showModal, setModal] = useState(false);

  const isCommunityMCP = !isCustomPlugin && isMCP;
  const showConfigureButton = isCustomPlugin || isMCP || hasSettings;

  const configureButton = (
    <Button
      disabled={!canEdit}
      onClick={() => {
        if (!canEdit) return;
        if (isCustomPlugin) {
          setModal(true);
        } else if (isCommunityMCP) {
          createMcpSettingsModal({ identifier });
        } else {
          createPluginDetailModal({
            id: identifier,
            schema: plugin?.settings,
            tab: 'settings',
          });
        }
      }}
    >
      {t('store.actions.configure')}
    </Button>
  );

  return (
    <>
      <Flexbox horizontal align={'center'} gap={8} onClick={stopPropagation}>
        {installed ? (
          <Space.Compact>
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
                        // If plugin is enabled in current agent, disable it first
                        if (isPluginEnabledInAgent) {
                          await togglePlugin(identifier, false);
                        }
                        await unInstallPlugin(identifier);
                      },
                      title: t('store.actions.confirmUninstall'),
                    });
                  },
                },
              ]}
            >
              <Button icon={<Icon icon={MoreHorizontalIcon} />} loading={installing} />
            </DropdownMenu>
          </Space.Compact>
        ) : (
          <Button
            disabled={!canCreate || !canEdit}
            loading={installing}
            size={mobile ? 'small' : undefined}
            onClick={async () => {
              if (!canCreate || !canEdit) return;
              if (isMCP) {
                await installMCPPlugin(identifier);
                await togglePlugin(identifier);
              }
            }}
          >
            {t('store.actions.install')}
          </Button>
        )}
      </Flexbox>
    </>
  );
});

export default Actions;
