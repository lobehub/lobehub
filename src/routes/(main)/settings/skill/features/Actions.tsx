import { Button, DropdownMenu, Flexbox, Icon, stopPropagation } from '@lobehub/ui';
import { App, Space } from 'antd';
import { MoreHorizontalIcon, Trash2 } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import McpSettingsModal from '@/features/MCP/MCPSettings/McpSettingsModal';
import PluginDetailModal from '@/features/PluginDetailModal';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useServerConfigStore } from '@/store/serverConfig';
import { pluginHelpers, useToolStore } from '@/store/tool';
import { pluginSelectors, pluginStoreSelectors } from '@/store/tool/selectors';
import { type LobeToolType } from '@/types/tool/tool';

import EditCustomPlugin from './EditCustomPlugin';

interface ActionsProps {
  identifier: string;
  isMCP?: boolean;
  type: LobeToolType;
}

const Actions = memo<ActionsProps>(({ identifier, type, isMCP }) => {
  const mobile = useServerConfigStore((s) => s.isMobile);
  const [installed, installing, installPlugin, unInstallPlugin, installMCPPlugin] = useToolStore(
    (s) => [
      pluginSelectors.isPluginInstalled(identifier)(s),
      pluginStoreSelectors.isPluginInstallLoading(identifier)(s),
      s.installPlugin,
      s.uninstallPlugin,
      s.installMCPPlugin,
    ],
  );

  const isCustomPlugin = type === 'customPlugin';
  const { t } = useTranslation('plugin');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const plugin = useToolStore(pluginSelectors.getToolManifestById(identifier));
  const [togglePlugin, isPluginEnabledInAgent] = useAgentStore((s) => [
    s.togglePlugin,
    agentSelectors.currentAgentPlugins(s).includes(identifier),
  ]);
  const { modal } = App.useApp();
  const hasSettings = pluginHelpers.isSettingSchemaNonEmpty(plugin?.settings);

  const [showModal, setModal] = useState(false);
  const [mcpSettingsOpen, setMcpSettingsOpen] = useState(false);

  const isCommunityMCP = !isCustomPlugin && isMCP;
  const showConfigureButton = isCustomPlugin || isMCP || hasSettings;

  const configureButton = (
    <Button
      onClick={() => {
        if (isCustomPlugin) {
          setModal(true);
        } else if (isCommunityMCP) {
          setMcpSettingsOpen(true);
        } else {
          setSettingsOpen(true);
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
                  icon: <Icon icon={Trash2} />,
                  key: 'uninstall',
                  label: t('store.actions.uninstall'),
                  onClick: () => {
                    modal.confirm({
                      centered: true,
                      okButtonProps: { danger: true },
                      onOk: async () => {
                        // If plugin is enabled in current agent, disable it first
                        if (isPluginEnabledInAgent) {
                          await togglePlugin(identifier, false);
                        }
                        await unInstallPlugin(identifier);
                      },
                      title: t('store.actions.confirmUninstall'),
                      type: 'error',
                    });
                  },
                },
              ]}
            >
              <Button icon={MoreHorizontalIcon} loading={installing} />
            </DropdownMenu>
          </Space.Compact>
        ) : (
          <Button
            loading={installing}
            size={mobile ? 'small' : undefined}
            onClick={async () => {
              if (isMCP) {
                await installMCPPlugin(identifier);
                await togglePlugin(identifier);
              } else {
                await installPlugin(identifier);
                await togglePlugin(identifier);
              }
            }}
          >
            {t('store.actions.install')}
          </Button>
        )}
      </Flexbox>
      <PluginDetailModal
        id={identifier}
        open={settingsOpen}
        schema={plugin?.settings}
        tab="settings"
        onClose={() => {
          setSettingsOpen(false);
        }}
      />
      <McpSettingsModal
        identifier={identifier}
        open={mcpSettingsOpen}
        onClose={() => setMcpSettingsOpen(false)}
      />
    </>
  );
});

export default Actions;
