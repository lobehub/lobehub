import { ActionIcon, Button, Dropdown, Flexbox, Icon, Modal } from '@lobehub/ui';
import { App } from 'antd';
import { InfoIcon, MoreVerticalIcon, Trash2 } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PluginDetailModal from '@/features/PluginDetailModal';
import McpDetail from '@/features/PluginStore/McpList/Detail';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useServerConfigStore } from '@/store/serverConfig';
import { pluginHelpers, useToolStore } from '@/store/tool';
import { pluginSelectors, pluginStoreSelectors } from '@/store/tool/selectors';
import { type LobeToolType } from '@/types/tool/tool';

import EditCustomPlugin from '../../EditCustomPlugin';

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
  const [open, setOpen] = useState(false);
  const plugin = useToolStore(pluginSelectors.getToolManifestById(identifier));
  const [togglePlugin, isPluginEnabledInAgent] = useAgentStore((s) => [
    s.togglePlugin,
    agentSelectors.currentAgentPlugins(s).includes(identifier),
  ]);
  const { modal } = App.useApp();
  const [tab, setTab] = useState('info');
  const hasSettings = pluginHelpers.isSettingSchemaNonEmpty(plugin?.settings);

  const [showModal, setModal] = useState(false);
  const [mcpSettingsOpen, setMcpSettingsOpen] = useState(false);

  // 自定义插件（包括自定义 MCP）使用 EditCustomPlugin
  // 社区 MCP 使用 McpSettings
  // 传统插件使用 PluginDetailModal
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
          setOpen(true);
          setTab('settings');
        }
      }}
      size="small"
      type="text"
    >
      {t('store.actions.configure')}
    </Button>
  );

  return (
    <>
      <Flexbox align={'center'} horizontal onClick={(e) => e.stopPropagation()}>
        {installed ? (
          <>
            {showConfigureButton &&
              (isCustomPlugin ? (
                <EditCustomPlugin identifier={identifier} onOpenChange={setModal} open={showModal}>
                  {configureButton}
                </EditCustomPlugin>
              ) : (
                configureButton
              ))}
            <Dropdown
              menu={{
                items: [
                  {
                    icon: <Icon icon={InfoIcon} />,
                    key: 'detail',
                    label: t('store.actions.detail'),
                    onClick: () => {
                      setOpen(true);
                      setTab('info');
                    },
                  },
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
                ],
              }}
              placement="bottomRight"
              trigger={['click']}
            >
              <ActionIcon icon={MoreVerticalIcon} loading={installing} />
            </Dropdown>
          </>
        ) : (
          <Button
            loading={installing}
            onClick={async () => {
              if (isMCP) {
                await installMCPPlugin(identifier);
                await togglePlugin(identifier);
              } else {
                await installPlugin(identifier);
                await togglePlugin(identifier);
              }
            }}
            size={mobile ? 'small' : undefined}
          >
            {t('store.actions.install')}
          </Button>
        )}
      </Flexbox>
      <PluginDetailModal
        id={identifier}
        onClose={() => {
          setOpen(false);
        }}
        onTabChange={setTab}
        open={open}
        schema={plugin?.settings}
        tab={tab}
      />
      <Modal
        allowFullscreen
        destroyOnClose
        footer={null}
        onCancel={() => setMcpSettingsOpen(false)}
        open={mcpSettingsOpen}
        title={null}
        width={800}
      >
        <McpDetail identifier={identifier} />
      </Modal>
    </>
  );
});

export default Actions;
