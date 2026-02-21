'use client';

import {
  ActionIcon,
  Block,
  DropdownMenu,
  Flexbox,
  Icon,
  Modal,
  stopPropagation,
} from '@lobehub/ui';
import { App, Button } from 'antd';
import isEqual from 'fast-deep-equal';
import { MoreVerticalIcon, Plus, Trash2 } from 'lucide-react';
import React, { memo, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PluginAvatar from '@/components/Plugins/PluginAvatar';
import McpDetail from '@/features/MCP/MCPDetail';
import McpDetailLoading from '@/features/MCP/MCPDetail/Loading';
import MCPInstallProgress from '@/features/MCP/MCPInstallProgress';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useToolStore } from '@/store/tool';
import { mcpStoreSelectors, pluginSelectors } from '@/store/tool/selectors';
import { type DiscoverMcpItem } from '@/types/discover';

import { itemStyles } from '../style';

const Item = memo<DiscoverMcpItem>(({ name, description, icon, identifier }) => {
  const styles = itemStyles;
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
        <DropdownMenu
          nativeButton={false}
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
          <ActionIcon icon={MoreVerticalIcon} />
        </DropdownMenu>
      );
    }

    if (installing) {
      return (
        <Button size="small" variant={'filled'} onClick={handleCancel}>
          {t('store.actions.cancel')}
        </Button>
      );
    }

    return <ActionIcon icon={Plus} title={t('store.actions.install')} onClick={handleInstall} />;
  };

  return (
    <>
      <Flexbox className={styles.container} gap={0}>
        <Block
          clickable
          horizontal
          align={'center'}
          gap={12}
          paddingBlock={12}
          paddingInline={12}
          style={{ cursor: 'pointer' }}
          variant={'outlined'}
          onClick={() => setDetailOpen(true)}
        >
          <PluginAvatar avatar={icon} size={40} />
          <Flexbox flex={1} gap={4} style={{ minWidth: 0, overflow: 'hidden' }}>
            <span className={styles.title}>{name}</span>
            {description && <span className={styles.description}>{description}</span>}
          </Flexbox>
          <div onClick={stopPropagation}>{renderAction()}</div>
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
        open={detailOpen}
        title={t('dev.title.skillDetails')}
        width={800}
        onCancel={() => setDetailOpen(false)}
      >
        <Suspense fallback={<McpDetailLoading />}>
          <McpDetail noSettings identifier={identifier} />
        </Suspense>
      </Modal>
    </>
  );
});

Item.displayName = 'CommunityListItem';

export default Item;
