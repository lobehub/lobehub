'use client';

import { ActionIcon, Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from 'antd';
import { createStyles, cssVar } from 'antd-style';
import { Check, Loader2, Plus } from 'lucide-react';
import React, { memo } from 'react';

import PluginAvatar from '@/components/Plugins/PluginAvatar';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { useAgentStore } from '@/store/agent';
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
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    font-size: 12px;
    line-height: 1.4;
    color: ${token.colorTextSecondary};
  `,
  installed: css`
    color: ${token.colorSuccess};
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

const CommunityItem = memo<DiscoverMcpItem>(({ name, description, icon, identifier }) => {
  const { styles, cx } = useStyles();

  const [installed, installing, installMCPPlugin, cancelInstallMCPPlugin, plugin] = useToolStore(
    (s) => [
      pluginSelectors.isPluginInstalled(identifier)(s),
      mcpStoreSelectors.isMCPInstalling(identifier)(s),
      s.installMCPPlugin,
      s.cancelInstallMCPPlugin,
      mcpStoreSelectors.getPluginById(identifier)(s),
    ],
  );

  const togglePlugin = useAgentStore((s) => s.togglePlugin);
  const { isAuthenticated, signIn } = useMarketAuth();

  const isCloudMcp = !!((plugin as any)?.cloudEndPoint || (plugin as any)?.haveCloudEndpoint);

  const handleInstall = async (e: React.MouseEvent) => {
    e.stopPropagation();

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

  const handleCancel = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await cancelInstallMCPPlugin(identifier);
  };

  const renderAction = () => {
    if (installed) {
      return <ActionIcon icon={Check} style={{ color: cssVar.colorSuccess }} />;
    }

    if (installing) {
      return (
        <Button onClick={handleCancel} size="small" type="text">
          <Icon icon={Loader2} spin />
        </Button>
      );
    }

    return <ActionIcon icon={Plus} onClick={handleInstall} />;
  };

  return (
    <Block
      align={'center'}
      className={styles.container}
      gap={12}
      horizontal
      paddingBlock={12}
      paddingInline={12}
      variant={'filled'}
    >
      <PluginAvatar avatar={icon} size={40} />
      <Flexbox flex={1} gap={4} style={{ minWidth: 0, overflow: 'hidden' }}>
        <span className={cx(styles.title, installed && styles.installed)}>{name}</span>
        <Text className={styles.description} type={'secondary'}>
          {description}
        </Text>
      </Flexbox>
      {renderAction()}
    </Block>
  );
});

CommunityItem.displayName = 'CommunityItem';

export default CommunityItem;
