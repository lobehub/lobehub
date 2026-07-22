'use client';

import { Block, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

import { type ComposioAppType } from '@/const/index';
import { type ComposioServer } from '@/store/tool/slices/composioStore';
import { ComposioServerStatus } from '@/store/tool/slices/composioStore';

import { useComposioOAuth } from '../hooks/useComposioOAuth';
import { useComposioServerActions } from '../hooks/useComposioServerActions';
import ServerIcon from './ServerIcon';
import ServerStatusControl from './ServerStatusControl';

interface ComposioServerItemProps {
  appSlug: string;
  icon: ComposioAppType['icon'];
  identifier: string;
  label: string;
  server?: ComposioServer;
}

const ComposioServerItem = memo<ComposioServerItemProps>(
  ({ identifier, label, server, appSlug, icon }) => {
    const { isWaitingAuth, openOAuthWindow } = useComposioOAuth({
      serverStatus: server?.status,
    });

    const { isConnecting, handleConnect, handleReauthorize } = useComposioServerActions({
      appSlug,
      identifier,
      label,
      onAuthRequired: openOAuthWindow,
      server,
    });

    const isConnected = server?.status === ComposioServerStatus.ACTIVE;
    const isPendingAuth = server?.status === ComposioServerStatus.PENDING_AUTH;
    const isError = server?.status === ComposioServerStatus.ERROR;
    const isClickable = !isConnected;

    const handleItemClick = () => {
      if (isConnected) return;

      if (!server) {
        handleConnect();
      } else if (isPendingAuth || isError) {
        // Mint a fresh link rather than reopening the (likely expired) one.
        handleReauthorize();
      }
    };

    return (
      <Block
        horizontal
        align="center"
        clickable={isClickable}
        gap={8}
        justify="space-between"
        padding={12}
        variant={'outlined'}
        style={
          isConnected
            ? {
                background: cssVar.colorSuccessBg,
                borderColor: cssVar.colorSuccessBorder,
              }
            : {}
        }
        onClick={handleItemClick}
      >
        <Flexbox
          horizontal
          align="center"
          flex={1}
          gap={12}
          style={{
            overflow: 'hidden',
          }}
        >
          <ServerIcon icon={icon} label={label} />
          <Text ellipsis>{label}</Text>
        </Flexbox>

        <ServerStatusControl
          isConnecting={isConnecting}
          isWaitingAuth={isWaitingAuth}
          server={server}
        />
      </Block>
    );
  },
);

ComposioServerItem.displayName = 'ComposioServerItem';

export default ComposioServerItem;
