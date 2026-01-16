'use client';

import { ActionIcon, Block, Dropdown, Flexbox, Icon, Modal, Text } from '@lobehub/ui';
import { App, Button } from 'antd';
import { createStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { MoreVerticalIcon, Plus, Trash2 } from 'lucide-react';
import React, { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PluginAvatar from '@/components/Plugins/PluginAvatar';
import MCPInstallProgress from '@/features/MCP/MCPInstallProgress';
import McpDetail from '@/features/PluginStore/McpList/Detail';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useToolStore } from '@/store/tool';
import { mcpStoreSelectors, pluginSelectors } from '@/store/tool/selectors';
import { type DiscoverMcpItem } from '@/types/discover';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    position: relative;
    overflow: hidden;
    flex: 1;
    min-width: 0;
  `,
  description: css`
    overflow: hidden;

    font-size: 12px;
    color: ${token.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  title: css`
    overflow: hidden;

    font-size: 14px;
    font-weight: 500;
    color: ${token.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

const Item = memo<DiscoverMcpItem>(({ name, description, icon, identifier }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('plugin');
  const { modal } = App.useApp();
  const [detailOpen, setDetailOpen] = useState(false);

  const [installed, installing, installMCPPlugin, cancelInstallMCPPlugin, unInstallPlugin, plugin] =
    useToolStore((s) => [
      pluginSelectors.isPluginInstalled(identifier)(s),
      mcpStoreSelectors.isMCPInstalling(identifier)(s),
      s.installMCPPlugin,
      s.cancelInstallMCPPlugin,
      s.uninstallPlugin,
      mcpStoreSelectors.getPluginById(identifier)(s),
    ]);

  const installProgress = useToolStore(
    mcpStoreSelectors.getMCPInstallProgress(identifier),
    isEqual,
  );

  const [togglePlugin, isPluginEnabledInAgent] = useAgentStore((s) => [
    s.togglePlugin,
    agentSelectors.currentAgentPlugins(s).includes(identifier),
  ]);
  const { isAuthenticated, signIn } = useMarketAuth();

  const isCloudMcp = !!((plugin as any)?.cloudEndPoint || (plugin as any)?.haveCloudEndpoint);

  const handleInstall = async () => {
    if (isCloudMcp && !isAuthenticated) {
      try {
        await signIn();
      } catch {
        return;
      }
    }

    const isSuccess = await installMCPPlugin(identifier);

    if (isSuccess) {
      await togglePlugin(identifier);
    }
  };

  const handleCancel = async () => {
    await cancelInstallMCPPlugin(identifier);
  };

  const renderAction = () => {
    if (installed) {
      return (
        <Dropdown
          menu={{
            items: [
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
          <ActionIcon icon={MoreVerticalIcon} />
        </Dropdown>
      );
    }

    if (installing) {
      return (
        <Button onClick={handleCancel} size="small" variant={'filled'}>
          {t('store.actions.cancel')}
        </Button>
      );
    }

    return <ActionIcon icon={Plus} onClick={handleInstall} title={t('store.actions.install')} />;
  };

  return (
    <>
      <Flexbox className={styles.container} gap={0}>
        <Block
          align={'center'}
          gap={12}
          horizontal
          onClick={() => setDetailOpen(true)}
          paddingBlock={12}
          paddingInline={12}
          style={{ cursor: 'pointer' }}
          variant={'filled'}
        >
          <PluginAvatar avatar={icon} size={40} />
          <Flexbox flex={1} gap={4} style={{ minWidth: 0, overflow: 'hidden' }}>
            <span className={styles.title}>{name}</span>
            <Text className={styles.description} type={'secondary'}>
              {description}
            </Text>
          </Flexbox>
          <div onClick={(e) => e.stopPropagation()}>{renderAction()}</div>
        </Block>

        {!!installProgress && (
          <Flexbox paddingInline={12}>
            <MCPInstallProgress identifier={identifier} />
          </Flexbox>
        )}
      </Flexbox>
      <Modal
        destroyOnHidden
        footer={null}
        onCancel={() => setDetailOpen(false)}
        open={detailOpen}
        title={t('dev.title.skillDetails')}
        width={800}
      >
        <McpDetail identifier={identifier} noSettings />
      </Modal>
    </>
  );
});

Item.displayName = 'CommunityListItem';

export default Item;
